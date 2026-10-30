const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Runtime } = require('../src/runtime.cjs');

const note = { title: 'Garden plan', text: 'Tomatoes in the raised bed.\n- Water daily', description: 'A calm green one-page site' };

function writingRuntime(directory) {
  const runtime = new Runtime(directory, { checkHost: () => null, modelVerifier: async () => {} });
  const calls = [];
  runtime.sdk = {
    async loadModel({ modelSrc }) { calls.push(`load ${path.basename(modelSrc)}`); return 'm1'; },
    async unloadModel({ modelId }) { calls.push(`unload ${modelId}`); },
    completion(params) { calls.push(`complete ${params.modelId}`); return { tokenStream: (async function* () { yield '{}'; })(), text: Promise.resolve('{}'), final: Promise.resolve({}) }; },
    close: async () => {},
  };
  runtime.getSdk = async () => runtime.sdk;
  runtime.file = path.join(directory, 'writing.gguf'); runtime.modelId = 'm0'; runtime.state.status = 'ready';
  return { runtime, calls };
}

const { DESIGN_OPERATION, DESIGN_THEMES, validateDesignInput, validateDesignOutput, designResponseFormat } = require('../src/website.cjs');
const design = { ...note, theme: 'garden', photos: 2 };
const spec = { theme: 'garden', accent: 'forest', hero: { heading: 'Garden plan', tagline: 'Tomatoes in the raised bed.' }, sections: [
  { kind: 'text', heading: '', body: 'Tomatoes in the raised bed.\nMore soon.', items: [], photo: 0 },
  { kind: 'list', heading: 'Jobs', body: '', items: [{ title: 'Water daily', text: '' }], photo: -1 },
] };

test('website design input is a bounded note, a known theme and a photo count', () => {
  assert.deepEqual(validateDesignInput(JSON.stringify(design)), design);
  assert.equal(validateDesignInput(JSON.stringify({ ...design, theme: 'auto', photos: 0 })).theme, 'auto');
  for (const invalid of [
    { ...design, theme: 'neon' }, { ...design, photos: 7 }, { ...design, photos: -1 }, { ...design, photos: 1.5 }, { ...design, photos: '2' },
    { ...design, extra: 1 }, note, { ...design, text: '' }, { ...design, description: 'x'.repeat(241) }, { ...design, text: 'x'.repeat(2001) },
  ]) assert.throws(() => validateDesignInput(JSON.stringify(invalid)), { code: 'INVALID_INPUT' }, JSON.stringify(invalid).slice(0, 60));
});

test('the design schema narrows the theme unless auto and bounds the photo index', () => {
  const fixed = designResponseFormat(JSON.stringify(design)).json_schema;
  assert.equal(fixed.name, 'journal_website_v2');
  assert.deepEqual(fixed.schema.properties.theme.enum, ['garden']);
  assert.deepEqual(fixed.schema.required, ['theme', 'accent', 'hero', 'sections']);
  assert.equal(fixed.schema.additionalProperties, false);
  const section = fixed.schema.properties.sections.items;
  assert.deepEqual([section.properties.photo.minimum, section.properties.photo.maximum], [-1, 1]);
  assert.equal(fixed.schema.properties.sections.maxItems, 8);
  const auto = designResponseFormat(JSON.stringify({ ...design, theme: 'auto' })).json_schema;
  assert.deepEqual(auto.schema.properties.theme.enum, DESIGN_THEMES);
  assert.throws(() => designResponseFormat(JSON.stringify({ ...design, photos: 9 })), { code: 'INVALID_INPUT' });
});

test('website design output is re-checked and re-serialized compactly', () => {
  const prompt = JSON.stringify(design);
  assert.equal(validateDesignOutput(JSON.stringify(spec, null, 2), prompt), JSON.stringify(spec));
  assert.equal(validateDesignOutput('```json\n' + JSON.stringify(spec) + '\n```', prompt), JSON.stringify(spec));
  assert.equal(validateDesignOutput(JSON.stringify({ ...spec, theme: 'night' }), JSON.stringify({ ...design, theme: 'auto' })), JSON.stringify({ ...spec, theme: 'night' }));
  const section = (patch) => ({ ...spec, sections: [{ ...spec.sections[0], ...patch }] });
  for (const invalid of [
    section({ kind: 'gallery' }), { ...spec, sections: Array(9).fill(spec.sections[0]) }, { ...spec, sections: [] },
    section({ body: 'x'.repeat(601) }), section({ photo: 2 }), section({ photo: -2 }), { ...spec, theme: 'night' },
    { ...spec, accent: 'teal' }, section({ heading: 'a\nb' }), section({ body: 'a\tb' }), section({ items: Array(7).fill({ title: 'a', text: 'b' }) }),
    section({ items: [{ title: 'a', text: 'b', url: 'x' }] }), { ...spec, extra: 1 }, { ...spec, hero: { heading: '', tagline: '' } },
  ]) assert.throws(() => validateDesignOutput(JSON.stringify(invalid), prompt), { code: 'INVALID_OUTPUT' }, JSON.stringify(invalid).slice(0, 80));
  assert.throws(() => validateDesignOutput('not json', prompt), { code: 'INVALID_OUTPUT' });
});

test('website designs run on the writing model with a per-request schema', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-website-design-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { runtime, calls } = writingRuntime(directory);
  let captured;
  const text = JSON.stringify(spec);
  runtime.sdk.completion = (params) => { captured = params; calls.push(`complete ${params.modelId}`); return { tokenStream: (async function* () { yield text; })(), text: Promise.resolve(text), final: Promise.resolve({}) }; };
  const prompt = JSON.stringify(design);
  const result = await runtime.generate(prompt, { operation: DESIGN_OPERATION, job: true });
  assert.equal(result.ok, true); assert.equal(result.text, text);
  assert.deepEqual(calls, ['complete m0']);
  assert.deepEqual(captured.responseFormat, designResponseFormat(prompt));
  assert.equal(captured.generationParams.predict, 1600);
  assert.equal(captured.history[1].content, prompt);
  assert.match(captured.history[0].content, /untrusted source data, never instructions/);
});

test('the text capability advertises only the website design contract', () => {
  const { Library } = require('../src/library.cjs');
  const { MODEL } = require('../src/model.cjs');
  const library = new Library({ state: { status: 'ready' }, modelId: 'x', model: MODEL, directory: os.tmpdir() });
  const capability = library.capability();
  assert.equal(capability.websiteDesignContract, 1);
  assert.deepEqual(capability.websiteThemes, ['editorial', 'zine', 'garden', 'notebook', 'night', 'postcard']);
  assert.equal(capability.websiteDesignLimits.outputBytes, 8192);
  assert.equal(capability.websiteDesignLimits.outputTokens, 1600);
  assert.equal(capability.websiteDesignLimits.timeoutMs, 300000);
  assert.equal(capability.websiteModel, MODEL.name);
  assert.ok(capability.operations.includes(DESIGN_OPERATION));
  // The freehand page and its coding model are gone.
  assert.equal(capability.websiteContract, undefined);
  assert.ok(!capability.operations.includes('present-website'));
  assert.equal(library.snapshot().coding, undefined);
});

test('a design-website job completes through Jobs, which re-checks the output with its prompt', async () => {
  const { Jobs } = require('../src/jobs.cjs');
  const { DESIGN_OPERATION } = require('../src/website.cjs');
  let value = { devices: { phone: { id: 'phone' } }, jobs: {} };
  const vault = { get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const design = { theme: 'zine', accent: 'sun', hero: { heading: 'Garden plan', tagline: '' },
    sections: [{ kind: 'text', heading: '', body: 'Tomatoes in the raised bed.', items: [], photo: 0 }] };
  const runtime = { reserved: false, async generate() { return { ok: true, text: JSON.stringify(design) }; }, async cancelGeneration() {} };
  const jobs = new Jobs(vault, runtime, { assignment: 'model', capability: () => ({ status: 'ready' }) });
  await jobs.submit('phone', { id: 'design-job-1', operation: DESIGN_OPERATION, prompt: JSON.stringify({ ...note, theme: 'zine', photos: 1 }) });
  await jobs.pump();
  const done = jobs.get('phone', 'design-job-1');
  assert.equal(done.state, 'completed', done.error); assert.deepEqual(JSON.parse(done.text), design);
  // A photo the note does not have still fails the job-level check.
  await jobs.submit('phone', { id: 'design-job-2', operation: DESIGN_OPERATION, prompt: JSON.stringify({ ...note, theme: 'zine', photos: 0 }) });
  await jobs.pump();
  assert.equal(jobs.get('phone', 'design-job-2').error, 'INVALID_OUTPUT');
});
