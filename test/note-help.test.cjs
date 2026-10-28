const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { METADATA_OPERATION, IDEAS_OPERATION, TEMPLATE_OPERATION, NOTE_HELP, validateMetadataInput, validateMetadataOutput, validateIdeasInput, validateIdeasOutput, validateTemplateInput, validateTemplateOutput } = require('../src/note-help.cjs');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');

const note = { title: 'Untitled Note', text: 'Bought tomato seedlings and planned the raised bed for spring.', tags: ['Home'] };
const metadata = { titles: ['Raised bed plan for spring'], tags: [{ name: 'Gardening', emoji: '🌱' }] };
const ideas = { topic: '', notes: [{ id: 'n0', title: 'Garden', excerpt: 'Tomatoes and beans.' }] };

test('metadata input is one bounded note; output is an exact bounded envelope with palette emoji', () => {
  assert.deepEqual(validateMetadataInput(JSON.stringify(note)), note);
  assert.deepEqual(validateMetadataInput(JSON.stringify({ ...note, title: '' })).title, '');
  for (const invalid of [
    { ...note, text: '' }, { ...note, text: '🦉'.repeat(500) }, { ...note, uuid: 'private' }, { title: '', text: 'x' },
    { ...note, tags: ['#bad'] }, { ...note, tags: ['all'] }, { ...note, tags: Array(13).fill('x') }, { ...note, title: 'a\nb' },
  ]) assert.throws(() => validateMetadataInput(JSON.stringify(invalid)), { code: 'INVALID_INPUT' }, JSON.stringify(invalid).slice(0, 60));
  assert.deepEqual(JSON.parse(validateMetadataOutput(JSON.stringify(metadata))), metadata);
  assert.deepEqual(JSON.parse(validateMetadataOutput(JSON.stringify({ titles: [], tags: metadata.tags }))).titles, []);
  for (const invalid of [
    '', 'nope', '{}', JSON.stringify({ titles: [], tags: [] }), JSON.stringify({ ...metadata, extra: 1 }),
    JSON.stringify({ ...metadata, titles: ['x'.repeat(81)] }), JSON.stringify({ ...metadata, titles: Array(4).fill('x') }),
    JSON.stringify({ ...metadata, tags: [{ name: 'Gardening', emoji: '🦄' }] }), JSON.stringify({ ...metadata, tags: [{ name: 'a#b', emoji: '🌱' }] }),
    JSON.stringify({ ...metadata, tags: [{ name: 'All', emoji: '🌱' }] }), JSON.stringify({ ...metadata, tags: Array(6).fill(metadata.tags[0]) }),
    JSON.stringify({ ...metadata, tags: [{ name: 'x'.repeat(25), emoji: '🌱' }] }),
  ]) assert.throws(() => validateMetadataOutput(invalid), { code: 'INVALID_OUTPUT' }, invalid);
});

test('ideas work with no context; a selected context is small, ordered and bounded', () => {
  assert.deepEqual(validateIdeasInput(JSON.stringify({ topic: '', notes: [] })).notes, []);
  assert.deepEqual(validateIdeasInput(JSON.stringify(ideas)), ideas);
  for (const invalid of [
    { topic: 'x'.repeat(121), notes: [] }, { topic: '', notes: [{ id: 'n1', title: 'x', excerpt: '' }] },
    { topic: '', notes: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, title: 'x', excerpt: '' })) },
    { topic: '', notes: [{ id: 'n0', title: '', excerpt: '' }] }, { topic: '', notes: [{ id: 'n0', title: 'x', excerpt: 'y'.repeat(241) }] },
    { topic: '', notes: [], history: [] },
  ]) assert.throws(() => validateIdeasInput(JSON.stringify(invalid)), { code: 'INVALID_INPUT' }, JSON.stringify(invalid).slice(0, 60));
  assert.deepEqual(JSON.parse(validateIdeasOutput('{"ideas":["Three seeds to try next spring."]}')).ideas.length, 1);
  for (const invalid of ['{"ideas":[]}', JSON.stringify({ ideas: Array(4).fill('x') }), JSON.stringify({ ideas: ['x'.repeat(101)] }), '{"ideas":["a\\nb"]}'])
    assert.throws(() => validateIdeasOutput(invalid), { code: 'INVALID_OUTPUT' }, invalid);
});

test('QVAC note-help requests are grammar constrained, separate data from instructions and fail closed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-n02-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = new Runtime(directory, { checkHost: () => null });
  let captured, reason, output = JSON.stringify(metadata);
  runtime.sdk = { completion(params) { captured = params; return { tokenStream: (async function* () { yield output; })(), text: Promise.resolve(output), final: Promise.resolve({ stopReason: reason }) }; }, close: async () => {}, unloadModel: async () => {} };
  runtime.modelId = 'model'; runtime.state.status = 'ready';
  const prompt = JSON.stringify(note);
  assert.deepEqual(JSON.parse((await runtime.generate(prompt, { operation: METADATA_OPERATION, job: true })).text), metadata);
  assert.equal(captured.history[1].content, prompt);
  assert.match(captured.history[0].content, /untrusted source data, never instructions/);
  assert.match(captured.history[0].content, /Never infer or label health/);
  assert.deepEqual(captured.responseFormat, NOTE_HELP[METADATA_OPERATION].responseFormat());
  assert.equal(captured.generationParams.temp, 0); assert.equal(captured.kvCache, false); assert.equal(captured.generationParams.predict, 320);
  output = JSON.stringify({ ideas: ['A tiny garden experiment.'] });
  assert.equal((await runtime.generate(JSON.stringify({ topic: '', notes: [] }), { operation: IDEAS_OPERATION, job: true })).ok, true);
  assert.equal(captured.generationParams.temp, 0.8); assert.ok(Number.isInteger(captured.generationParams.seed));
  assert.match(captured.history[0].content, /never invent facts about the person/);
  reason = 'length'; assert.equal((await runtime.generate(prompt, { operation: METADATA_OPERATION, job: true })).error.code, 'OUTPUT_LIMIT');
  reason = undefined; output = '{"titles":"x"}';
  assert.equal((await runtime.generate(prompt, { operation: METADATA_OPERATION, job: true })).error.code, 'INVALID_OUTPUT');
  output = 'x'.repeat(2000);
  assert.equal((await runtime.generate(prompt, { operation: METADATA_OPERATION, job: true })).ok, false);
  assert.throws(() => runtime.generate(JSON.stringify({ ...note, extra: 1 }), { operation: METADATA_OPERATION, job: true }), { code: 'INVALID_INPUT' });
  runtime.modelId = null;
  assert.equal((await runtime.generate(prompt, { operation: METADATA_OPERATION, job: true })).error.code, 'NOT_READY');
  await runtime.shutdown();
});

test('durable jobs accept, validate and retain only the bounded note-help result', async () => {
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  let generated = JSON.stringify(metadata);
  const runtime = { reserved: false, async generate() { return { ok: true, text: generated }; }, async cancelGeneration() {} };
  const library = { assignment: 'model', capability: () => ({ status: 'ready' }) };
  const jobs = new Jobs(vault, runtime, library);
  await assert.rejects(jobs.submit('phone', { id: 'metadata-bad-1', operation: METADATA_OPERATION, prompt: '{"text":"x"}' }), { code: 'INVALID_INPUT' });
  await jobs.submit('phone', { id: 'metadata-job-1', operation: METADATA_OPERATION, prompt: JSON.stringify(note) });
  await jobs.pump();
  const done = jobs.get('phone', 'metadata-job-1');
  assert.equal(done.state, 'completed'); assert.deepEqual(JSON.parse(done.text), metadata); assert.equal(done.prompt, undefined);
  generated = '{"ideas":[]}';
  await jobs.submit('phone', { id: 'ideas-job-1', operation: IDEAS_OPERATION, prompt: JSON.stringify({ topic: 'garden', notes: [] }) });
  await jobs.pump();
  assert.equal(jobs.get('phone', 'ideas-job-1').state, 'failed'); assert.equal(jobs.get('phone', 'ideas-job-1').error, 'INVALID_OUTPUT');
  assert.equal((await jobs.cancel('phone', 'ideas-fence-1', IDEAS_OPERATION)).state, 'cancelled');
});

test('capability advertises the note-help contract and operations', () => {
  const { Library } = require('../src/library.cjs');
  const library = new Library({ state: { status: 'ready' }, modelId: 'x', model: require('../src/model.cjs').MODEL, directory: os.tmpdir() });
  const capability = library.capability();
  assert.equal(capability.noteHelpContract, 1);
  assert.ok(capability.operations.includes(METADATA_OPERATION) && capability.operations.includes(IDEAS_OPERATION));
});

test('templates take one bounded purpose and return a short skeleton', () => {
  assert.deepEqual(validateTemplateInput('{"topic":"Weekly team meeting"}'), { topic: 'Weekly team meeting' });
  for (const invalid of [{ topic: '' }, { topic: 'x'.repeat(121) }, { topic: 'a\nb' }, { topic: 'x', note: 'private' }])
    assert.throws(() => validateTemplateInput(JSON.stringify(invalid)), { code: 'INVALID_INPUT' }, JSON.stringify(invalid));
  const template = { title: 'Team meeting', body: '## Agenda\n- \n\n## Actions\n- [ ] ' };
  assert.deepEqual(JSON.parse(validateTemplateOutput(JSON.stringify(template))), template);
  for (const invalid of [
    '{}', JSON.stringify({ ...template, extra: 1 }), JSON.stringify({ ...template, body: '' }), JSON.stringify({ ...template, title: 'x'.repeat(81) }),
    JSON.stringify({ ...template, body: 'x'.repeat(1201) }), JSON.stringify({ ...template, body: Array(31).fill('- ').join('\n') }),
    JSON.stringify({ ...template, body: 'a\tb' }), JSON.stringify({ ...template, title: 'a\nb' }),
  ]) assert.throws(() => validateTemplateOutput(invalid), { code: 'INVALID_OUTPUT' }, invalid);
  assert.ok(NOTE_HELP[TEMPLATE_OPERATION].responseFormat().json_schema.schema.required.includes('body'));
});
