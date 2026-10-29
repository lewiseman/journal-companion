const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { MODELS, CompanionError, verifyModel, artifactParts, getModel } = require('./model.cjs');
const { bounded, publicError } = require('./runtime.cjs');

// I06: one optional generated note background. The phone sends only the
// user's own short description and a light/dark tone; never note text.
const BACKGROUND_OPERATION = 'generate-note-background';
// Mobile CPU inference uses a modest portrait preview; prompts and bounds stay shared.
const BACKGROUND_DEVICE_SETTINGS = Object.freeze({ width: 256, height: 384, steps: 12 });
const BACKGROUND_LIMITS = { promptChars: 240, outputBytes: 4 * 1024 * 1024, steps: 20, timeoutMs: 300000 };
// Per-model settings checked on this Mac with QVAC 0.22.0's sdcpp-generation.
const SETTINGS = {
  'sd-2.1-q8_0@ef8fa11863cc80ab078276f9a0bf81601e5ed904': { prediction: 'v', width: 512, height: 768 },
  'sdxl-1.0-q4_0@f00927e80a399ecb0bcacca868131d5e9d4e77aa': { width: 768, height: 1152 },
};
const BACKGROUND_MODELS = MODELS.filter((m) => m.capability === 'image' && SETTINGS[m.id]);
const TONES = { light: 'soft pale airy colours, light low-contrast', dark: 'deep muted colours, dark low-contrast' };
const NEGATIVE = 'text, letters, words, numbers, signature, watermark, logo, people, faces, hands, nsfw, nudity, gore, harsh contrast, busy detail';
const keys = (value, expected) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === expected;

function validateBackgroundInput(prompt) {
  let value;
  try { value = JSON.parse(prompt); } catch {}
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) > 1000 || !keys(value, 'prompt,tone') || !Object.hasOwn(TONES, value.tone) ||
      typeof value.prompt !== 'string' || !value.prompt.isWellFormed() || !value.prompt.trim() || [...value.prompt].length > BACKGROUND_LIMITS.promptChars ||
      /[\x00-\x1f\x7f]/.test(value.prompt)) {
    throw new CompanionError('INVALID_INPUT', 'Describe the background in at most 240 characters and choose a light or dark tone.');
  }
  return value;
}

/** The full text sent to the model: the user's words plus fixed background styling. */
function backgroundPrompt(value) {
  return `${value.prompt.trim()}. Abstract decorative background for a notes page, ${TONES[value.tone]}, gentle texture, plenty of empty space, no text`;
}

function pngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

class Background extends EventEmitter {
  constructor(runtime, { protector = null, directory = runtime.directory, totalMemory = os.totalmem } = {}) {
    super(); Object.assign(this, { runtime, protector, totalMemory });
    this.root = path.join(directory, 'image-output'); this.models = BACKGROUND_MODELS;
    this.state = { status: 'needs_download', detail: 'Download Stable Diffusion 2.1 to generate note backgrounds.' };
  }
  get settings() { return path.join(this.runtime.directory, 'image-assignment.json'); }
  files(model) { return artifactParts(model).map((part) => ({ part, file: path.join(this.runtime.directory, 'models', part.filename) })); }
  async installed(model) {
    for (const { file, part } of this.files(model)) {
      try { const stat = await fs.stat(file); if (!stat.isFile() || stat.size !== part.bytes) return false; } catch { return false; }
    }
    return true;
  }
  async initialize() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); await this.reconcile(); }
  /** Ready only for an assigned, installed model that fits this Mac and passed a real generation. */
  async reconcile() {
    if (this.busy) return;
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(this.settings, 'utf8')); } catch {}
    this.installedIds = [];
    for (const model of this.models) if (await this.installed(model)) this.installedIds.push(model.id);
    this.model = this.models.find((m) => m.id === saved.model) || null;
    const fits = this.model && this.totalMemory() >= this.model.memoryGB * 1024 ** 3 * 0.9;
    this.state = this.runtime.unsupported ? { status: 'incompatible', detail: this.runtime.unsupported }
      : !this.installedIds.length ? { status: 'needs_download', detail: 'Download Stable Diffusion 2.1 to generate note backgrounds.' }
      : !this.model ? { status: 'unassigned', detail: 'Assign a downloaded image model to backgrounds.' }
      : !this.installedIds.includes(this.model.id) ? { status: 'needs_download', detail: `${this.model.name} is assigned but not downloaded.` }
      : !fits ? { status: 'insufficient_memory', detail: `${this.model.name} needs about ${this.model.memoryGB} GB of memory; this Mac has ${Math.round(this.totalMemory() / 1024 ** 3)} GB. Choose Stable Diffusion 2.1.` }
      : saved.tested !== this.model.id ? { status: 'untested', detail: `${this.model.name} is assigned. Run the generation test to enable backgrounds.` }
      : { status: 'ready', detail: `${this.model.name} · test passed. Loads for each request (about 10 s) and generates in about 40 s.` };
    this.emit('change');
  }
  capability() {
    const settings = this.model && SETTINGS[this.model.id];
    return { id: 'image', implemented: true, model: this.model?.id || null, status: this.busy ? 'busy' : this.state.status, reason: this.state.detail,
      operations: [BACKGROUND_OPERATION], backgroundContract: 1, backgroundLimits: { promptChars: BACKGROUND_LIMITS.promptChars, steps: BACKGROUND_LIMITS.steps, ...(settings ? { width: settings.width, height: settings.height } : {}) } };
  }
  async assign(id) {
    if (this.busy || this.runtime.busy || this.runtime.reserved) throw new CompanionError('BUSY', 'Wait for accepted work to finish.');
    getModel(id);
    const model = this.models.find((m) => m.id === id);
    if (!model) throw new CompanionError('INCOMPATIBLE_MODEL', 'Choose a supported image generation model.');
    if (!await this.installed(model)) throw new CompanionError('MISSING_WEIGHTS', 'Download this image model first.');
    await this.write({ model: model.id });
    await this.reconcile(); return { ok: true };
  }
  async write(value) {
    await fs.writeFile(this.settings + '.tmp', JSON.stringify(value), { mode: 0o600 });
    await fs.rename(this.settings + '.tmp', this.settings);
  }
  /** Generates once; unloading the model is the only reliable stop in QVAC 0.22. */
  generate(value, { job = false, onProgress = () => {}, size = null, steps = BACKGROUND_LIMITS.steps, seed = randomBytes(4).readUInt32BE() & 0x7fffffff } = {}) {
    const model = this.model, settings = model && SETTINGS[model.id];
    return this.runtime.operation(async () => {
      if (!model || !['ready', 'untested'].includes(this.state.status)) throw new CompanionError('NOT_READY', this.state.detail);
      this.busy = true; this.emit('change');
      const sdk = await this.runtime.getSdk();
      let modelId = null, stopped = false;
      this.runtime.stopActive = async () => { stopped = true; if (modelId) { const id = modelId; modelId = null; await bounded(sdk.unloadModel({ modelId: id }), 15000).catch(() => {}); } };
      try {
        for (const { file, part } of this.files(model)) await verifyModel(file, () => {}, part);
        const [main] = this.files(model);
        modelId = await bounded(sdk.loadModel({ modelSrc: main.file, modelType: 'sdcpp-generation', modelConfig: { device: 'gpu', ...(settings.prediction ? { prediction: settings.prediction } : {}) } }), 120000);
        if (stopped) return { ok: false, error: { code: 'CANCELLED', message: 'Generation cancelled.' } };
        const width = size?.width ?? settings.width, height = size?.height ?? settings.height;
        const run = sdk.diffusion({ modelId, prompt: backgroundPrompt(value), negative_prompt: NEGATIVE, width, height, steps, cfg_scale: 7, seed, sampling_method: 'euler_a' });
        const [png] = await bounded((async () => {
          for await (const tick of run.progressStream) onProgress(tick.step, tick.totalSteps);
          return run.outputs;
        })(), BACKGROUND_LIMITS.timeoutMs);
        const bytes = Buffer.from(png || []);
        const actual = pngSize(bytes);
        if (!actual || actual.width !== width || actual.height !== height || bytes.length > BACKGROUND_LIMITS.outputBytes) throw new CompanionError('INVALID_OUTPUT', 'The image model returned an invalid image.');
        return { ok: true, bytes, width, height, seed, model: model.id };
      } catch (error) {
        if (stopped || this.runtime.cancelRequested) return { ok: false, error: { code: 'CANCELLED', message: 'Generation cancelled.' } };
        const failure = publicError(error);
        if (['WORKER_FAILED', 'RUNTIME_INSTALLATION'].includes(failure.code)) throw error;
        return { ok: false, error: error instanceof CompanionError ? { code: error.code, message: error.message } : { code: 'GENERATION_FAILED', message: 'The image model could not load or finish. Close memory-heavy apps and retry.' } };
      } finally {
        this.runtime.stopActive = null;
        if (modelId) await bounded(sdk.unloadModel({ modelId }), 15000).catch(() => {});
        this.busy = false; this.emit('change');
      }
    }, { job });
  }
  /** A small real generation; enables backgrounds only if it yields a valid image. */
  async selfTest() {
    if (!this.model || !['untested', 'ready', 'failed'].includes(this.state.status)) throw new CompanionError('NOT_READY', this.state.detail);
    const result = await this.generate({ prompt: 'pale blue watercolor wash', tone: 'light' }, { size: { width: 256, height: 256 }, steps: 4, seed: 1 });
    if (result.ok) await this.write({ model: this.model.id, tested: this.model.id });
    await this.reconcile();
    if (!result.ok) { this.state = { status: 'failed', detail: `The generation test failed (${result.error.code}). Backgrounds stay disabled.` }; this.emit('change'); }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  file(device, id) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(device) || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new CompanionError('INVALID_INPUT', 'Invalid image identity.');
    return path.join(this.root, `${device}-${id}.enc`);
  }
  async store(device, id, bytes) {
    const file = this.file(device, id), temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporary, await this.protector.encryptString(bytes.toString('base64')), { mode: 0o600 });
    await fs.rename(temporary, file);
    return createHash('sha256').update(bytes).digest('hex');
  }
  async result(device, id) {
    try { return await this.protector.decryptString(await fs.readFile(this.file(device, id))); }
    catch { throw new CompanionError('NOT_FOUND', 'This generated image is no longer kept on the computer. Generate again.'); }
  }
  /** Keeps outputs only for completed, unacknowledged, unexpired jobs. */
  async sweep(jobs, now = Date.now()) {
    const keep = new Set(Object.values(jobs).filter((j) => j.operation === BACKGROUND_OPERATION && j.state === 'completed' && !j.acknowledged && j.expires > now)
      .map((j) => path.basename(this.file(j.device, j.id))));
    let names = [];
    try { names = await fs.readdir(this.root); } catch { return; }
    for (const name of names) {
      if (keep.has(name)) continue;
      if (name.endsWith('.tmp')) { try { if (now - (await fs.stat(path.join(this.root, name))).mtimeMs < 300000) continue; } catch { continue; } }
      await fs.rm(path.join(this.root, name), { force: true });
    }
  }
}

module.exports = { Background, BACKGROUND_OPERATION, BACKGROUND_LIMITS, BACKGROUND_DEVICE_SETTINGS, BACKGROUND_MODELS, validateBackgroundInput, backgroundPrompt, pngSize, NEGATIVE };
