const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const directory = process.argv[2], model = process.argv[3];
const presentation = process.argv.includes('--presentation'), diary = process.argv.includes('--diary'), question = process.argv.includes('--question'), history = process.argv.includes('--history');
const mode = history ? 'history' : question ? 'question' : diary ? 'diary' : presentation ? 'presentation' : 'notes';
if (!directory || !model || !path.isAbsolute(directory) || !path.isAbsolute(model)) throw new Error('Supply absolute isolated evidence directory and verified model path');
if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('Choose a new empty isolated evidence directory.');
fs.mkdirSync(path.join(directory, 'app-data'), { recursive: true, mode: 0o700 });
// Optional --model-id=<catalog id> verifies a model other than the default.
const modelId = process.argv.find((arg) => arg.startsWith('--model-id='))?.slice('--model-id='.length);
fs.writeFileSync(path.join(directory, 'app-data/model.json'), JSON.stringify(modelId ? { path: model, modelId } : { path: model }), { mode: 0o600 });
const executable = path.join(root, 'out/Journal Companion-darwin-arm64/Journal Companion.app/Contents/MacOS/Journal Companion');
for (const phase of [1, 2]) {
  const result = spawnSync(executable, [`--connection-demo=${directory}`, '--demo-port=47926', `--verify-${mode}`], { cwd: '/private/tmp', stdio: 'inherit', timeout: 180000 });
  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(directory, `${mode}-native-${phase}.json`), 'utf8'));
  assert.equal(report.phase, phase); console.log(JSON.stringify(report));
}
