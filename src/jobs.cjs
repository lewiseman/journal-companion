const { CONVERSATION_OPERATION, CONVERSATION_LIMITS, validateConversationInput, validateConversationOutput } = require('./conversation.cjs');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { CompanionError } = require('./model.cjs');
const { SUMMARY_OPERATION, validateSummaryInput, validateSummaryOutput } = require('./summary.cjs');
const { OPERATIONS, validateTransformInput, validateTransformOutput } = require('./transform.cjs');
const { PRESENTATION_OPERATION, validatePresentationInput, validatePresentationOutput } = require('./presentation.cjs');
const { DIARY_OPERATION, validateDiaryInput, validateDiaryOutput } = require('./diary.cjs');
const { QUESTION_OPERATION, validateQuestionInput, validateQuestionOutput } = require('./question.cjs');
const { HISTORY_OPERATION, validateHistoryInput, validateHistoryOutput } = require('./history.cjs');
const { QUESTION_OPERATIONS, validateNoteQuestionInput, validateNoteQuestionOutput } = require('./note-question.cjs');
const { REFLECTION_OPERATION, validateReflectionInput, validateReflectionOutput } = require('./reflection.cjs');
const { NOTE_HELP } = require('./note-help.cjs');
const { IMAGE_OPERATIONS, validateImageJobInput } = require('./vision.cjs');
const { BACKGROUND_OPERATION, validateBackgroundInput } = require('./background.cjs');
const { EMBED_OPERATION, EMBED_LIMITS, validateEmbedInput } = require('./embed.cjs');
const JOB_OPERATIONS = () => [CONVERSATION_OPERATION, 'text', SUMMARY_OPERATION, ...Object.keys(OPERATIONS), PRESENTATION_OPERATION, DIARY_OPERATION, QUESTION_OPERATION, HISTORY_OPERATION, ...QUESTION_OPERATIONS, ...Object.keys(NOTE_HELP), ...IMAGE_OPERATIONS, BACKGROUND_OPERATION, REFLECTION_OPERATION, EMBED_OPERATION];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'expired']);
const RETENTION = 24 * 60 * 60 * 1000;
const TOMBSTONE_RETENTION = 7 * RETENTION;
const expires = (job) => job.expires ?? job.created + RETENTION;
function expire(job) { job.state = 'expired'; delete job.prompt; delete job.text; delete job.error; }
class Jobs extends EventEmitter {
  constructor(vault, runtime, library, now = Date.now) { super(); Object.assign(this, { vault, runtime, library, now }); this.stopped = false; }
  async initialize() {
    await this.vault.change((data) => {
      for (const job of Object.values(data.jobs)) {
        if (job.state === 'running') { job.state = 'interrupted'; job.error = 'DESKTOP_RESTARTED'; delete job.prompt; job.finished = this.now(); }
      }
      this.prune(data);
    });
    this.timer = setInterval(() => this.cleanup().catch(() => {}), 60000); this.timer.unref();
    this.refresh(); this.pump();
  }
  prune(data) {
    for (const [key, job] of Object.entries(data.jobs)) {
      if (!data.devices[job.device] || expires(job) + TOMBSTONE_RETENTION <= this.now()) delete data.jobs[key];
      else if (expires(job) <= this.now()) expire(job);
    }
  }
  async cleanup() {
    await this.vault.change((data) => this.prune(data));
    if (this.active && this.vault.value.jobs[this.active]?.state !== 'running') await this.runtime.cancelGeneration();
    this.refresh();
  }
  refresh() {
    this.runtime.reserved = Object.values(this.vault.value.jobs).some((j) => !TERMINAL.has(j.state)); this.emit('change');
    this.vision?.sweep(this.vault.value.jobs).catch(() => {});
    this.background?.sweep(this.vault.value.jobs, this.now()).catch(() => {});
  }
  key(device, id) { return `${device}:${id}`; }
  // Image jobs arrive only through the larger image route, with base64 bytes.
  async submit(device, input, { image = false } = {}) {
    const vision = IMAGE_OPERATIONS.includes(input?.operation);
    if (vision !== image || (vision && !this.vision)) throw new CompanionError('INVALID_INPUT', 'Send image questions through the image route.');
    if (vision) validateImageJobInput(input.prompt, input.operation);
    const background = input?.operation === BACKGROUND_OPERATION, embed = input?.operation === EMBED_OPERATION;
    if (embed) {
      if (!this.embedder) throw new CompanionError('NOT_READY', 'Search by meaning is not available on this computer.');
      validateEmbedInput(input.prompt);
    }
    if (background) {
      if (!this.background) throw new CompanionError('NOT_READY', 'Note backgrounds are not available on this computer.');
      validateBackgroundInput(input.prompt);
    }
    if (!input || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.id || '') || !JOB_OPERATIONS().includes(input.operation) || typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > (input.operation === CONVERSATION_OPERATION ? CONVERSATION_LIMITS.inputBytes : embed ? EMBED_LIMITS.inputBytes : 2000)) throw new CompanionError('INVALID_INPUT', 'Supply a unique request ID and up to 2,000 UTF-8 bytes for text.');
    if (input.operation === CONVERSATION_OPERATION) validateConversationInput(input.prompt);
    if (input.operation === SUMMARY_OPERATION) validateSummaryInput(input.prompt);
    if (Object.hasOwn(OPERATIONS, input.operation)) validateTransformInput(input.prompt, input.operation);
    if (input.operation === PRESENTATION_OPERATION) validatePresentationInput(input.prompt);
    if (input.operation === DIARY_OPERATION) validateDiaryInput(input.prompt);
    if (input.operation === QUESTION_OPERATION) validateQuestionInput(input.prompt);
    if (input.operation === HISTORY_OPERATION) validateHistoryInput(input.prompt);
    if (QUESTION_OPERATIONS.includes(input.operation)) validateNoteQuestionInput(input.prompt, input.operation);
    if (input.operation === REFLECTION_OPERATION) validateReflectionInput(input.prompt);
    if (Object.hasOwn(NOTE_HELP, input.operation)) NOTE_HELP[input.operation].validateInput(input.prompt);
    if (input.expires !== undefined && (!Number.isSafeInteger(input.expires) || input.expires > this.now() + RETENTION + 60000)) throw new CompanionError('INVALID_INPUT', 'Supply an expiry within 24 hours. Check both device clocks.');
    let picture;
    if (vision) {
      if (typeof input.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) throw new CompanionError('INVALID_IMAGE', 'Send one base64 PNG or JPEG image.');
      picture = Buffer.from(input.image, 'base64');
      if (this.vision.capability().status !== 'ready') throw new CompanionError('NOT_READY', 'Image understanding is not ready on the computer.');
    }
    const key = this.key(device, input.id), digest = createHash('sha256').update(JSON.stringify([input.operation, input.prompt, ...(picture ? [createHash('sha256').update(picture).digest('hex')] : [])])).digest('hex');
    // Store the encrypted image before accepting; an existing identical job keeps its own copy.
    const stored = picture && !this.vault.value.jobs[key] ? await this.vision.store(device, input.id, picture) : null;
    await this.vault.change((data) => {
      this.prune(data);
      if (!data.devices[device]) throw new CompanionError('UNAUTHORIZED', 'Device trust was revoked.');
      if (data.jobs[key]) {
        if (data.jobs[key].digest && data.jobs[key].digest !== digest) throw new CompanionError('ID_CONFLICT', 'This ID already belongs to different input.');
        return;
      }
      if (input.expires !== undefined && input.expires <= this.now()) throw new CompanionError('EXPIRED', 'This request expired. Start a new request explicitly.');
      if (background && this.background.capability().status !== 'ready') throw new CompanionError('NOT_READY', 'Background generation is not ready on the computer.');
      if (embed && this.embedder.capability().status !== 'ready') throw new CompanionError('NOT_READY', 'The embedding model is not loaded on the computer.');
      if (!vision && !background && !embed && this.library.capability().status !== 'ready' && !this.runtime.reserved) throw new CompanionError('NOT_READY', 'The writing model is not ready.');
      if (Object.values(data.jobs).filter((j) => !TERMINAL.has(j.state)).length >= 16 || Object.values(data.jobs).filter((j) => j.device === device && !TERMINAL.has(j.state)).length >= 4 || Object.values(data.jobs).length >= 1000) throw new CompanionError('QUEUE_FULL', 'Wait for or remove previous work.');
      data.jobs[key] = { id: input.id, device, operation: input.operation, model: vision ? this.vision.model.id : background ? this.background.model.id : embed ? this.embedder.model.id : this.library.assignment, digest, prompt: input.prompt, state: 'queued', created: this.now(), expires: Math.min(input.expires ?? this.now() + RETENTION, this.now() + RETENTION),
        ...(stored ? { image: { type: stored.type, width: stored.width, height: stored.height, bytes: stored.bytes } } : {}) };
    });
    this.refresh(); setImmediate(() => this.pump());
    return this.get(device, input.id);
  }
  get(device, id) {
    const job = this.vault.value.jobs[this.key(device, id)];
    if (!job || !this.vault.value.devices[device]) throw new CompanionError('NOT_FOUND', 'This work is unavailable or expired.');
    const safe = structuredClone(job);
    if (expires(safe) <= this.now()) expire(safe);
    delete safe.prompt; delete safe.digest; return safe;
  }
  list() { return Object.values(this.vault.value.jobs).map(({ prompt, text, digest, ...metadata }) => ({ ...metadata, deviceName: this.vault.value.devices[metadata.device]?.name || 'Removed device' })); }
  async cancel(device, id, operation = SUMMARY_OPERATION) {
    if (!JOB_OPERATIONS().includes(operation)) throw new CompanionError('INVALID_INPUT', 'Invalid operation.');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new CompanionError('INVALID_INPUT', 'Invalid task ID.');
    const key = this.key(device, id);
    await this.vault.change((data) => {
      this.prune(data);
      if (!data.devices[device]) throw new CompanionError('UNAUTHORIZED', 'Device trust was revoked.');
      // A durable fence prevents a delayed submission from starting after cancel.
      if (!data.jobs[key]) {
        if (Object.keys(data.jobs).length >= 1000) throw new CompanionError('QUEUE_FULL', 'Retained task limit reached.');
        data.jobs[key] = { id, device, operation, model: this.library.assignment || '', state: 'cancelled', created: this.now(), expires: this.now() + RETENTION };
      }
      const job = data.jobs[key];
      if (job && !TERMINAL.has(job.state)) { job.state = 'cancelled'; job.finished = this.now(); delete job.prompt; delete job.text; }
    });
    if (this.active === key) await this.runtime.cancelGeneration();
    this.refresh(); return this.get(device, id);
  }
  async forget(device) {
    await this.vault.change((data) => { delete data.devices[device]; for (const [key, job] of Object.entries(data.jobs)) if (job.device === device) delete data.jobs[key]; });
    if (this.active?.startsWith(device + ':')) await this.runtime.cancelGeneration();
    this.refresh();
  }
  async acknowledge(device, id) {
    this.get(device, id);
    await this.vault.change((data) => {
      this.prune(data);
      const job = data.jobs[this.key(device, id)];
      if (!job || !TERMINAL.has(job.state)) throw new CompanionError('BUSY', 'Cancel active work before removing it.');
      // Retain only a receipt: lost ack/retries cannot execute the operation again.
      job.acknowledged = true; delete job.prompt; delete job.text;
    }); this.refresh();
  }
  async pump() {
    if (this.pumping || this.stopped || this.runtime.busy || this.runtime.audioReserved || this.paused?.()) return;
    this.pumping = true;
    try {
      while (!this.stopped) {
        if (this.runtime.audioReserved) break;
        const job = Object.values(this.vault.value.jobs).find((j) => j.state === 'queued'); if (!job) break;
        const key = this.key(job.device, job.id); this.active = key;
        await this.vault.change((data) => { this.prune(data); if (data.jobs[key]?.state === 'queued') { data.jobs[key].state = 'running'; data.jobs[key].started = this.now(); } });
        if (this.vault.value.jobs[key]?.state !== 'running') continue;
        this.emit('change');
        let result;
        try {
          result = job.operation === EMBED_OPERATION ? (job.model !== this.embedder?.model.id ? { ok: false, error: { code: 'MODEL_CHANGED' } } : await this.embedder.run(job.prompt))
            : job.operation === BACKGROUND_OPERATION ? await this.generateBackground(job, key)
            : IMAGE_OPERATIONS.includes(job.operation) ? await this.vision.run(JSON.parse(job.prompt), await this.vision.load(job.device, job.id, job.image?.type), { job: true, operation: job.operation })
            : job.model !== this.library.assignment ? { ok: false, error: { code: 'ASSIGNMENT_CHANGED' } } : await this.runtime.generate(job.prompt, { job: true, operation: job.operation });
          if (result.ok && job.operation === CONVERSATION_OPERATION) result.text = validateConversationOutput(result.text, job.prompt);
          if (result.ok && job.operation === SUMMARY_OPERATION) result.text = validateSummaryOutput(result.text);
          if (result.ok && Object.hasOwn(OPERATIONS, job.operation)) result.text = validateTransformOutput(result.text);
          if (result.ok && job.operation === PRESENTATION_OPERATION) result.text = validatePresentationOutput(result.text);
          if (result.ok && job.operation === DIARY_OPERATION) result.text = validateDiaryOutput(result.text);
          if (result.ok && job.operation === QUESTION_OPERATION) result.text = validateQuestionOutput(result.text);
          if (result.ok && job.operation === HISTORY_OPERATION) result.text = validateHistoryOutput(result.text);
          if (result.ok && QUESTION_OPERATIONS.includes(job.operation)) result.text = validateNoteQuestionOutput(result.text);
          if (result.ok && job.operation === REFLECTION_OPERATION) result.text = validateReflectionOutput(result.text);
          if (result.ok && Object.hasOwn(NOTE_HELP, job.operation)) result.text = NOTE_HELP[job.operation].validateOutput(result.text, job.prompt);
        }
        catch (error) { result = { ok: false, error: { code: ['INVALID_OUTPUT', 'IMAGE_MISSING'].includes(error.code) ? error.code : 'RUNTIME_FAILED' } }; }
        await this.vault.change((data) => {
          this.prune(data);
          if (data.jobs[key]?.state !== 'running') return;
          Object.assign(data.jobs[key], { state: result.ok ? 'completed' : 'failed', finished: this.now() });
          delete data.jobs[key].prompt;
          if (result.ok) data.jobs[key].text = result.text; else data.jobs[key].error = result.error.code;
        });
        this.active = null; this.refresh();
      }
    } finally { this.active = null; this.pumping = false; this.refresh(); }
  }
  async generateBackground(job, key) {
    if (job.model !== this.background.model?.id) return { ok: false, error: { code: 'ASSIGNMENT_CHANGED' } };
    let last = 0;
    const result = await this.background.generate(JSON.parse(job.prompt), { job: true, onProgress: (step, total) => {
      // Progress is advisory; a few durable updates per job are enough.
      if (this.now() - last < 2000 && step !== total) return;
      last = this.now();
      this.vault.change((data) => { if (data.jobs[key]?.state === 'running') data.jobs[key].progress = { step, total }; }).then(() => this.emit('change'), () => {});
    } });
    if (!result.ok) return result;
    const sha256 = await this.background.store(job.device, job.id, result.bytes);
    return { ok: true, text: JSON.stringify({ width: result.width, height: result.height, seed: result.seed, bytes: result.bytes.length, sha256, model: result.model }) };
  }
  /** The generated PNG of a completed, unacknowledged background job. */
  async backgroundResult(device, id) {
    const job = this.get(device, id);
    if (job.operation !== BACKGROUND_OPERATION || job.state !== 'completed' || job.acknowledged || !this.background) throw new CompanionError('NOT_FOUND', 'No generated background is waiting for this task.');
    return { id, image: await this.background.result(device, id), sha256: JSON.parse(job.text).sha256 };
  }
  async shutdown() {
    this.stopped = true; clearInterval(this.timer);
    await this.vault.change((data) => {
      this.prune(data);
      for (const job of Object.values(data.jobs)) if (job.state === 'running') {
        job.state = 'interrupted'; job.error = 'DESKTOP_STOPPED'; job.finished = this.now(); delete job.prompt;
      }
    });
    await this.runtime.cancelGeneration(); await this.vault.tail;
  }
}
module.exports = { Jobs, RETENTION, TOMBSTONE_RETENTION };
