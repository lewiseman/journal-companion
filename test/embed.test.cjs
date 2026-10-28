const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const { Jobs } = require('../src/jobs.cjs');
const { Embedder, EMBED_OPERATION, EMBED_LIMITS, EMBEDDING_MODELS, validateEmbedInput, embeddingText, encodeVector } = require('../src/embed.cjs');

const [qwen, qwenF16] = EMBEDDING_MODELS;
const decode = (b64) => { const buf = Buffer.from(b64, 'base64'); return Array.from({ length: buf.length / 4 }, (_, i) => buf.readFloatLE(i * 4)); };
const batch = (items, model = qwen.id) => JSON.stringify({ model, items });

async function embedder(t, { vector = (text, i) => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0)) } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-embed-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = { load: [], embed: [], unload: 0 };
  const runtime = new EventEmitter();
  Object.assign(runtime, { directory, sdk: null, async getSdk() { return this.sdk; } });
  runtime.sdk = {
    async loadModel(params) { calls.load.push(params); return `m${calls.load.length}`; },
    async unloadModel() { calls.unload++; },
    async embed(params) { calls.embed.push(params); return { embedding: params.text.map(vector) }; },
  };
  return { embedder: new Embedder(runtime, { verify: async () => {} }), runtime, calls, directory };
}

test('catalog pins Qwen3 Embedding at 1024 dimensions from the official repository', () => {
  assert.equal(EMBEDDING_MODELS.length, 2);
  for (const model of EMBEDDING_MODELS) {
    assert.equal(model.engine, 'llamacpp-embedding'); assert.equal(model.dimensions, 1024);
    assert.equal(model.repository, 'Qwen/Qwen3-Embedding-0.6B-GGUF'); assert.match(model.sha256, /^[a-f0-9]{64}$/);
  }
  assert.notEqual(qwen.id, qwenF16.id);
});

test('input is bounded, uniquely identified and free of control characters', () => {
  const ok = [{ id: 'diary:a', kind: 'document', text: 'Felt on edge all day.' }];
  assert.equal(validateEmbedInput(batch(ok)).items.length, 1);
  const bad = [
    'not json', batch([]), batch([...ok, { ...ok[0] }]),
    batch(Array.from({ length: EMBED_LIMITS.items + 1 }, (_, i) => ({ id: `d${i}`, kind: 'document', text: 'x' }))),
    batch([{ id: 'x', kind: 'other', text: 'x' }]), batch([{ id: 'bad id!', kind: 'query', text: 'x' }]),
    batch([{ id: 'x', kind: 'query', text: '\u0007bell' }]), batch([{ id: 'x', kind: 'query', text: 'é'.repeat(EMBED_LIMITS.textBytes) }]),
    JSON.stringify({ items: ok }),
  ];
  for (const raw of bad) assert.throws(() => validateEmbedInput(raw), { code: /INVALID_INPUT|INPUT_LIMIT/ });
});

test('queries carry the Qwen3 instruction; documents are embedded verbatim', () => {
  assert.equal(embeddingText(qwen, { kind: 'document', text: 'on edge' }), 'on edge');
  assert.match(embeddingText(qwen, { kind: 'query', text: 'anxious' }), /^Instruct: .+\nQuery:anxious$/);
});

test('vectors round-trip as little-endian float32 base64', () => {
  const values = [0.5, -0.25, 1, 0];
  assert.deepEqual(decode(encodeVector(values)), values);
});

test('loads the embedding model, embeds a batch and refuses a different model id', async (t) => {
  const { embedder: e, calls, directory } = await embedder(t);
  assert.equal((await e.run(batch([{ id: 'a', kind: 'document', text: 'x' }]))).error.code, 'NOT_READY');
  await e.load(qwen.id);
  assert.equal(calls.load[0].modelType, 'llamacpp-embedding');
  assert.equal(e.capability().status, 'ready'); assert.equal(e.capability().dimensions, 1024);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'embedding.json'), 'utf8')).model, qwen.id);
  const result = await e.run(batch([{ id: 'q', kind: 'query', text: 'anxious' }, { id: 'diary:1', kind: 'document', text: 'on edge' }]));
  assert.ok(result.ok);
  const output = JSON.parse(result.text);
  assert.equal(output.model, qwen.id); assert.equal(output.dimensions, 1024);
  assert.deepEqual(output.vectors.map((v) => v.id), ['q', 'diary:1']);
  assert.equal(decode(output.vectors[1].vector)[1], 1);
  assert.match(calls.embed[0].text[0], /^Instruct:/); assert.equal(calls.embed[0].text[1], 'on edge');
  assert.equal((await e.run(batch([{ id: 'a', kind: 'document', text: 'x' }], qwenF16.id))).error.code, 'MODEL_CHANGED');
  await e.load(qwenF16.id);
  assert.equal(calls.unload, 1); assert.equal(e.capability().model, qwenF16.id);
});

test('a wrong-shaped vector fails the batch without returning text', async (t) => {
  const { embedder: e } = await embedder(t, { vector: () => [1, 2, 3] });
  await e.load(qwen.id);
  const result = await e.run(batch([{ id: 'a', kind: 'document', text: 'x' }]));
  assert.equal(result.ok, false); assert.equal(result.error.code, 'INVALID_OUTPUT'); assert.equal(result.text, undefined);
});

test('the runtime closing its SDK marks the embedder unloaded', async (t) => {
  const { embedder: e, runtime } = await embedder(t);
  await e.load(qwen.id);
  runtime.emit('sdkClosed');
  assert.equal(e.capability().status, 'unloaded');
});

test('durable embed jobs keep no prompt after completion and no vectors after acknowledgement', async (t) => {
  const { embedder: e } = await embedder(t);
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const runtime = { reserved: false, async cancelGeneration() {} };
  const jobs = new Jobs(vault, runtime, { assignment: 'writer', capability: () => ({ status: 'unloaded' }) });
  t.after(() => clearInterval(jobs.timer));
  const prompt = batch([{ id: 'diary:1', kind: 'document', text: 'Felt on edge before the interview.' }]);
  await assert.rejects(jobs.submit('phone', { id: 'embed-job-0', operation: EMBED_OPERATION, prompt }), { code: 'NOT_READY' });
  jobs.embedder = e;
  await assert.rejects(jobs.submit('phone', { id: 'embed-job-0', operation: EMBED_OPERATION, prompt }), { code: 'NOT_READY' });
  await e.load(qwen.id);
  // The writing model is unloaded; embedding does not depend on it.
  await jobs.submit('phone', { id: 'embed-job-1', operation: EMBED_OPERATION, prompt });
  await jobs.pump();
  const done = jobs.get('phone', 'embed-job-1');
  assert.equal(done.state, 'completed'); assert.equal(done.model, qwen.id);
  assert.equal(value.jobs['phone:embed-job-1'].prompt, undefined);
  assert.doesNotMatch(JSON.stringify(value), /on edge/);
  await jobs.acknowledge('phone', 'embed-job-1');
  assert.equal(value.jobs['phone:embed-job-1'].text, undefined);
  // A job accepted for one model fails after the computer switches model.
  await jobs.submit('phone', { id: 'embed-job-2', operation: EMBED_OPERATION, prompt });
  await e.load(qwenF16.id);
  await jobs.pump();
  assert.equal(jobs.get('phone', 'embed-job-2').error, 'MODEL_CHANGED');
  await assert.rejects(jobs.submit('phone', { id: 'embed-job-3', operation: EMBED_OPERATION, prompt: 'x'.repeat(EMBED_LIMITS.inputBytes + 1) }), { code: /INPUT_LIMIT|INVALID_INPUT/ });
});
