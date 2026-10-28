const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MODELS, getModel, verifyModel, CompanionError } = require('./model.cjs');
const { bounded } = require('./runtime.cjs');

// S03b: one bounded batch of texts in, one float32 vector per text out. The
// phone keeps the vectors; nothing here is retained once the job is
// acknowledged (jobs.cjs drops the prompt on completion and the vectors on ack).
const EMBED_OPERATION = 'embed';
// Eight 1024-dimension vectors in base64 stay well inside the phone's 64 KB response limit.
const EMBED_LIMITS = Object.freeze({ items: 8, textBytes: 4000, inputBytes: 24000 });
const EMBEDDING_MODELS = MODELS.filter((m) => m.capability === 'embedding');
const DEFAULT_EMBEDDING = EMBEDDING_MODELS[0];
const ITEM_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

function validateEmbedInput(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > EMBED_LIMITS.inputBytes) throw new CompanionError('INPUT_LIMIT', `Send at most ${EMBED_LIMITS.inputBytes} UTF-8 bytes per embedding batch.`);
  let input; try { input = JSON.parse(raw); } catch { throw new CompanionError('INVALID_INPUT', 'Invalid embedding batch.'); }
  if (!input || typeof input.model !== 'string' || !Array.isArray(input.items) || !input.items.length || input.items.length > EMBED_LIMITS.items
    || input.items.some((t) => !t || !ITEM_ID.test(t.id) || !['query', 'document'].includes(t.kind) || typeof t.text !== 'string' || !t.text.trim()
      || Buffer.byteLength(t.text) > EMBED_LIMITS.textBytes || CONTROL.test(t.text))
    || new Set(input.items.map((t) => t.id)).size !== input.items.length) {
    throw new CompanionError('INVALID_INPUT', `Send 1–${EMBED_LIMITS.items} uniquely identified texts of up to ${EMBED_LIMITS.textBytes} UTF-8 bytes.`);
  }
  return input;
}

/** The text the model sees: queries carry the model's task instruction. */
function embeddingText(model, item) {
  return item.kind === 'query' && model.queryInstruction ? `Instruct: ${model.queryInstruction}\nQuery:${item.text}` : item.text;
}

function encodeVector(values) {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => out.writeFloatLE(v, i * 4));
  return out.toString('base64');
}

class Embedder extends EventEmitter {
  constructor(runtime, { verify = verifyModel } = {}) {
    super(); this.runtime = runtime; this.verify = verify; this.status = 'unloaded'; this.model = DEFAULT_EMBEDDING; this.modelId = null;
    this.detail = 'Download and load an embedding model so phones can search by meaning.';
    runtime.on('sdkClosed', () => { if (!this.modelId) return; this.modelId = null; this.status = 'unloaded'; this.detail = 'The AI runtime restarted. Load the embedding model again.'; this.emit('change'); });
  }
  capability() {
    return { id: 'embedding', implemented: true, status: this.busy ? 'busy' : this.status, model: this.model.id, dimensions: this.model.dimensions,
      reason: this.detail, operations: [EMBED_OPERATION], limits: EMBED_LIMITS };
  }
  async initialize() {
    try { const saved = JSON.parse(await fs.readFile(path.join(this.runtime.directory, 'embedding.json'), 'utf8')); await this.load(saved.model); }
    catch (e) { if (e.code !== 'ENOENT') { this.status = 'failed'; this.detail = 'The embedding model could not load. Download it again, then load it.'; this.emit('change'); } }
  }
  async load(id = DEFAULT_EMBEDDING.id) {
    const model = getModel(id);
    if (model.capability !== 'embedding') throw new CompanionError('INCOMPATIBLE_MODEL', 'Choose an embedding model.');
    if (this.busy || this.loading) throw new CompanionError('BUSY', 'Wait for the embedding model to finish.');
    if (this.runtime.unsupported) throw new CompanionError('UNSUPPORTED_HOST', this.runtime.unsupported);
    this.loading = true; this.status = 'loading'; this.detail = `Verifying ${model.name}…`; this.emit('change');
    try {
      const file = path.join(this.runtime.directory, 'models', model.filename);
      await this.verify(file, () => {}, model);
      const sdk = await this.runtime.getSdk();
      if (this.modelId) { const old = this.modelId; this.modelId = null; await bounded(sdk.unloadModel({ modelId: old }), 15000); }
      this.modelId = await bounded(sdk.loadModel({ modelSrc: file, modelType: 'llamacpp-embedding', seed: false,
        modelConfig: { device: 'gpu', gpuLayers: 99, batchSize: 4096, embdNormalize: 2 } }));
      this.model = model; this.status = 'ready'; this.detail = `Ready · ${model.name} · ${model.dimensions} dimensions.`;
      await fs.writeFile(path.join(this.runtime.directory, 'embedding.json'), JSON.stringify({ model: model.id }), { mode: 0o600 });
      return { ok: true };
    } catch (e) {
      this.modelId = null; this.status = 'failed';
      this.detail = e instanceof CompanionError ? e.message : 'The embedding model could not load. Check the download and available memory.';
      throw e;
    } finally { this.loading = false; this.emit('change'); }
  }
  async unload() {
    if (this.busy) throw new CompanionError('BUSY', 'Wait for the current batch to finish.');
    if (this.modelId && this.runtime.sdk) { const id = this.modelId; this.modelId = null; await bounded(this.runtime.sdk.unloadModel({ modelId: id }), 15000); }
    this.modelId = null; this.status = 'unloaded'; this.detail = 'Embedding model unloaded. Phones fall back to keyword search.';
    await fs.rm(path.join(this.runtime.directory, 'embedding.json'), { force: true });
    this.emit('change'); return { ok: true };
  }
  /** Runs one validated batch. The phone names the model it indexes with; a different loaded model fails rather than mixing vectors. */
  async run(raw) {
    const input = validateEmbedInput(raw);
    if (this.status !== 'ready' || !this.modelId) return { ok: false, error: { code: 'NOT_READY', message: this.detail } };
    if (input.model !== this.model.id) return { ok: false, error: { code: 'MODEL_CHANGED', message: 'The computer now uses a different embedding model. The phone will rebuild its index.' } };
    if (this.busy) return { ok: false, error: { code: 'BUSY', message: 'Embedding is busy.' } };
    this.busy = true; this.emit('change');
    try {
      const sdk = await this.runtime.getSdk();
      const { embedding } = await bounded(sdk.embed({ modelId: this.modelId, text: input.items.map((item) => embeddingText(this.model, item)) }), 60000);
      if (!Array.isArray(embedding) || embedding.length !== input.items.length || embedding.some((v) => !Array.isArray(v) || v.length !== this.model.dimensions || v.some((x) => !Number.isFinite(x)))) {
        return { ok: false, error: { code: 'INVALID_OUTPUT', message: 'The embedding model returned vectors of the wrong shape.' } };
      }
      return { ok: true, text: JSON.stringify({ model: this.model.id, dimensions: this.model.dimensions,
        vectors: input.items.map((item, i) => ({ id: item.id, vector: encodeVector(embedding[i]) })) }) };
    } catch (e) {
      // A failed batch leaves the worker in an unknown state; reload explicitly.
      this.modelId = null; this.status = 'failed'; this.detail = 'The embedding model stopped. Load it again.';
      return { ok: false, error: { code: 'RUNTIME_FAILED', message: this.detail } };
    } finally { this.busy = false; this.emit('change'); }
  }
}
module.exports = { Embedder, EMBED_OPERATION, EMBED_LIMITS, EMBEDDING_MODELS, DEFAULT_EMBEDDING, validateEmbedInput, embeddingText, encodeVector };
