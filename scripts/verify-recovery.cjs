const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const directory = process.argv[2], model = process.argv[3];
if (!directory || !model || !path.isAbsolute(directory) || !path.isAbsolute(model)) throw new Error('Supply absolute isolated evidence directory and verified model path');
fs.mkdirSync(path.join(directory, 'app-data'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(directory, 'app-data/model.json'), JSON.stringify({ path: model }), { mode: 0o600 });
const executable = path.join(root, 'out/Journal Companion-darwin-arm64/Journal Companion.app/Contents/MacOS/Journal Companion');
for (const phase of [1, 2]) {
  const result = spawnSync(executable, [`--connection-demo=${directory}`, '--demo-port=47924', '--verify-recovery'], { cwd: '/private/tmp', stdio: 'inherit', timeout: 180000 });
  if (phase === 1) assert.equal(result.signal, 'SIGKILL');
  else assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(directory, `recovery-native-${phase}.json`), 'utf8'));
  assert.equal(report.phase, phase); console.log(JSON.stringify(report));
}
