const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(root, 'evidence-local/connection-native'));
const model = process.argv[3];
const summary = process.argv.includes('--summary');
if (!model || !path.isAbsolute(model)) throw new Error('Supply the absolute verified model path as the second argument');
fs.mkdirSync(path.join(directory, 'app-data'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(directory, 'app-data/model.json'), JSON.stringify({ path: model }), { mode: 0o600 });
const executable = path.join(root, 'out/Journal Companion-darwin-arm64/Journal Companion.app/Contents/MacOS/Journal Companion');
for (const phase of [1, 2]) {
  const args = [`--connection-demo=${directory}`, summary ? '--verify-summary' : '--verify-connection', ...(summary ? ['--demo-port=47923'] : [])];
  let command = executable;
  if (summary && process.argv.includes('--offline')) {
    const frameworkDir = path.join(path.dirname(path.dirname(executable)), 'Frameworks');
    const helpers = ['', ' (GPU)', ' (Renderer)', ' (Plugin)'].map((suffix) => {
      const name = `Journal Companion Helper${suffix}`;
      return `(literal ${JSON.stringify(path.join(frameworkDir, `${name}.app`, 'Contents', 'MacOS', name))})`;
    });
    const profile = `(version 1) (allow default) (deny network-outbound (remote ip "*:*")) (allow network-outbound (remote ip "localhost:*")) (allow process-exec (with no-sandbox) ${helpers.join(' ')})`;
    args.push('--offline-summary'); args.unshift('-p', profile, executable); command = '/usr/bin/sandbox-exec';
  }
  const result = spawnSync(command, args, { cwd: '/private/tmp', stdio: 'inherit', timeout: 180000 });
  assert.equal(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(directory, `${summary ? 'summary' : 'connection'}-native-${phase}.json`), 'utf8'));
  console.log(JSON.stringify(report, null, 2));
}
