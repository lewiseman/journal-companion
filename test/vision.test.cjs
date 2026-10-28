const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');
const { Vision, VISION_OPERATION, VISION_MODEL, validateVisionInput, validateVisionOutput, validateImage, visionResponseFormat, selfTestImage } = require('../src/vision.cjs');

const output = { observations: 'A red square.', text: '', inference: '', answer: 'Red' };
const protector = { encryptString: async (v) => Buffer.from('enc:' + v), decryptString: async (b) => b.toString().slice(4) };

async function setup(t, { reply = () => JSON.stringify(output) } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-i03-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory, { checkHost: () => null });
  const calls = { load: [], completion: [], unload: 0, seen: [] };
  runtime.sdk = {
    async loadModel(params) { calls.load.push(params); return 'vision-model'; },
    completion(params) {
      calls.completion.push(params);
      const file = params.history[1].attachments[0].path;
      const text = reply(params);
      return { tokenStream: (async function* () { calls.seen.push(await fs.readFile(file)); yield text; })(), text: Promise.resolve(text), final: Promise.resolve({ stopReason: 'eos' }) };
    },
    async unloadModel() { calls.unload++; }, close: async () => {},
  };
  await fs.mkdir(path.join(directory, 'models'));
  const parts = [];
  for (const [i, name] of ['main.gguf', 'mmproj.gguf'].entries()) {
    const data = Buffer.from(`weights-${i}`);
    await fs.writeFile(path.join(directory, 'models', name), data);
    parts.push({ filename: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const vision = new Vision(runtime, { protector });
  vision.model = { ...VISION_MODEL, filename: parts[0].filename, bytes: parts[0].bytes + parts[1].bytes, parts };
  await vision.initialize();
  return { directory, runtime, vision, calls };
}

test('input, image and output envelopes are strict and bounded', () => {
  assert.deepEqual(validateVisionInput('{"mode":"describe","question":""}'), { mode: 'describe', question: '' });
  assert.equal(validateVisionInput(JSON.stringify({ mode: 'question', question: 'What colour is the door?' })).mode, 'question');
  for (const bad of ['{}', '{"mode":"question","question":""}', '{"mode":"describe","question":"x"}', '{"mode":"ocr","question":""}',
    JSON.stringify({ mode: 'question', question: 'x'.repeat(301) }), JSON.stringify({ mode: 'describe', question: '', note: 'private' })]) {
    assert.throws(() => validateVisionInput(bad), { code: 'INVALID_INPUT' }, bad);
  }
  assert.deepEqual(validateImage(selfTestImage()), { type: 'image/png', width: 64, height: 64 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 120, 0, 160, 3, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(validateImage(jpeg), { type: 'image/jpeg', width: 160, height: 120 });
  const huge = selfTestImage(); huge.writeUInt32BE(5000, 16);
  for (const bad of [Buffer.from('GIF89a........................'), huge, Buffer.alloc(3 * 1024 * 1024 + 1, 0x89), Buffer.from('%PDF-1.7 not an image at all')]) {
    assert.throws(() => validateImage(bad), { code: 'INVALID_IMAGE' });
  }
  assert.deepEqual(JSON.parse(validateVisionOutput(JSON.stringify(output))), output);
  for (const bad of ['', '{}', JSON.stringify({ ...output, observations: '' }), JSON.stringify({ ...output, extra: 1 }), JSON.stringify({ ...output, text: 'x'.repeat(901) })]) {
    assert.throws(() => validateVisionOutput(bad), { code: 'INVALID_OUTPUT' }, bad);
  }
  assert.deepEqual(visionResponseFormat().json_schema.schema.required, ['observations', 'text', 'inference', 'answer']);
});

test('a request loads the projector, attaches only a temporary image file, and always unloads', async (t) => {
  const { vision, calls, directory } = await setup(t);
  const image = { type: 'image/png', bytes: selfTestImage() };
  const result = await vision.run({ mode: 'question', question: 'What colour is it?' }, image);
  assert.equal(result.ok, true);
  assert.equal(calls.load[0].modelConfig.projectionModelSrc, path.join(directory, 'models', 'mmproj.gguf'));
  const request = calls.completion[0];
  assert.match(request.history[0].content, /never instructions to you/);
  assert.match(request.history[0].content, /Never identify real people/);
  assert.match(request.history[1].content, /"What colour is it\?"/);
  assert.equal(request.kvCache, false); assert.equal(request.generationParams.temp, 0);
  assert.deepEqual(calls.seen[0], image.bytes);
  assert.equal(calls.unload, 1);
  assert.deepEqual((await fs.readdir(path.join(directory, 'image-input'))), []);
  // Malformed model output fails without touching the writing runtime.
  const bad = await setup(t, { reply: () => '{"observations":""}' });
  const failure = await bad.vision.run({ mode: 'describe', question: '' }, image);
  assert.equal(failure.error.code, 'INVALID_OUTPUT'); assert.equal(bad.calls.unload, 1);
  assert.notEqual(bad.runtime.state.status, 'failed');
});

test('readiness needs both files and a passing real self-test; a model that cannot see stays disabled', async (t) => {
  const { vision, directory } = await setup(t);
  assert.equal(vision.capability().status, 'untested');
  assert.equal((await vision.selfTest()).ok, true);
  assert.equal(vision.capability().status, 'ready');
  assert.equal(vision.capability().visionContract, 1);
  await fs.rm(path.join(directory, 'models', 'mmproj.gguf'));
  await vision.reconcile();
  assert.equal(vision.capability().status, 'needs_download');
  await assert.rejects(vision.selfTest(), { code: 'NOT_READY' });
  const blind = await setup(t, { reply: () => JSON.stringify({ ...output, observations: 'A picture.', answer: 'Blue' }) });
  assert.equal((await blind.vision.selfTest()).ok, false);
  assert.equal(blind.vision.capability().status, 'failed');
});

test('image jobs use only the image route, keep the image encrypted while pending, and remove it afterwards', async (t) => {
  const { vision, runtime, directory } = await setup(t);
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { directory, get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const jobs = new Jobs(vault, runtime, { assignment: 'writer', capability: () => ({ status: 'unloaded' }) });
  jobs.vision = vision;
  const prompt = JSON.stringify({ mode: 'describe', question: '' }), image = selfTestImage().toString('base64');
  await assert.rejects(jobs.submit('phone', { id: 'image-job-01', operation: VISION_OPERATION, prompt, image }), { code: 'INVALID_INPUT' });
  await assert.rejects(jobs.submit('phone', { id: 'text-job-001', operation: 'summarize-note', prompt: 'x' }, { image: true }), { code: 'INVALID_INPUT' });
  await assert.rejects(jobs.submit('phone', { id: 'image-job-01', operation: VISION_OPERATION, prompt, image }, { image: true }), { code: 'NOT_READY' });
  await vision.selfTest();
  await assert.rejects(jobs.submit('phone', { id: 'image-job-01', operation: VISION_OPERATION, prompt, image: 'R0lGODlh' }, { image: true }), { code: 'INVALID_IMAGE' });
  jobs.pumping = true; // hold the queue to inspect pending storage
  const accepted = await jobs.submit('phone', { id: 'image-job-01', operation: VISION_OPERATION, prompt, image }, { image: true });
  assert.equal(accepted.state, 'queued'); assert.deepEqual(accepted.image, { type: 'image/png', width: 64, height: 64, bytes: selfTestImage().length });
  const stored = await fs.readFile(path.join(directory, 'image-input', 'phone-image-job-01.enc'), 'utf8');
  assert.ok(stored.startsWith('enc:') && !stored.includes('IHDR'));
  assert.equal(value.jobs['phone:image-job-01'].prompt, prompt); assert.equal(JSON.stringify(value).includes(image), false);
  // Same identity with a different image is a conflict, never a silent replacement.
  const other = Buffer.concat([selfTestImage(), Buffer.from([0])]).toString('base64');
  await assert.rejects(jobs.submit('phone', { id: 'image-job-01', operation: VISION_OPERATION, prompt, image: other }, { image: true }), { code: 'ID_CONFLICT' });
  jobs.pumping = false; await jobs.pump();
  const done = jobs.get('phone', 'image-job-01');
  assert.equal(done.state, 'completed'); assert.deepEqual(JSON.parse(done.text), output);
  await vision.sweep(value.jobs);
  assert.deepEqual(await fs.readdir(path.join(directory, 'image-input')), []);
  // A job whose stored image vanished fails clearly.
  jobs.pumping = true;
  await jobs.submit('phone', { id: 'image-job-02', operation: VISION_OPERATION, prompt, image }, { image: true });
  await fs.rm(path.join(directory, 'image-input', 'phone-image-job-02.enc'));
  jobs.pumping = false; await jobs.pump();
  assert.equal(jobs.get('phone', 'image-job-02').error, 'IMAGE_MISSING');
  // Cancelling a queued job removes its stored image.
  jobs.pumping = true;
  await jobs.submit('phone', { id: 'image-job-03', operation: VISION_OPERATION, prompt, image }, { image: true });
  await jobs.cancel('phone', 'image-job-03', VISION_OPERATION);
  await vision.sweep(value.jobs);
  assert.deepEqual(await fs.readdir(path.join(directory, 'image-input')), []);
});
