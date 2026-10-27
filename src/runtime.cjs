const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { MODEL, CompanionError, verifyModel, downloadModel, readSelection, saveSelection } = require('./model.cjs');

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
  constructor(directory, { sdkFactory = () => import('@qvac/sdk'), checkHost = hostProblem } = {}) {
    super(); this.directory = directory; this.sdkFactory = sdkFactory; this.checkHost = checkHost;
    this.state = { status: 'unavailable', detail: 'Choose how to add the model to get started.', selected: false, model: MODEL, host: `${process.platform} ${process.arch}`, error: null, progress: null };
    this.busy = false; this.modelId = null; this.sdk = null; this.file = null; this.closed = false;
  }
  snapshot() { return structuredClone(this.state); }
  update(patch) { Object.assign(this.state, patch); this.emit('state', this.snapshot()); }
  async initialize() {
    this.unsupported = this.checkHost();
    if (this.unsupported) return this.update({ status: 'unavailable', detail: this.unsupported, error: { code: 'UNSUPPORTED_HOST', message: this.unsupported } });
    try {
      this.file = await readSelection(this.directory);
      if (this.file) { this.update({ selected: true }); await this.load(); }
    } catch (error) { this.update({ status: 'failed', detail: publicError(error).message, error: publicError(error) }); }
  }
  async getSdk() {
    if (!this.sdk) {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const config = path.join(this.directory, 'runtime.json');
      await fs.writeFile(config, JSON.stringify({
        plugins: ['@qvac/sdk/llamacpp-completion/plugin'], loggerConsoleOutput: false, loggerLevel: 'error',
        cacheDirectory: path.join(this.directory, 'runtime-cache'), requireHttpChecksum: true, requireSecureTransport: true,
      }), { mode: 0o600 });
      process.env.QVAC_CONFIG_PATH = config;
      this.sdk = await this.sdkFactory();
    }
    return this.sdk;
  }
  async operation(callback) {
    if (this.closed || this.busy) throw new CompanionError('BUSY', 'Wait for the current operation to finish.');
    if (this.unsupported) throw new CompanionError('UNSUPPORTED_HOST', this.unsupported);
    this.busy = true; this.stopMonitor();
    try { return await callback(); }
    catch (error) {
      this.modelId = null;
      await this.closeSdk();
      const failure = publicError(error);
      this.update({ status: 'failed', detail: failure.message, error: failure, progress: null });
      return { ok: false, error: failure };
    } finally { this.busy = false; if (this.modelId && !this.closed) this.startMonitor(); }
  }
  async loadVerified() {
    this.update({ status: 'loading', detail: 'Checking the complete model file…', error: null, progress: null });
    await verifyModel(this.file);
    this.update({ detail: 'Loading the model into memory. This can take a moment.' });
    const sdk = await this.getSdk();
    this.modelId = await bounded(sdk.loadModel({
      modelSrc: this.file, modelType: 'llamacpp-completion', seed: false,
      modelConfig: { ctx_size: 4096, device: 'gpu', predict: 192, verbosity: 0 },
    }));
    this.update({ status: 'ready', detail: 'Ready for a local text request. No internet needed.', selected: true, error: null });
    return { ok: true };
  }
  load() { return this.operation(async () => {
    if (this.modelId) return { ok: true };
    if (!this.file) throw new CompanionError('MISSING_WEIGHTS', 'Download the model or select the supported GGUF file first.');
    return this.loadVerified();
  }); }
  select(file) { return this.operation(async () => {
    this.update({ status: 'loading', detail: 'Verifying the selected model…', error: null });
    await verifyModel(file);
    await this.release();
    await saveSelection(this.directory, file);
    this.file = file; this.update({ selected: true });
    return this.loadVerified();
  }); }
  download() { return this.operation(async () => {
    await this.release();
    this.downloadAbort = new AbortController();
    this.update({ status: 'loading', detail: 'Downloading the model from Hugging Face…', error: null, progress: 0 });
    let last = 0;
    const file = await downloadModel(path.join(this.directory, 'models'), (progress) => {
      if (Date.now() - last > 150 || progress === 1) { last = Date.now(); this.update({ progress }); }
    }, this.downloadAbort.signal);
    await saveSelection(this.directory, file); this.file = file;
    this.update({ selected: true, progress: null });
    return this.loadVerified();
  }); }
  generate(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > 2000) {
      throw new CompanionError('INVALID_INPUT', 'Enter a short request of up to 2,000 UTF-8 bytes.');
    }
    return this.operation(async () => {
      if (!this.modelId || this.state.status !== 'ready') throw new CompanionError('NOT_READY', 'Load the model before sending a request.');
      this.update({ status: 'working', detail: 'Writing on this Mac…', error: null });
      const run = this.sdk.completion({
        modelId: this.modelId, history: [
          { role: 'system', content: 'You are a helpful writing assistant. Give a brief, clear answer.' },
          { role: 'user', content: prompt.trim() },
        ], stream: true, kvCache: false,
        generationParams: { predict: 192, temp: 0.4, seed: 42 },
      });
      this.activeRun = run;
      let text = '';
      await bounded((async () => {
        for await (const token of run.tokenStream) { text += token; this.emit('token', token); }
        await run.text;
      })());
      this.activeRun = null;
      this.update({ status: 'ready', detail: 'Finished locally. You can send another request.' });
      return { ok: true, text };
    });
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
    this.update({ status: 'unavailable', detail: 'Model unloaded. Load it when you want to write.', error: null });
    return { ok: true };
  }); }
  stopMonitor() { clearInterval(this.monitor); this.monitor = null; }
  startMonitor() {
    this.stopMonitor();
    this.monitor = setInterval(async () => {
      if (this.busy || this.checking || !this.modelId) return;
      this.checking = true;
      const checkedId = this.modelId;
      try { await bounded(this.sdk.getLoadedModelInfo({ modelId: checkedId }), 10000); }
      catch {
        if (!this.busy && !this.closed && this.modelId === checkedId) {
          this.modelId = null; this.stopMonitor(); await this.closeSdk();
          const error = publicError({ code: 'WORKER_FAILED' });
          this.update({ status: 'failed', detail: error.message, error });
        }
      } finally { this.checking = false; }
    }, 4000);
    this.monitor.unref();
  }
  async closeSdk() { if (this.sdk) { try { await bounded(this.sdk.close(), 5000); } catch {} } }
  async shutdown() {
    this.closed = true; this.stopMonitor(); this.downloadAbort?.abort();
    // close() terminates Bare even when a native load/completion is stuck.
    if (this.busy) { await this.closeSdk(); return; }
    try { await this.release(); } finally { await this.closeSdk(); }
  }
}
module.exports = { Runtime, hostProblem, publicError, bounded };
