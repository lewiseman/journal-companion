const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(root, 'evidence-local'));
const executable = path.join(root, 'out/Journal Companion-darwin-arm64/Journal Companion.app/Contents/MacOS/Journal Companion');
const offline = process.argv.includes('--offline');
const provision = process.argv.includes('--provision');
if (offline && provision) throw new Error('Provision online first, then restart offline');
const args = [`--verify-d01=${directory}`, ...(offline ? ['--offline-d01'] : []), ...(provision ? ['--provision-d01'] : [])];
fs.mkdirSync(directory, { recursive: true });
let command = executable;
if (offline) {
  // Block IP ingress/egress for main + native inference. Electron Helpers must
  // install Chromium's own sandbox, which cannot be nested inside Seatbelt.
  // Exempt only these exact helper executables from inheritance; renderer
  // requests remain denied by CSP + Electron session policy. Bare is NOT exempt.
  const frameworkDir = path.join(path.dirname(path.dirname(executable)), 'Frameworks');
  const helpers = ['', ' (GPU)', ' (Renderer)', ' (Plugin)'].map((suffix) => {
    const name = `Journal Companion Helper${suffix}`;
    const file = path.join(frameworkDir, `${name}.app`, 'Contents', 'MacOS', name);
    return `(literal ${JSON.stringify(file)})`;
  });
  // ps is a fixed diagnostic invocation in the CLI harness, not an app API.
  const profile = `(version 1) (allow default) (deny network-outbound (remote ip "*:*")) (deny network-inbound (local ip "*:*")) (allow process-exec (with no-sandbox) ${helpers.join(' ')} (literal "/bin/ps"))`;
  command = '/usr/bin/sandbox-exec'; args.unshift('-p', profile, executable);
}
const result = spawnSync(command, args, { cwd: '/private/tmp', stdio: 'inherit', timeout: provision ? 900000 : 300000 });
assert.equal(result.error, undefined, String(result.error));
assert.equal(result.status, 0, `Packaged app failed (${result.signal || result.status})`);
const report = JSON.parse(fs.readFileSync(path.join(directory, offline ? 'offline.json' : 'online.json'), 'utf8'));
assert.equal(report.packaged, true);
assert.equal(report.failure, undefined);
for (const pid of report.quitWorkerPids) {
  let alive = true;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
  assert.equal(alive, false, `Worker ${pid} must exit with app`);
}
report.checks.quitWorkerExited = true;
fs.writeFileSync(path.join(directory, offline ? 'offline.json' : 'online.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: offline ? 'offline' : 'online', checks: report.checks, output: report.output }, null, 2));
