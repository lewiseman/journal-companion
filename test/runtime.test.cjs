const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Runtime, hostProblem } = require('../src/runtime.cjs');
const { verifyModel, readSelection, saveSelection } = require('../src/model.cjs');

test('download authentication is restricted to the exact Hugging Face origin', () => {
  const { downloadHeaders } = require('../src/model.cjs');
  const token = 'hf_synthetic_test_value';
  assert.deepEqual(downloadHeaders('https://huggingface.co/Qwen/model', token), { Authorization: `Bearer ${token}` });
  for (const url of ['https://cdn-lfs.huggingface.co/model', 'https://cas-bridge.xethub.hf.co/model', 'https://huggingface.co.example.com/model', 'http://huggingface.co/model', 'https://huggingface.co:8443/model']) {
    assert.deepEqual(downloadHeaders(url, token), {});
  }
  assert.deepEqual(downloadHeaders('https://huggingface.co/model', ''), {});
});

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-d01-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
test('unsupported hosts never initialize the SDK or advertise readiness', async (t) => {
  const runtime = new Runtime(await temporary(t), { checkHost: () => hostProblem('linux', 'x64'), sdkFactory: () => assert.fail('SDK must not start') });
  await runtime.initialize();
  assert.equal(runtime.state.status, 'unavailable');
  assert.equal(runtime.state.error.code, 'UNSUPPORTED_HOST');
  await assert.rejects(runtime.load(), { code: 'UNSUPPORTED_HOST' });
});
test('cold start reconciles a remembered but missing file', async (t) => {
  const dir = await temporary(t);
  await saveSelection(dir, path.join(dir, 'removed.gguf'));
  const runtime = new Runtime(dir, { checkHost: () => null, sdkFactory: () => assert.fail('Missing weights must never reach SDK') });
  await runtime.initialize();
  assert.equal(runtime.state.status, 'failed');
  assert.equal(runtime.state.error.code, 'MISSING_WEIGHTS');
  assert.equal(runtime.modelId, null);
});
test('partial/unrelated files fail validation without replacing selection', async (t) => {
  const dir = await temporary(t), original = path.join(dir, 'original.gguf');
  await saveSelection(dir, original);
  const partial = path.join(dir, 'partial.gguf'); await fs.writeFile(partial, 'GGUF');
  await assert.rejects(verifyModel(partial), { code: 'INVALID_WEIGHTS' });
  const runtime = new Runtime(dir, { checkHost: () => null });
  const result = await runtime.select(partial);
  assert.equal(result.error.code, 'INVALID_WEIGHTS');
  assert.equal(await readSelection(dir), original);
});
test('a file with the correct byte count but corrupt contents is never accepted', async (t) => {
  const dir = await temporary(t), file = path.join(dir, 'corrupt.gguf');
  const handle = await fs.open(file, 'w');
  await handle.truncate(require('../src/model.cjs').MODEL.bytes); await handle.close();
  await assert.rejects(verifyModel(file), { code: 'INVALID_WEIGHTS' });
});
test('native load failure revokes readiness and remains recoverable', async (t) => {
  const runtime = new Runtime(await temporary(t), { checkHost: () => null });
  let closed = false;
  runtime.sdk = { close: async () => { closed = true; } };
  const result = await runtime.operation(async () => { throw new Error('native model load failed'); });
  assert.equal(result.ok, false); assert.equal(runtime.state.status, 'failed'); assert.equal(runtime.modelId, null); assert.equal(closed, true);
  assert.equal((await runtime.unload()).ok, true); assert.equal(runtime.state.status, 'unavailable');
});
test('only one request runs; unload cannot redirect or interrupt accepted work', async (t) => {
  const runtime = new Runtime(await temporary(t), { checkHost: () => null });
  let finish;
  runtime.sdk = { completion: () => ({ tokenStream: (async function* () { await new Promise((r) => { finish = r; }); yield 'A real adapter would emit tokens here'; })(), text: Promise.resolve('done') }), unloadModel: async () => {}, close: async () => {} };
  runtime.modelId = 'captured-model'; runtime.state.status = 'ready';
  const operation = runtime.generate('Synthetic request');
  await assert.rejects(runtime.unload(), { code: 'BUSY' });
  await assert.rejects(runtime.generate('Another request'), { code: 'BUSY' });
  finish(); assert.equal((await operation).ok, true);
  assert.equal(runtime.state.status, 'ready'); await runtime.shutdown();
});
test('worker crash during completion drops readiness and closes runtime', async (t) => {
  const runtime = new Runtime(await temporary(t), { checkHost: () => null });
  let closed = 0;
  runtime.sdk = { completion: () => ({ tokenStream: (async function* () { throw Object.assign(new Error('sensitive native details'), { code: 'WORKER_CRASHED' }); })() }), close: async () => { closed++; } };
  runtime.modelId = 'model'; runtime.state.status = 'ready';
  const result = await runtime.generate('private input');
  assert.equal(result.error.code, 'WORKER_FAILED'); assert.equal(runtime.state.status, 'failed');
  assert.equal(runtime.modelId, null); assert.equal(closed, 1);
  assert.ok(!JSON.stringify(runtime.snapshot()).includes('private input'));
});
test('empty, non-text and oversized UTF-8 requests are rejected before runtime calls', async (t) => {
  const runtime = new Runtime(await temporary(t));
  for (const input of ['', '  ', {}, '🦉'.repeat(501)]) assert.throws(() => runtime.generate(input), { code: 'INVALID_INPUT' });
  await runtime.shutdown();
});
test('unload releases the model and closes SDK; shutdown remains idempotent', async (t) => {
  const runtime = new Runtime(await temporary(t));
  const unloaded = [];
  runtime.sdk = { unloadModel: async (input) => unloaded.push(input.modelId), close: async () => {} };
  runtime.modelId = 'one'; runtime.state.status = 'ready'; runtime.state.selected = true;
  assert.equal((await runtime.unload()).ok, true);
  assert.deepEqual(unloaded, ['one']); assert.equal(runtime.modelId, null); assert.equal(runtime.state.status, 'unavailable');
  await runtime.shutdown(); await runtime.shutdown(); assert.deepEqual(unloaded, ['one']);
});
