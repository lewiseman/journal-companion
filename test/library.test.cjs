const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library, MODEL_KEY } = require('../src/library.cjs');
const { MODEL, downloadModel } = require('../src/model.cjs');
async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-library-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
test('writing assignment is persisted, incompatible choices and loaded removal are prevented', async (t) => {
  const dir = await directory(t), runtime = { directory: dir, state: { status: 'unavailable' }, update() {} };
  const library = new Library(runtime); await library.initialize(); library.installed = true;
  await assert.rejects(library.assign('vision-model'), { code: 'INCOMPATIBLE_MODEL' });
  await library.assign(MODEL_KEY);
  const restored = new Library(runtime); await restored.initialize();
  assert.equal(restored.assignment, MODEL_KEY); assert.equal(restored.capability().status, 'needs_download');
  runtime.modelId = 'loaded'; await assert.rejects(library.remove(), { code: 'BUSY' });
  runtime.modelId = null; await assert.rejects(library.remove(), { code: 'EXTERNAL_MODEL' });
});
test('disk preflight blocks the transfer and interrupted download is discarded for a fresh retry', async (t) => {
  const dir = await directory(t); let calls = 0;
  await assert.rejects(downloadModel(dir, () => {}, undefined, { statfs: async () => ({ bavail: 0, bsize: 1 }), fetcher: () => { calls++; } }), { code: 'DISK_FULL' }); assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(downloadModel(dir, () => controller.abort(), controller.signal, {
    statfs: async () => ({ bavail: MODEL.bytes * 2, bsize: 1 }),
    fetcher: async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16)); c.error(new Error('simulated interrupted transfer')); } })); },
  }), { code: 'DOWNLOAD_FAILED' });
  await assert.rejects(fs.stat(path.join(dir, MODEL.filename + '.partial')), { code: 'ENOENT' });
});
