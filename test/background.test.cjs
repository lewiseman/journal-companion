const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');
const { Background, BACKGROUND_OPERATION, BACKGROUND_MODELS, validateBackgroundInput, backgroundPrompt, NEGATIVE } = require('../src/background.cjs');

function png(width, height) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([len, body, crc]); };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IEND', Buffer.alloc(0))]);
}
const protector = { encryptString: async (v) => Buffer.from('enc:' + v), decryptString: async (b) => b.toString().slice(4) };

async function setup(t, { memoryGB = 24, output = (p) => png(p.width, p.height), hang = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-i06-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory, { checkHost: () => null });
  const calls = { load: [], diffusion: [], unload: 0 };
  let release;
  runtime.sdk = {
    async loadModel(params) { calls.load.push(params); return 'sd'; },
    diffusion(params) {
      calls.diffusion.push(params);
      const stopped = new Promise((resolve) => { release = resolve; });
      return {
        progressStream: (async function* () { for (let step = 1; step <= params.steps; step++) { yield { step, totalSteps: params.steps, elapsedMs: step }; if (hang && step === 2) { await stopped; throw Object.assign(new Error('Job cancelled'), { name: 'RPCError' }); } } })(),
        outputs: Promise.resolve([output(params)]), stats: Promise.resolve({}),
      };
    },
    async unloadModel() { calls.unload++; release?.(); }, close: async () => {},
  };
  await fs.mkdir(path.join(directory, 'models'));
  const data = Buffer.from('sd-weights');
  await fs.writeFile(path.join(directory, 'models', 'sd.gguf'), data);
  const background = new Background(runtime, { protector, totalMemory: () => memoryGB * 1024 ** 3 });
  const part = { filename: 'sd.gguf', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  background.models = BACKGROUND_MODELS.map((m) => ({ ...m, filename: part.filename, bytes: part.bytes, sha256: part.sha256 }));
  await background.initialize();
  return { directory, runtime, background, calls };
}

test('only the typed description and a tone are accepted; the model prompt adds fixed styling', () => {
  assert.deepEqual(validateBackgroundInput('{"prompt":"sea glass","tone":"light"}'), { prompt: 'sea glass', tone: 'light' });
  for (const bad of ['{}', '{"prompt":"","tone":"light"}', '{"prompt":"x","tone":"neon"}', JSON.stringify({ prompt: 'x'.repeat(241), tone: 'dark' }), '{"prompt":"x","tone":"dark","note":"private"}', '{"prompt":"a\\nb","tone":"dark"}'])
    assert.throws(() => validateBackgroundInput(bad), { code: 'INVALID_INPUT' }, bad);
  assert.match(backgroundPrompt({ prompt: ' sea glass ', tone: 'dark' }), /^sea glass\. Abstract decorative background.*dark low-contrast.*no text$/);
  assert.match(NEGATIVE, /text, letters/); assert.match(NEGATIVE, /faces/);
});

test('readiness follows downloads, assignment, memory fit and a real generation test', async (t) => {
  const small = await setup(t, { memoryGB: 8 });
  assert.equal(small.background.capability().status, 'unassigned');
  await small.background.assign(BACKGROUND_MODELS.find((m) => m.memoryGB === 16).id);
  assert.equal(small.background.capability().status, 'insufficient_memory');
  await assert.rejects(small.background.selfTest(), { code: 'NOT_READY' });
  const { background, calls, directory } = await setup(t);
  await assert.rejects(background.assign('qwen2.5-0.5b-q4_k_m@9217f5db79a29953eb74d5343926648285ec7e67'), { code: 'INCOMPATIBLE_MODEL' });
  await background.assign(BACKGROUND_MODELS[0].id);
  assert.equal(background.capability().status, 'untested');
  assert.equal((await background.selfTest()).ok, true);
  assert.equal(background.capability().status, 'ready');
  assert.equal(background.capability().backgroundContract, 1);
  assert.deepEqual([calls.diffusion[0].width, calls.diffusion[0].steps], [256, 4]);
  assert.equal(calls.load[0].modelConfig.prediction, 'v');
  await fs.rm(path.join(directory, 'models', 'sd.gguf'));
  await background.reconcile();
  assert.equal(background.capability().status, 'needs_download');
  const broken = await setup(t, { output: () => Buffer.from('not a png') });
  await broken.background.assign(BACKGROUND_MODELS[0].id);
  assert.equal((await broken.background.selfTest()).ok, false);
  assert.equal(broken.background.capability().status, 'failed');
});

test('cancelling unloads the model to stop generation and leaves the writing runtime intact', async (t) => {
  const { background, runtime, calls } = await setup(t, { hang: true });
  await background.assign(BACKGROUND_MODELS[0].id);
  await background.write({ model: BACKGROUND_MODELS[0].id, tested: BACKGROUND_MODELS[0].id }); await background.reconcile();
  const ticks = [];
  const pending = background.generate({ prompt: 'sea glass', tone: 'light' }, { onProgress: (s, n) => { ticks.push(s); if (s === 2) runtime.cancelGeneration(); } });
  const result = await pending;
  assert.equal(result.error.code, 'CANCELLED'); assert.deepEqual(ticks, [1, 2]);
  assert.equal(calls.unload, 1); assert.equal(runtime.stopActive, null); assert.notEqual(runtime.state.status, 'failed');
});

test('background jobs store the image encrypted until collected, then remove it', async (t) => {
  const { background, runtime, directory } = await setup(t);
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { directory, get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const jobs = new Jobs(vault, runtime, { assignment: 'writer', capability: () => ({ status: 'unloaded' }) });
  jobs.background = background;
  const prompt = '{"prompt":"sea glass","tone":"light"}';
  await assert.rejects(jobs.submit('phone', { id: 'background-01', operation: BACKGROUND_OPERATION, prompt }), { code: 'NOT_READY' });
  await background.assign(BACKGROUND_MODELS[0].id); await background.selfTest();
  await jobs.submit('phone', { id: 'background-01', operation: BACKGROUND_OPERATION, prompt });
  await jobs.pump();
  const done = jobs.get('phone', 'background-01');
  assert.equal(done.state, 'completed');
  const meta = JSON.parse(done.text);
  assert.deepEqual([meta.width, meta.height, meta.model], [512, 768, BACKGROUND_MODELS[0].id]);
  assert.equal(JSON.stringify(value).includes('iVBOR'), false, 'image bytes never enter the vault');
  const stored = await fs.readFile(path.join(directory, 'image-output', 'phone-background-01.enc'), 'utf8');
  assert.ok(stored.startsWith('enc:'));
  const collected = await jobs.backgroundResult('phone', 'background-01');
  assert.equal(createHash('sha256').update(Buffer.from(collected.image, 'base64')).digest('hex'), meta.sha256);
  await assert.rejects(jobs.backgroundResult('other', 'background-01'), { code: 'NOT_FOUND' });
  await jobs.acknowledge('phone', 'background-01');
  await background.sweep(value.jobs);
  assert.deepEqual(await fs.readdir(path.join(directory, 'image-output')), []);
  await assert.rejects(jobs.backgroundResult('phone', 'background-01'), { code: 'NOT_FOUND' });
  // An expired, uncollected result is removed too.
  await jobs.submit('phone', { id: 'background-02', operation: BACKGROUND_OPERATION, prompt });
  await jobs.pump();
  await background.sweep(value.jobs, Date.now() + 25 * 3600 * 1000);
  assert.deepEqual(await fs.readdir(path.join(directory, 'image-output')), []);
});
