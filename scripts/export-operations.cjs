// Desktop prompt modules are authoritative. No inference or native dependencies.
const fs = require('node:fs');
const path = require('node:path');
const summary = require('../src/summary.cjs');
const transform = require('../src/transform.cjs');
const { NOTE_HELP } = require('../src/note-help.cjs');
const { WEBSITE } = require('../src/website.cjs');
const background = require('../src/background.cjs');
const { MODELS } = require('../src/model.cjs');
const operations = {};
function add(id, system, limits, responseFormat = null, userEncoding = 'raw', params = { temp: 0, seed: 42 }) {
  operations[id] = { task: 'writing', system, limits, responseFormat, userEncoding, params };
}
add(summary.SUMMARY_OPERATION, summary.SUMMARY_SYSTEM, summary.SUMMARY_LIMITS, null, 'note');
for (const id of Object.keys(transform.OPERATIONS)) add(id, transform.transformSystem(id), transform.TRANSFORM_LIMITS);
for (const [file, prefix, format] of [
  ['diary', 'DIARY', 'diaryResponseFormat'], ['question', 'QUESTION', 'questionResponseFormat'],
  ['history', 'HISTORY', 'historyResponseFormat'], ['reflection', 'REFLECTION', null],
]) {
  const m = require(`../src/${file}.cjs`);
  add(m[`${prefix}_OPERATION`], m[`${prefix}_SYSTEM`], m[`${prefix}_LIMITS`], format ? m[format]() : null,
    file === 'reflection' ? 'thought' : 'raw', { temp: file === 'question' ? 0.7 : file === 'reflection' ? 0.4 : 0, seed: file === 'question' || file === 'reflection' ? 'random' : 42 });
}
const question = require('../src/note-question.cjs');
for (const id of question.QUESTION_OPERATIONS) add(id, question.questionSystem(id), question.NOTE_QUESTION_LIMITS, question.noteQuestionResponseFormat());
for (const [id, spec] of Object.entries(NOTE_HELP)) {
  // Websites keep their companion-specific contracts for now.
  if (Object.hasOwn(WEBSITE, id)) continue;
  const params = spec.params();
  add(id, spec.system, spec.limits, spec.responseFormat?.() ?? null, 'raw', { ...params, seed: params.temp === 0 ? 42 : 'random' });
}
operations[background.BACKGROUND_OPERATION] = { task: 'image', limits: { inputBytes: 1000, ...background.BACKGROUND_LIMITS, steps: background.BACKGROUND_DEVICE_SETTINGS.steps },
  prompts: Object.fromEntries(['light', 'dark'].map((tone) => [tone, background.backgroundPrompt({ prompt: '{prompt}', tone })])),
  negativePrompt: background.NEGATIVE, width: background.BACKGROUND_DEVICE_SETTINGS.width, height: background.BACKGROUND_DEVICE_SETTINGS.height };
const catalog = MODELS.filter((m) => !m.parts && m.repository && !m.registry &&
  (m.capability === 'text' || m.id.startsWith('sd-2.1-'))).map((m) => ({
  id: m.id, name: m.name, task: m.capability === 'image' ? 'image' : 'writing', format: 'gguf',
  repository: m.repository, revision: m.revision, file: m.filename, bytes: m.bytes, sha256: m.sha256,
  minRamBytes: m.memoryGB * 1024 ** 3, license: m.license, ...(m.reasoningBudget === undefined ? {} : { reasoningBudget: m.reasoningBudget }),
}));
const targets = {
  'operations.json': { version: 1, operations },
  'models.json': { version: 1, models: catalog },
};
function exportOperations(check = false, directory = path.resolve(__dirname, '../../journal/assets/ai')) {
  for (const [name, value] of Object.entries(targets)) {
    const file = path.join(directory, name), content = JSON.stringify(value, null, 2) + '\n';
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) throw new Error(`${name} is stale. Run npm run export:operations in desktop.`);
    } else { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(file, content); }
  }
}
if (require.main === module) exportOperations(process.argv.includes('--check'));
module.exports = { exportOperations, targets };
