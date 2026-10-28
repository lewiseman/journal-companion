const { CONVERSATION_OPERATION, CONVERSATION_LIMITS, CONVERSATION_SYSTEM, conversationMessages, validateConversationInput, validateConversationOutput } = require('./conversation.cjs');
const { randomInt } = require('node:crypto');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { MODEL, getModel, CompanionError, verifyModel, downloadModel, downloadRegistryModel, readSelection, saveSelection } = require('./model.cjs');
const { SUMMARY_OPERATION, SUMMARY_LIMITS, SUMMARY_SYSTEM, validateSummaryInput, validateSummaryOutput } = require('./summary.cjs');

const { OPERATIONS, TRANSFORM_LIMITS, validateTransformInput, validateTransformOutput, transformSystem } = require('./transform.cjs');
const { PRESENTATION_OPERATION, PRESENTATION_LIMITS, PRESENTATION_SYSTEM, validatePresentationInput, validatePresentationOutput, presentationResponseFormat } = require('./presentation.cjs');
const { DIARY_OPERATION, DIARY_LIMITS, DIARY_SYSTEM, validateDiaryInput, validateDiaryOutput, diaryResponseFormat } = require('./diary.cjs');
const { QUESTION_OPERATION, QUESTION_LIMITS, QUESTION_SYSTEM, validateQuestionInput, validateQuestionOutput, questionResponseFormat } = require('./question.cjs');
const { HISTORY_OPERATION, HISTORY_LIMITS, HISTORY_SYSTEM, validateHistoryInput, validateHistoryOutput, historyResponseFormat } = require('./history.cjs');
const { REFLECTION_OPERATION, REFLECTION_LIMITS, REFLECTION_SYSTEM, validateReflectionInput, validateReflectionOutput } = require('./reflection.cjs');
const { NOTE_HELP } = require('./note-help.cjs');

function writingModel(id) {
  const model = getModel(id);
  if (model.capability !== 'text') throw new CompanionError('INCOMPATIBLE_MODEL', 'Image and speech models are download-only for now. Choose a writing model to load.');
  return model;
}

function hostProblem(platform = process.platform, arch = process.arch, release = os.release(), memory = os.totalmem()) {
  if (platform !== 'darwin' || arch !== 'arm64' || Number(release.split('.')[0]) < 23) {
    return 'This preview supports Apple Silicon Macs with macOS 14 or later. Linux, Windows and Intel Macs are not supported yet.';
  }
  if (memory < 4 * 1024 ** 3) return 'At least 4 GB of system memory is required. Close other applications if model loading fails.';
  return null;
}

function bounded(promise, ms = 90000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CompanionError('RUNTIME_TIMEOUT', 'The AI runtime stopped responding. Load the model again; restart the app if it keeps happening.')), ms);
  })]).finally(() => clearTimeout(timer));
}

function publicError(error) {
  if (error instanceof CompanionError) return { code: error.code, message: error.message };
  const code = String(error?.code || error?.name || '');
  if (/BARE_RUNTIME|WORKER_FILE|RPC_INIT|BareRuntimeBinaryNotFound/.test(code)) return {
    code: 'RUNTIME_INSTALLATION', message: 'The bundled AI runtime could not start. Rebuild or reinstall the Apple Silicon app; if it still fails, quit memory-heavy apps and try again.',
  };
  if (/WORKER|Worker|STREAM_ENDED|StreamEnded/.test(code)) return {
    code: 'WORKER_FAILED', message: 'The AI worker stopped unexpectedly. Your model is still on disk. Load it again; restart the app if this repeats.',
  };
  if (code === 'ENOSPC') return { code: 'DISK_FULL', message: 'The disk is full. Free some space, then try again.' };
  if (code === 'EACCES' || code === 'EPERM') return { code: 'ACCESS_DENIED', message: 'The app cannot access its model or settings. Select a readable model file or check folder permissions.' };
  return { code: 'RUNTIME_FAILED', message: 'The local model could not load or finish. Close memory-heavy apps and load it again. If this repeats, quit and reopen Journal Companion.' };
}

class Runtime extends EventEmitter {
  constructor(directory, { sdkFactory = () => import('@qvac/sdk'), checkHost = hostProblem, modelVerifier = verifyModel, modelDownloader = downloadModel, registryDownloader = downloadRegistryModel } = {}) {
    super(); this.directory = directory; this.sdkFactory = sdkFactory; this.checkHost = checkHost;
    this.state = { status: 'unavailable', detail: 'Choose how to add the model to get started.', selected: false, model: MODEL, host: `${process.platform} ${process.arch}`, error: null, progress: null };
    this.model = MODEL;
    this.verifyFile = modelVerifier; this.downloadFile = modelDownloader; this.downloadRegistry = registryDownloader;
    this.busy = false; this.modelId = null; this.sdk = null; this.file = null; this.closed = false;
  }
  snapshot() { return structuredClone(this.state); }
  update(patch) { Object.assign(this.state, patch); this.emit('state', this.snapshot()); }
  async initialize() {
    this.unsupported = this.checkHost();
    if (this.unsupported) return this.update({ status: 'unavailable', detail: this.unsupported, error: { code: 'UNSUPPORTED_HOST', message: this.unsupported } });
    try {
      const selection = await readSelection(this.directory, { details: true });
      this.file = selection?.path || null;
      this.model = writingModel(selection?.model.id || MODEL.id);
      this.update({ model: this.model });
      if (this.file) { this.update({ selected: true }); await this.load(); }
    } catch (error) { this.update({ status: 'failed', detail: publicError(error).message, error: publicError(error) }); }
  }
  async getSdk() {
    if (!this.sdk) {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const config = path.join(this.directory, 'runtime.json');
      await fs.writeFile(config, JSON.stringify({
        plugins: ['@qvac/sdk/llamacpp-completion/plugin', '@qvac/sdk/whispercpp-transcription/plugin', '@qvac/sdk/ggml-ocr/plugin', '@qvac/sdk/sdcpp-generation/plugin'], loggerConsoleOutput: false, loggerLevel: 'error',
        cacheDirectory: path.join(this.directory, 'runtime-cache'), requireHttpChecksum: true, requireSecureTransport: true,
      }), { mode: 0o600 });
      process.env.QVAC_CONFIG_PATH = config;
      this.sdk = await this.sdkFactory();
    }
    return this.sdk;
  }
  async operation(callback, { job = false } = {}) {
    if (this.closed || this.busy || this.audioReserved || (this.reserved && !job)) throw new CompanionError('BUSY', 'Wait for accepted work to finish.');
    if (this.unsupported) throw new CompanionError('UNSUPPORTED_HOST', this.unsupported);
    this.busy = true; this.stopMonitor();
    try { return await callback(); }
    catch (error) {
      this.modelId = null;
      await this.closeSdk();
      const failure = publicError(error);
      this.update({ status: 'failed', detail: failure.message, error: failure, progress: null });
      return { ok: false, error: failure };
    } finally {
      this.busy = false; this.activeRun = null; this.downloadAbort = null; this.cancelRequested = false;
      if (this.modelId && !this.closed) this.startMonitor();
      this.emit('state', this.snapshot());
    }
  }
  async loadVerified() {
    this.update({ status: 'loading', detail: 'Checking the complete model file…', error: null, progress: null });
    await this.verifyFile(this.file, () => {}, this.model);
    this.update({ detail: 'Loading the model into memory. This can take a moment.' });
    const sdk = await this.getSdk();
    this.modelId = await bounded(sdk.loadModel({
      modelSrc: this.file, modelType: 'llamacpp-completion', seed: false,
      modelConfig: { ctx_size: 4096, device: 'gpu', predict: 192, verbosity: 0,
        ...(this.model.reasoningBudget === 0 ? { reasoning_budget: 0 } : {}) },
    }));
    this.update({ status: 'ready', detail: 'Ready for a local text request. No internet needed.', selected: true, error: null });
    return { ok: true };
  }
  load(id = this.model.id) { const model = writingModel(id); return this.operation(async () => {
    if (model.id !== this.model.id || !this.file) {
      const file = path.join(this.directory, 'models', model.filename);
      this.update({ status: 'loading', detail: `Checking ${model.name}…`, error: null });
      await this.verifyFile(file, () => {}, model);
      await this.release();
      await saveSelection(this.directory, file, model);
      this.file = file; this.model = model;
      this.update({ model, selected: true });
    }
    if (this.modelId) return { ok: true };
    if (!this.file) throw new CompanionError('MISSING_WEIGHTS', 'Download the model or select the supported GGUF file first.');
    return this.loadVerified();
  }); }
  select(file, id = this.model.id) { const model = writingModel(id); return this.operation(async () => {
    this.update({ status: 'loading', detail: 'Verifying the selected model…', error: null });
    await this.verifyFile(file, () => {}, model);
    await this.release();
    await saveSelection(this.directory, file, model);
    this.file = file; this.model = model; this.update({ selected: true, model });
    return this.loadVerified();
  }); }
  download(autoLoad = true, id = this.model.id) { const model = writingModel(id); return this.operation(async () => {
    await this.release();
    this.downloadAbort = new AbortController();
    this.update({ status: 'loading', detail: `Downloading ${model.name} from Hugging Face…`, error: null, progress: 0 });
    let last = 0;
    const file = await this.downloadFile(path.join(this.directory, 'models'), (progress) => {
      if (Date.now() - last > 150 || progress === 1) { last = Date.now(); this.update({ progress }); }
    }, this.downloadAbort.signal, { model });
    await saveSelection(this.directory, file, model); this.file = file; this.model = model;
    this.update({ selected: true, model, progress: null });
    if (autoLoad) return this.loadVerified();
    this.update({ status: 'unavailable', detail: 'Download verified. Load the model when you need it.' });
    return { ok: true };
  }); }
  generate(prompt, { job = false, operation = 'text', onToken = null } = {}) {
    if (Object.hasOwn(NOTE_HELP, operation)) return this.generateStructured(prompt, NOTE_HELP[operation], { job });
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > (operation === CONVERSATION_OPERATION ? CONVERSATION_LIMITS.inputBytes : 2000)) {
      throw new CompanionError('INVALID_INPUT', 'Enter a short request of up to 2,000 UTF-8 bytes.');
    }
    const conversation = operation === CONVERSATION_OPERATION;
    if (conversation) validateConversationInput(prompt);
    const summary = operation === SUMMARY_OPERATION;
    if (summary) validateSummaryInput(prompt);
    const presentation = operation === PRESENTATION_OPERATION, diary = operation === DIARY_OPERATION, question = operation === QUESTION_OPERATION, history = operation === HISTORY_OPERATION;
    const reflection = operation === REFLECTION_OPERATION;
    const transform = Object.hasOwn(OPERATIONS, operation), boundedText = conversation || summary || transform || presentation || diary || question || history || reflection;
    const limits = reflection ? REFLECTION_LIMITS : conversation ? CONVERSATION_LIMITS : history ? HISTORY_LIMITS : question ? QUESTION_LIMITS : diary ? DIARY_LIMITS : presentation ? PRESENTATION_LIMITS : transform ? TRANSFORM_LIMITS : SUMMARY_LIMITS;
    if (transform) validateTransformInput(prompt, operation);
    if (presentation) validatePresentationInput(prompt);
    if (diary) validateDiaryInput(prompt);
    if (question) validateQuestionInput(prompt);
    if (history) validateHistoryInput(prompt);
    if (reflection) validateReflectionInput(prompt);
    return this.operation(async () => {
      if (!this.modelId || this.state.status !== 'ready') throw new CompanionError('NOT_READY', 'Load the model before sending a request.');
      this.cancelRequested = false;
      this.update({ status: 'working', detail: 'Writing on this Mac…', error: null });
      const run = this.sdk.completion({
        modelId: this.modelId, history: conversation ? conversationMessages(prompt) : [
          { role: 'system', content: reflection ? REFLECTION_SYSTEM : conversation ? CONVERSATION_SYSTEM : history ? HISTORY_SYSTEM : question ? QUESTION_SYSTEM : diary ? DIARY_SYSTEM : presentation ? PRESENTATION_SYSTEM : transform ? transformSystem(operation) : summary ? SUMMARY_SYSTEM : 'You are a helpful writing assistant. Give a brief, clear answer.' },
          { role: 'user', content: reflection ? JSON.stringify({ thought: prompt }) : conversation || transform || presentation || diary || question || history ? prompt : summary ? JSON.stringify({ note: prompt }) : prompt.trim() },
        ], stream: true, kvCache: false,
        ...(presentation ? { responseFormat: presentationResponseFormat(prompt) } : diary ? { responseFormat: diaryResponseFormat() } : question ? { responseFormat: questionResponseFormat() } : history ? { responseFormat: historyResponseFormat() } : {}),
        // Questions and reflections vary so that asking again gives a fresh one;
        // other bounded operations stay deterministic. Phone checks still apply.
        generationParams: { predict: limits.outputTokens, temp: question ? 0.7 : reflection ? 0.4 : boundedText ? 0 : 0.4, seed: question || reflection ? randomInt(2 ** 31) : 42,
          ...(this.model.reasoningBudget === 0 ? { reasoning_budget: 0 } : {}) },
      });
      this.activeRun = run;
      let text = '', stopReason;
      try {
        await bounded((async () => {
          for await (const token of run.tokenStream) {
            if (typeof token !== 'string') throw new CompanionError('INVALID_OUTPUT', 'The model returned invalid text.');
            text += token;
            if (boundedText && Buffer.byteLength(text) > limits.outputBytes) {
              await this.cancelGeneration();
              throw new CompanionError('INVALID_OUTPUT', 'The result exceeded the output limit. Retry explicitly.');
            }
            if (onToken) onToken(token); else if (!job) this.emit('token', token);
          }
          await run.text;
          if (boundedText && run.final) stopReason = (await run.final).stopReason;
        })());
      } catch (error) {
        if (error.code === 'INVALID_OUTPUT' || !this.cancelRequested || !this.modelId || this.closed) throw error;
        // Cancellation is routine. Verify the model/worker survived before
        // advertising readiness; a concurrent worker failure still fails closed.
        await bounded(this.sdk.getLoadedModelInfo({ modelId: this.modelId }), 5000);
        this.update({ status: 'ready', detail: 'Request cancelled. The writing model is still ready.', error: null });
        return { ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } };
      }
      this.activeRun = null;
      this.update({ status: 'ready', detail: 'Finished locally. You can send another request.' });
      if (boundedText) {
        if (stopReason === 'length') return { ok: false, error: { code: 'OUTPUT_LIMIT', message: `The result reached its ${limits.outputTokens}-token limit. No partial result was returned; try a shorter passage.` } };
        if (stopReason === 'cancelled') return { ok: false, error: { code: 'CANCELLED', message: 'Summary cancelled.' } };
        try { text = reflection ? validateReflectionOutput(text) : conversation ? validateConversationOutput(text, prompt) : history ? validateHistoryOutput(text) : question ? validateQuestionOutput(text) : diary ? validateDiaryOutput(text) : presentation ? validatePresentationOutput(text) : transform ? validateTransformOutput(text) : validateSummaryOutput(text); }
        catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
      }
      return { ok: true, text };
    }, { job });
  }
  // One bounded grammar-constrained JSON request described by [spec]
  // (limits, system, validateInput/Output, responseFormat, params).
  generateStructured(prompt, spec, { job = false } = {}) {
    spec.validateInput(prompt);
    return this.operation(async () => {
      if (!this.modelId || this.state.status !== 'ready') throw new CompanionError('NOT_READY', 'Load the model before sending a request.');
      this.cancelRequested = false;
      this.update({ status: 'working', detail: 'Writing on this Mac…', error: null });
      const run = this.sdk.completion({
        modelId: this.modelId, history: [{ role: 'system', content: spec.system }, { role: 'user', content: prompt }],
        stream: true, kvCache: false, responseFormat: spec.responseFormat(),
        generationParams: { predict: spec.limits.outputTokens, ...spec.params(),
          ...(this.model.reasoningBudget === 0 ? { reasoning_budget: 0 } : {}) },
      });
      this.activeRun = run;
      let text = '', stopReason;
      try {
        await bounded((async () => {
          for await (const token of run.tokenStream) {
            if (typeof token !== 'string') throw new CompanionError('INVALID_OUTPUT', 'The model returned invalid text.');
            text += token;
            if (Buffer.byteLength(text) > spec.limits.outputBytes) {
              await this.cancelGeneration();
              throw new CompanionError('INVALID_OUTPUT', 'The result exceeded the output limit. Retry explicitly.');
            }
          }
          await run.text;
          if (run.final) stopReason = (await run.final).stopReason;
        })());
      } catch (error) {
        if (error.code === 'INVALID_OUTPUT' || !this.cancelRequested || !this.modelId || this.closed) throw error;
        await bounded(this.sdk.getLoadedModelInfo({ modelId: this.modelId }), 5000);
        this.update({ status: 'ready', detail: 'Request cancelled. The writing model is still ready.', error: null });
        return { ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } };
      }
      this.activeRun = null;
      this.update({ status: 'ready', detail: 'Finished locally. You can send another request.' });
      if (stopReason === 'length') return { ok: false, error: { code: 'OUTPUT_LIMIT', message: `The result reached its ${spec.limits.outputTokens}-token limit. No partial result was returned.` } };
      if (stopReason === 'cancelled') return { ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } };
      try { return { ok: true, text: spec.validateOutput(text) }; }
      catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
    }, { job });
  }
  async cancelGeneration() {
    // Work that cannot be cancelled by request ID (image generation) installs its own stop.
    if (this.stopActive) { this.cancelRequested = true; return this.stopActive(); }
    if (this.activeRun?.requestId && this.sdk) {
      this.cancelRequested = true;
      try { await bounded(this.sdk.cancel({ requestId: this.activeRun.requestId }), 5000); } catch { await this.closeSdk(); }
    }
  }
  async release() {
    if (this.modelId && this.sdk) {
      const id = this.modelId; this.modelId = null;
      await bounded(this.sdk.unloadModel({ modelId: id }), 15000);
    }
    await this.closeSdk();
  }
  unload() { return this.operation(async () => {
    this.update({ status: 'loading', detail: 'Releasing the model from memory…', error: null });
    await this.release();
    this.update({ status: 'unavailable', detail: 'Model unloaded. Load it when you need it.', error: null });
    return { ok: true };
  }); }
  reserveAudio() { this.audioReserved = true; this.stopMonitor(); }
  releaseAudio() {
    this.audioReserved = false;
    if (this.modelId && !this.closed && !this.busy) this.startMonitor();
  }
  stopMonitor() {
    this.monitorGeneration = (this.monitorGeneration || 0) + 1;
    clearInterval(this.monitor); this.monitor = null;
  }
  async checkHealth(generation = this.monitorGeneration) {
    if (this.busy || this.audioReserved || this.checking || !this.modelId || !this.sdk || this.closed) return;
    this.checking = true;
    const checkedId = this.modelId, checkedSdk = this.sdk;
    try { await bounded(checkedSdk.getLoadedModelInfo({ modelId: checkedId }), 10000); }
    catch (cause) {
      // A probe started before audio/loading is no longer evidence about an
      // idle worker, even if its delayed failure arrives after audio releases.
      if (generation === this.monitorGeneration && !this.busy && !this.audioReserved && !this.closed && this.modelId === checkedId && this.sdk === checkedSdk) {
        this.modelId = null; this.stopMonitor(); await this.closeSdk();
        const error = { ...publicError({ code: 'WORKER_FAILED' }), source: 'idle-health-check',
          cause: String(cause?.code || cause?.name || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) };
        this.update({ status: 'failed', detail: error.message, error });
      }
    } finally { this.checking = false; }
  }
  startMonitor() {
    this.stopMonitor();
    const generation = this.monitorGeneration;
    this.monitor = setInterval(() => this.checkHealth(generation), 4000);
    this.monitor.unref();
  }
  async closeSdk() { if (this.sdk) { this.emit('sdkClosed'); const sdk = this.sdk; this.sdk = null; try { await bounded(sdk.close(), 5000); } catch {} } }
  async shutdown() {
    this.closed = true; this.stopMonitor(); this.downloadAbort?.abort();
    // close() terminates Bare even when a native load/completion is stuck.
    if (this.busy) { await this.closeSdk(); return; }
    try { await this.release(); } finally { await this.closeSdk(); }
  }
}
module.exports = { Runtime, hostProblem, publicError, bounded };
