const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { getModel, MODELS, verifyModel, CompanionError } = require('./model.cjs');
const { bounded } = require('./runtime.cjs');
const DEFAULT_SPEECH = MODELS.find((m) => m.filename === 'ggml-large-v3-turbo.bin');
const VAD = MODELS.find((m) => m.filename === 'ggml-silero-v5.1.2.bin');

class Speech extends EventEmitter {
  constructor(runtime) {
    super(); this.runtime = runtime; this.status = 'unloaded'; this.model = DEFAULT_SPEECH; this.detail = 'Load Whisper and Silero VAD to capture speech from Android.';
    runtime.on('sdkClosed', () => { this.modelId = null; this.status = 'unloaded'; this.detail = 'Writing runtime changed. Load speech again.'; this.emit('change'); });
  }
  capability() { return { id: 'transcription', implemented: true, status: this.busy ? 'busy' : this.status, model: this.model.id,
    reason: this.detail, operations: ['voice.transcribe'], live: 1, format: 's16le', sampleRate: 16000, channels: 1,
    languages: ['en'], maxSeconds: 600 }; }
  async initialize() {
    try { const data = JSON.parse(await fs.readFile(path.join(this.runtime.directory, 'speech.json'), 'utf8')); await this.load(data.model); }
    catch (e) { if (e.code !== 'ENOENT') { this.detail = 'Speech could not load. Download Whisper and Silero VAD, then load speech.'; this.emit('change'); } }
  }
  async load(id = DEFAULT_SPEECH.id) {
    if (this.busy || this.loading || this.runtime.busy) throw new CompanionError('BUSY', 'Finish current work before loading speech.');
    const model = getModel(id);
    if (model.engine !== 'whispercpp-transcription' || model.id === VAD.id || model.filename.includes('.en-')) throw new CompanionError('INCOMPATIBLE_MODEL', 'Choose a multilingual Whisper model.');
    this.loading = true; this.runtime.reserveAudio(); this.status = 'loading'; this.detail = 'Verifying Whisper and Silero VAD…'; this.emit('change');
    try {
      if (this.runtime.unsupported) throw new CompanionError('UNSUPPORTED_HOST', this.runtime.unsupported);
      const file = path.join(this.runtime.directory, 'models', model.filename), vad = path.join(this.runtime.directory, 'models', VAD.filename);
      await verifyModel(file, () => {}, model); await verifyModel(vad, () => {}, VAD);
      const sdk = await this.runtime.getSdk();
      if (this.modelId) await bounded(sdk.unloadModel({ modelId: this.modelId }), 15000);
      this.modelId = null;
      this.modelId = await bounded(sdk.loadModel({ modelSrc: file, modelType: 'whispercpp-transcription', seed: false,
        modelConfig: { vadModelSrc: vad, audio_format: 's16le', language: 'en', translate: false, no_context: true,
          strategy: 'greedy', single_segment: true, n_threads: 4, suppress_blank: true, suppress_nst: true, temperature: 0,
          contextParams: { use_gpu: true, flash_attn: true },
          vad_params: { threshold: .6, min_speech_duration_ms: 250, min_silence_duration_ms: 350, max_speech_duration_s: 8, speech_pad_ms: 120 } } }));
      this.model = model; this.status = 'ready'; this.detail = 'Ready · Android microphone · English · text appears after speech pauses.';
      await fs.writeFile(path.join(this.runtime.directory, 'speech.json'), JSON.stringify({ model: id }), { mode: 0o600 });
      return { ok: true };
    } catch (e) { this.status = 'failed'; this.detail = e instanceof CompanionError ? e.message : 'Speech load failed. Check Whisper and Silero VAD downloads and available memory.'; throw e; }
    finally { this.loading = false; this.runtime.releaseAudio(); this.emit('change'); }
  }
  async open() {
    if (this.busy || this.loading || this.runtime.busy) throw new CompanionError('BUSY', 'The computer is processing another request. Retry shortly.');
    if (!this.modelId || this.status !== 'ready') throw new CompanionError('NOT_READY', this.detail);
    this.busy = true; this.runtime.reserveAudio(); this.emit('change');
    try {
      const sdk = await this.runtime.getSdk();
      await bounded(sdk.getLoadedModelInfo({ modelId: this.modelId }), 5000);
      const session = await bounded(sdk.transcribeStream({ modelId: this.modelId, metadata: true }), 15000);
      // Whisper VAD starts a fresh decoder at every utterance, so native IDs
      // and timestamps restart at zero. Each single_segment emission is a final
      // utterance. Give it a session-wide identity before sending it to clients.
      let next = 0;
      return {
        write: (pcm) => session.write(pcm), end: () => session.end(), destroy: () => session.destroy(), stats: session.stats,
        async *[Symbol.asyncIterator]() { for await (const segment of session) yield { ...segment, id: next++, append: false }; },
      };
    } catch (e) { this.release(); this.modelId = null; this.status = 'failed'; this.detail = 'Speech worker stopped. Load speech again.'; throw e; }
  }
  release() { this.busy = false; this.runtime.releaseAudio(); this.emit('change'); }
}
module.exports = { Speech, DEFAULT_SPEECH, VAD };
