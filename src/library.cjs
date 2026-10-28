const { CONVERSATION_OPERATION, CONVERSATION_LIMITS, validateConversationInput, validateConversationOutput } = require('./conversation.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MODEL, MODELS, getModel, artifactParts, CompanionError, verifyModel, saveSelection } = require('./model.cjs');
const { OPERATIONS, TRANSFORM_LIMITS } = require('./transform.cjs');
const { SUMMARY_OPERATION, SUMMARY_LIMITS } = require('./summary.cjs');
const { PRESENTATION_OPERATION, PRESENTATION_LIMITS } = require('./presentation.cjs');
const { DIARY_OPERATION, DIARY_LIMITS } = require('./diary.cjs');
const { QUESTION_OPERATION, QUESTION_LIMITS } = require('./question.cjs');
const { REFLECTION_OPERATION, REFLECTION_LIMITS } = require('./reflection.cjs');
const { HISTORY_OPERATION, HISTORY_LIMITS } = require('./history.cjs');
const { NOTE_HELP, NOTE_HELP_LIMITS } = require('./note-help.cjs');

const MODEL_KEY = MODEL.id;
class Library extends EventEmitter {
  constructor(runtime) {
    super();
    this.runtime = runtime; this.installed = false; this.owned = false; this.partial = 0; this.assignment = MODEL_KEY;
    this.models = []; this.verified = new Map(); this.download = null; this.downloading = false;
  }
  async initialize() {
    await fs.mkdir(this.runtime.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.runtime.directory, 'assignment.json');
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      this.assignment = MODELS.some((model) => model.id === saved.text && model.capability === 'text') ? saved.text : null;
    } catch (e) {
      if (e.code !== 'ENOENT') this.assignment = null;
      else { this.assignment = this.runtime.model?.capability === 'text' ? this.runtime.model.id : MODEL_KEY; await this.saveAssignment(this.assignment); }
    }
    await this.reconcile();
  }
  async reconcile() {
    const model = this.runtime.model || MODEL;
    const owned = path.join(this.runtime.directory, 'models', model.filename);
    this.models = [];
    for (const candidate of MODELS) {
      let installed = true, partialBytes = 0, owned = true;
      // A bundled model is installed only when every one of its files verifies.
      for (const part of artifactParts(candidate)) {
        const local = path.join(this.runtime.directory, 'models', part.filename);
        const file = candidate.id === model.id && this.runtime.file ? this.runtime.file : local;
        try {
          const stat = await fs.stat(file);
          const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
          if (this.verified.get(file) !== stamp) {
            await (this.runtime.verifyFile || verifyModel)(file, () => {}, part); this.verified.set(file, stamp);
          }
        } catch { this.verified.delete(file); installed = false; }
        try { partialBytes += (await fs.stat(local + '.partial')).size; } catch {}
        owned &&= file === local;
      }
      this.models.push({ ...candidate, installed, partialBytes, owned: installed && owned });
    }
    const current = this.models.find((entry) => entry.id === model.id);
    this.installed = current.installed; this.owned = current.owned; this.partial = current.partialBytes;
    if (!this.runtime.file) {
      if (this.installed) {
        await saveSelection(this.runtime.directory, owned, model);
        this.runtime.file = owned;
        this.runtime.update({ selected: true, detail: 'Verified installed model. Load it when you need it.' });
      }
    }
    if (model.capability === 'text' && this.assignment && this.assignment !== model.id) {
      await this.saveAssignment(model.id); this.assignment = model.id;
    }
  }
  snapshot() {
    const r = this.runtime;
    const model = r.model || MODEL;
    return { models: this.models.map((entry) => ({ ...entry, loaded: entry.id === model.id && !!r.modelId })),
      model: { ...model, installed: this.installed,
      partialBytes: this.partial, owned: this.owned, loaded: !!r.modelId, fit: r.modelId ? 'Loaded successfully on this Mac' : 'Unknown until load',
      guidance: `Apple Silicon, macOS 14+. Suggested system memory: ${model.memoryGB} GB or more. Runtime may fail under memory pressure.` },
      text: this.capability(), download: this.download, assignment: this.assignment };
  }
  capability() {
    const r = this.runtime;
    const assigned = this.assignment === (r.model || MODEL).id;
    const status = !assigned ? 'unassigned' : r.unsupported ? 'incompatible' : r.state.status === 'failed' ? 'failed'
      : r.audioReserved ? 'busy' : r.busy ? (r.state.status === 'working' ? 'busy' : 'loading') : r.modelId ? 'ready' : !this.installed ? 'needs_download' : 'unloaded';
    return { id: 'text', implemented: true, model: this.assignment, status, reason: !this.assignment ? 'Assign the installed writing model.' : r.state.detail,
      operations: [CONVERSATION_OPERATION, 'text', SUMMARY_OPERATION, ...Object.keys(OPERATIONS), PRESENTATION_OPERATION, DIARY_OPERATION, QUESTION_OPERATION, HISTORY_OPERATION, ...Object.keys(NOTE_HELP), REFLECTION_OPERATION], summaryLimits: SUMMARY_LIMITS, transformLimits: TRANSFORM_LIMITS, presentationContract: 1, presentationLimits: PRESENTATION_LIMITS, diaryContract: 1, diaryLimits: DIARY_LIMITS, questionContract: 1, questionLimits: QUESTION_LIMITS, historyContract: 1, historyLimits: HISTORY_LIMITS, reflectionContract: 1, reflectionLimits: REFLECTION_LIMITS,
      noteHelpContract: 1, noteHelpLimits: NOTE_HELP_LIMITS };
  }
  async assign(id) {
    if (this.runtime.busy || this.runtime.reserved) throw new CompanionError('BUSY', 'Wait for accepted work to finish.');
    if (getModel(id).capability !== 'text') throw new CompanionError('INCOMPATIBLE_MODEL', 'Image and speech models cannot be assigned to writing.');
    if (id !== (this.runtime.model || MODEL).id || !this.installed) throw new CompanionError('INCOMPATIBLE_MODEL', 'Load an installed, verified writing model before assigning it.');
    await this.saveAssignment(id); this.assignment = id;
  }
  downloadArtifact(id) {
    const model = getModel(id);
    if (model.capability === 'text') throw new CompanionError('INCOMPATIBLE_MODEL', 'Use the writing model download action for this model.');
    if (this.downloading || this.runtime.downloadAbort) throw new CompanionError('BUSY', 'Wait for the current download to finish.');
    this.downloading = true; this.downloadAbort = new AbortController();
    this.download = { model: model.id, status: 'downloading', progress: 0, error: null }; this.emit('change');
    this.downloadPromise = (async () => {
      try {
        let last = 0;
        const transfer = model.source === 'registry' ? this.runtime.downloadRegistry : this.runtime.downloadFile;
        await transfer(path.join(this.runtime.directory, 'models'), (progress) => {
          if (Date.now() - last > 150 || progress === 1) {
            last = Date.now(); this.download.progress = progress; this.emit('change');
          }
        }, this.downloadAbort.signal, { model });
        await this.reconcile();
        this.download = { model: model.id, status: 'installed', progress: null, error: null };
        return { ok: true };
      } catch (error) {
        this.download = { model: model.id, status: 'failed', progress: null,
          error: error instanceof CompanionError ? error.message : 'Download failed. Check disk space and try again.' };
        throw error;
      } finally { this.downloading = false; this.downloadAbort = null; this.emit('change'); }
    })();
    return this.downloadPromise;
  }
  async shutdown() { this.downloadAbort?.abort(); try { await this.downloadPromise; } catch {} }
  async saveAssignment(id) {
    const file = path.join(this.runtime.directory, 'assignment.json');
    await fs.writeFile(file + '.tmp', JSON.stringify({ text: id }), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  async remove() {
    const r = this.runtime;
    if (r.modelId || r.busy || r.reserved) throw new CompanionError('BUSY', 'Unload the model and finish accepted work before removal.');
    if (!this.owned) throw new CompanionError('EXTERNAL_MODEL', 'External files are managed by their owner. Journal never deletes them.');
    const model = r.model || MODEL;
    const owned = path.join(r.directory, 'models', model.filename);
    if ((await fs.lstat(path.dirname(owned))).isSymbolicLink()) throw new CompanionError('ACCESS_DENIED', 'The model directory must not be a link.');
    await fs.rm(owned, { force: true }); await fs.rm(owned + '.partial', { force: true });
    await saveSelection(r.directory, null, model); r.file = null;
    r.update({ selected: false, status: 'unavailable', detail: 'Model removed. Download or select a model to use local AI.' });
    await this.reconcile();
  }
}
module.exports = { Library, MODEL_KEY };
