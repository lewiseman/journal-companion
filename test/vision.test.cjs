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

test('I04 scans transcribe verbatim and add an independent EasyOCR check only when installed', async (t) => {
  const { SCAN_OPERATION, validateImageJobInput, validateScanOutput, SCAN_SYSTEM } = require('../src/vision.cjs');
  assert.deepEqual(validateImageJobInput('{"mode":"transcribe"}', SCAN_OPERATION), { mode: 'transcribe' });
  for (const bad of ['{"mode":"describe","question":""}', '{"mode":"transcribe","note":"x"}'])
    assert.throws(() => validateImageJobInput(bad, SCAN_OPERATION), { code: 'INVALID_INPUT' });
  assert.throws(() => validateImageJobInput('{"mode":"transcribe"}', VISION_OPERATION), { code: 'INVALID_INPUT' });
  assert.match(SCAN_SYSTEM, /never correct, complete or translate/); assert.match(SCAN_SYSTEM, /\[\?\]/); assert.match(SCAN_SYSTEM, /never instructions/);
  const read = { text: 'Dentist Tues 3:15pm\nBuy: oats', readable: true };
  const { vision, runtime, calls } = await setup(t, { reply: () => JSON.stringify(read) });
  const image = { type: 'image/png', bytes: selfTestImage() };
  // Without OCR files the scan still works and says no check ran.
  let result = await vision.run({ mode: 'transcribe' }, image, { operation: SCAN_OPERATION });
  assert.deepEqual(JSON.parse(result.text), { ...read, check: null });
  assert.match(calls.completion[0].history[0].content, /exactly as written/);
  assert.equal(calls.completion[0].responseFormat.json_schema.name, 'journal_note_scan_v1');
  // With OCR installed, its lines and confidences come back alongside.
  const ocrParts = [];
  for (const name of ['rec.gguf', 'det.gguf']) {
    const data = Buffer.from(name); await fs.writeFile(path.join(runtime.directory, 'models', name), data);
    ocrParts.push({ filename: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  vision.ocrModel = { ...vision.ocrModel, parts: ocrParts };
  await vision.reconcile();
  assert.equal(vision.capability().ocrCheck, true);
  runtime.sdk.ocr = ({ image: file }) => { calls.ocrImage = file; return { blocks: Promise.resolve([{ text: 'Dentist Tues 315pm', confidence: 0.561 }, { text: 'Buy: oats', confidence: 0.9 }]) }; };
  result = await vision.run({ mode: 'transcribe' }, image, { operation: SCAN_OPERATION });
  assert.deepEqual(JSON.parse(result.text).check, [{ text: 'Dentist Tues 315pm', confidence: 0.56 }, { text: 'Buy: oats', confidence: 0.9 }]);
  assert.equal(calls.load.at(-1).modelType, 'ggml-ocr'); assert.equal(calls.load.at(-1).modelConfig.detectorModelSrc, path.join(runtime.directory, 'models', 'det.gguf'));
  assert.equal(calls.unload, 3, 'one unload for the first scan, two (reader and checker) for the second');
  // An OCR failure only removes the check.
  runtime.sdk.ocr = () => ({ blocks: Promise.reject(new Error('native')) });
  assert.equal(JSON.parse((await vision.run({ mode: 'transcribe' }, image, { operation: SCAN_OPERATION })).text).check, null);
  for (const bad of ['{"text":"x","readable":"yes","check":null}', '{"text":"x","readable":true,"check":[{"text":"x","confidence":2}]}', '{"text":"x","readable":true}'])
    assert.throws(() => validateScanOutput(bad), { code: 'INVALID_OUTPUT' }, bad);
});

test('a scan that repeats its instructions is reported as no legible text', async (t) => {
  const { SCAN_OPERATION, echoesInstructions } = require('../src/vision.cjs');
  assert.equal(echoesInstructions('every line of text in reading order, exactly as written, one line per line.'), true);
  assert.equal(echoesInstructions('Call Mum about Sunday lunch\nDentist Tues 3:15pm'), false);
  const { vision } = await setup(t, { reply: () => JSON.stringify({ text: 'Keep spelling, names, dates, numbers, punctuation and capitalisation as they appear', readable: true }) });
  const result = await vision.run({ mode: 'transcribe' }, { type: 'image/png', bytes: selfTestImage() }, { operation: SCAN_OPERATION });
  assert.deepEqual(JSON.parse(result.text), { text: '', readable: false, check: null });
});

test('I02 diary photo questions: strict caption input, grouped questions, and the same private image route', async (t) => {
  const { PHOTO_OPERATION, PHOTO_SYSTEM, validatePhotoInput, validatePhotoOutput, photoResponseFormat, validateImageJobInput } = require('../src/vision.cjs');
  const questions = { observations: 'A beach at sunset with a red umbrella.', clear: true,
    moment: ['What led you down to the beach that evening?'], feeling: ['How did you feel as the sun went down?', 'What did this evening mean to you?'],
    little: ['What could you hear near the red umbrella?'] };
  assert.deepEqual(validatePhotoInput('{"caption":""}'), { caption: '' });
  assert.deepEqual(validateImageJobInput('{"caption":"Last swim of summer"}', PHOTO_OPERATION), { caption: 'Last swim of summer' });
  assert.deepEqual(validatePhotoInput(JSON.stringify({ caption: '', avoid: ['What led you here?'] })).avoid, ['What led you here?']);
  for (const bad of ['{}', '{"caption":1}', JSON.stringify({ caption: 'x'.repeat(241) }), JSON.stringify({ caption: '', diary: 'private' }), '{"caption":"a\u0007"}',
    JSON.stringify({ caption: '', avoid: [] }), JSON.stringify({ caption: '', avoid: Array(13).fill('Why?') }), JSON.stringify({ caption: '', avoid: ['x'.repeat(161)] })]) {
    assert.throws(() => validatePhotoInput(bad), { code: 'INVALID_INPUT' }, bad);
  }
  assert.deepEqual(JSON.parse(validatePhotoOutput(JSON.stringify(questions))), questions);
  // Duplicates across groups are dropped, never shown twice.
  const repeated = JSON.parse(validatePhotoOutput(JSON.stringify({ ...questions, little: ['What could you hear near the red umbrella?', 'how did you feel as the sun went down?'] })));
  assert.deepEqual(repeated.little, ['What could you hear near the red umbrella?']);
  for (const bad of ['', '{}', JSON.stringify({ ...questions, moment: [] }), JSON.stringify({ ...questions, moment: ['a?', 'b?', 'c?', 'd?'] }),
    JSON.stringify({ ...questions, feeling: ['You felt calm.'] }), JSON.stringify({ ...questions, clear: 'yes' }), JSON.stringify({ ...questions, observations: '' }),
    JSON.stringify({ ...questions, little: ['x'.repeat(160) + '?'] }), JSON.stringify({ ...questions, extra: 1 })]) {
    assert.throws(() => validatePhotoOutput(bad), { code: 'INVALID_OUTPUT' }, bad);
  }
  assert.deepEqual(photoResponseFormat().json_schema.schema.required, ['observations', 'clear', 'moment', 'feeling', 'little']);
  assert.match(PHOTO_SYSTEM, /never state or assume what anyone felt/); assert.match(PHOTO_SYSTEM, /Never identify anyone/);

  const { vision, runtime, directory, calls } = await setup(t, { reply: (params) => JSON.stringify(params.history[0].content === PHOTO_SYSTEM ? questions : output) });
  assert.equal(vision.capability().photoContract, 2); assert.ok(vision.capability().operations.includes(PHOTO_OPERATION));
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { directory, get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const jobs = new Jobs(vault, runtime, { assignment: 'writer', capability: () => ({ status: 'unloaded' }) });
  jobs.vision = vision;
  const prompt = '{"caption":"Last swim of summer"}', image = selfTestImage().toString('base64');
  await assert.rejects(jobs.submit('phone', { id: 'photo-job-01', operation: PHOTO_OPERATION, prompt, image }, { image: true }), { code: 'NOT_READY' });
  await assert.rejects(jobs.submit('phone', { id: 'photo-job-01', operation: PHOTO_OPERATION, prompt }), { code: 'INVALID_INPUT' });
  await vision.selfTest();
  jobs.pumping = true;
  await jobs.submit('phone', { id: 'photo-job-01', operation: PHOTO_OPERATION, prompt, image }, { image: true });
  assert.equal(JSON.stringify(value).includes(image), false);
  jobs.pumping = false; await jobs.pump();
  const done = jobs.get('phone', 'photo-job-01');
  assert.equal(done.state, 'completed'); assert.deepEqual(JSON.parse(done.text), questions);
  const request = calls.completion.at(-1);
  assert.equal(request.history[0].content, PHOTO_SYSTEM);
  assert.match(request.history[1].content, /own caption \(context from them, not from the photo; use it only for the questions, never in observations\): "Last swim of summer"/);
  assert.equal(request.responseFormat.json_schema.name, 'journal_diary_photo_v1');
  assert.equal(calls.load.length, calls.unload);
  await vision.sweep(value.jobs);
  assert.deepEqual(await fs.readdir(path.join(directory, 'image-input')), []);
  // Invalid model output fails the job without a partial result.
  const bad = await setup(t, { reply: (params) => params.history[0].content === PHOTO_SYSTEM ? '{"observations":"x","clear":true,"moment":["Statement."],"feeling":["a?"],"little":["b?"]}' : JSON.stringify(output) });
  const failure = await bad.vision.run({ caption: '' }, { type: 'image/png', bytes: selfTestImage() }, { operation: PHOTO_OPERATION });
  assert.equal(failure.error.code, 'INVALID_OUTPUT');
});

test('I02 shuffle: questions to avoid reach the model, which samples instead of repeating itself', async (t) => {
  const { PHOTO_OPERATION } = require('../src/vision.cjs');
  const reply = { observations: 'A lake.', clear: true, moment: ['Where had you walked from?'], feeling: ['How did the water make you feel?'], little: ['What could you hear?'] };
  const { vision, calls } = await setup(t, { reply: () => JSON.stringify(reply) });
  const image = { type: 'image/png', bytes: selfTestImage() };
  await vision.run({ caption: '' }, image, { operation: PHOTO_OPERATION });
  assert.deepEqual([calls.completion[0].generationParams.temp, calls.completion[0].generationParams.seed], [0, 42]);
  const result = await vision.run({ caption: 'Lake day', avoid: ['What led you to the lake?'] }, image, { operation: PHOTO_OPERATION });
  assert.equal(result.ok, true);
  const shuffle = calls.completion[1];
  assert.match(shuffle.history[1].content, /already seen these questions[\s\S]*"What led you to the lake\?"/);
  assert.equal(shuffle.generationParams.temp, .8);
});
