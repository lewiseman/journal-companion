const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { QUESTION_OPERATION, validateQuestionInput, validateQuestionOutput, questionResponseFormat } = require('../src/question.cjs');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');

const good = { question: 'How did the move to the new flat go in the end?', source: 'p0', evidence: 'moving to the new flat' };
const input = { today: [{ id: 't0', text: 'Slow start.' }], prior: [{ id: 'p0', ago: 2, text: 'Packing boxes for moving to the new flat.' }], avoid: ['What made you smile today?'] };

test('question input is a disclosed bounded selection with temporary IDs only', () => {
  assert.deepEqual(validateQuestionInput(JSON.stringify(input)), input);
  // Empty history is valid: a general question still helps start writing.
  assert.deepEqual(validateQuestionInput(JSON.stringify({ today: [], prior: [], avoid: [] })).prior, []);
  for (const invalid of [
    { ...input, date: '2026-10-27' }, { today: [], prior: [] },
    { ...input, prior: [{ id: 'p1', ago: 1, text: 'reordered' }] }, { ...input, prior: [{ id: 'p0', ago: 0, text: 'today is not prior' }] },
    { ...input, prior: [{ id: 'p0', ago: 8, text: 'too old' }] }, { ...input, prior: [{ id: 'p0', ago: 1, text: 'x', uuid: 'private' }] },
    { ...input, prior: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, ago: 1, text: 'x' })) },
    { ...input, today: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, text: 'x' })) },
    { ...input, avoid: Array(6).fill('Again?') }, { ...input, avoid: ['line\nbreak?'] },
    { ...input, prior: [{ id: 'p0', ago: 1, text: 'x'.repeat(2000) }] },
  ]) assert.throws(() => validateQuestionInput(JSON.stringify(invalid)), { code: 'INVALID_INPUT' }, JSON.stringify(invalid).slice(0, 80));
});

test('question output envelope is exact and bounded; a general question has no source', () => {
  assert.deepEqual(JSON.parse(validateQuestionOutput(JSON.stringify(good))), good);
  const general = { question: 'What is one thing you want to remember about today?', source: '', evidence: '' };
  assert.deepEqual(JSON.parse(validateQuestionOutput(JSON.stringify(general))), general);
  for (const invalid of [
    '', 'not JSON', '{}', JSON.stringify({ ...good, extra: 1 }), JSON.stringify({ ...good, question: '' }),
    JSON.stringify({ ...good, question: 'x'.repeat(201) }), JSON.stringify({ ...good, question: 'two\nlines?' }),
    JSON.stringify({ ...good, source: 'p8' }), JSON.stringify({ ...good, source: 'e0' }), JSON.stringify({ ...good, evidence: 'x'.repeat(161) }),
  ]) assert.throws(() => validateQuestionOutput(invalid), { code: 'INVALID_OUTPUT' }, invalid);
});

test('QVAC question request is deterministic, grammar constrained and fails closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-j02-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory, { checkHost: () => null });
  let captured, reason, output = JSON.stringify(good);
  runtime.sdk = { completion(params) { captured = params; return { tokenStream: (async function* () { yield output; })(), text: Promise.resolve(output), final: Promise.resolve({ stopReason: reason }) }; }, close: async () => {}, unloadModel: async () => {} };
  runtime.modelId = 'model'; runtime.state.status = 'ready';
  const prompt = JSON.stringify(input);
  assert.equal((await runtime.generate(prompt, { operation: QUESTION_OPERATION, job: true })).ok, true);
  assert.equal(captured.history[1].content, prompt);
  assert.match(captured.history[0].content, /untrusted source data/);
  assert.match(captured.history[0].content, /Do not repeat/);
  assert.match(captured.history[0].content, /never invent events/);
  assert.match(captured.history[0].content, /never describe what it mentions as happening today/);
  // Fresh questions on each request; the grammar still bounds the output.
  assert.equal(captured.generationParams.temp, 0.7); assert.equal(captured.generationParams.predict, 160); assert.equal(captured.kvCache, false);
  assert.ok(Number.isInteger(captured.generationParams.seed));
  assert.match(captured.history[0].content, /only for checking repetition/);
  assert.deepEqual(questionResponseFormat(), captured.responseFormat);
  assert.deepEqual(captured.responseFormat.json_schema.schema.required, ['question', 'source', 'evidence']);
  reason = 'length'; assert.equal((await runtime.generate(prompt, { operation: QUESTION_OPERATION, job: true })).error.code, 'OUTPUT_LIMIT');
  reason = undefined; output = '{"question":"x"}';
  assert.equal((await runtime.generate(prompt, { operation: QUESTION_OPERATION, job: true })).error.code, 'INVALID_OUTPUT');
  await assert.rejects(async () => runtime.generate(JSON.stringify({ ...input, date: 'today' }), { operation: QUESTION_OPERATION, job: true }), { code: 'INVALID_INPUT' });
  await runtime.shutdown();
});

test('durable jobs accept, validate and cancel the question operation', async () => {
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  let generated = JSON.stringify(good);
  const runtime = { reserved: false, async generate() { return { ok: true, text: generated }; }, async cancelGeneration() {} };
  const library = { assignment: 'model', capability: () => ({ status: 'ready' }) };
  const jobs = new Jobs(vault, runtime, library);
  const prompt = JSON.stringify(input);
  await assert.rejects(jobs.submit('phone', { id: 'question-bad-1', operation: QUESTION_OPERATION, prompt: '{"today":[]}' }), { code: 'INVALID_INPUT' });
  await jobs.submit('phone', { id: 'question-job-1', operation: QUESTION_OPERATION, prompt });
  await jobs.pump();
  const done = jobs.get('phone', 'question-job-1');
  assert.equal(done.state, 'completed'); assert.deepEqual(JSON.parse(done.text), good); assert.equal(done.prompt, undefined);
  generated = '{"question":1}';
  await jobs.submit('phone', { id: 'question-job-2', operation: QUESTION_OPERATION, prompt });
  await jobs.pump();
  assert.equal(jobs.get('phone', 'question-job-2').state, 'failed');
  assert.equal(jobs.get('phone', 'question-job-2').text, undefined);
  assert.equal((await jobs.cancel('phone', 'question-job-3', QUESTION_OPERATION)).state, 'cancelled');
  clearInterval(jobs.timer);
});
