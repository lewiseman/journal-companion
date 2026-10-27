// Explicit command-line-only host verification. Never exposed over IPC.
// Saves synthetic demo output only, to the caller's chosen local directory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

async function waitFor(predicate, timeout = 90000) {
  const start = Date.now();
  while (!await predicate()) {
    if (Date.now() - start > timeout) throw new Error('Verification timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
function bareChildren() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match && Number(match[2]) === process.pid && /bare-runtime.*\/bare(?: |$)/.test(match[3]) ? [Number(match[1])] : [];
  });
}
async function verify({ app, window, runtime, directory, provision, offline }) {
  await fs.mkdir(directory, { recursive: true });
  const report = {
    platform: process.platform, arch: process.arch, os: os.release(), cpu: os.cpus()[0].model, ramBytes: os.totalmem(),
    electron: process.versions.electron, node: process.versions.node, packaged: app.isPackaged,
    provision, offline, checks: {}, states: [],
  };
  runtime.on('state', (state) => report.states.push({ status: state.status, code: state.error?.code }));
  const js = (source) => window.webContents.executeJavaScript(source);
  try {
    if (offline) {
      // A literal external IP avoids mistaking a DNS-only failure for a network block.
      report.checks.externalNetworkUnavailable = await fetch('https://1.1.1.1', { signal: AbortSignal.timeout(5000) }).then(() => false, () => true);
      assert.equal(report.checks.externalNetworkUnavailable, true);
    }
    if (provision) {
      assert.equal(runtime.state.status, 'unavailable');
      await js('document.getElementById("download").click()');
      await waitFor(() => ['ready', 'failed'].includes(runtime.state.status), 300000);
    }
    assert.equal(runtime.state.status, 'ready', JSON.stringify(runtime.state.error));
    report.checks.coldLoad = true;
    report.checks.rendererIsolation = await js('typeof require === "undefined" && typeof process === "undefined" && typeof window.companion.generate === "function"');
    const prefs = window.webContents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(report.checks.rendererIsolation, true);
    report.checks.rendererSandbox = true;
    report.checks.rendererNetworkBlocked = await js('fetch("https://example.com").then(() => false, () => true)');
    assert.equal(report.checks.rendererNetworkBlocked, true);
    const invalid = await js('window.companion.generate("x".repeat(2001))');
    assert.equal(invalid.error.code, 'INVALID_INPUT'); report.checks.ipcValidation = true;
    await js('document.getElementById("prompt").value = "Give me three short journal prompts about a peaceful walk."; document.getElementById("prompt-form").requestSubmit()');
    await waitFor(() => runtime.state.status === 'working');
    // A scheduled DOM update must run while inference is active.
    assert.equal(await js('new Promise(r => requestAnimationFrame(() => r(true)))'), true);
    report.checks.responsiveRenderer = true;
    await waitFor(() => runtime.state.status !== 'working');
    assert.equal(runtime.state.status, 'ready', JSON.stringify(runtime.state.error));
    report.output = await js('document.getElementById("response").textContent');
    assert.ok(report.output.trim().length > 20); report.checks.realCompletion = true;
    await fs.writeFile(path.join(directory, 'companion.png'), (await window.webContents.capturePage()).toPNG());
    const info = await runtime.sdk.getLoadedModelInfo({ modelId: runtime.modelId });
    report.runtimeInfo = info;
    const workers = bareChildren();
    assert.equal(workers.length, 1, 'Find exactly one actual Bare worker');
    report.workerPid = workers[0];
    await js('window.companion.unload()');
    assert.equal(runtime.state.status, 'unavailable');
    await waitFor(() => bareChildren().length === 0, 10000);
    report.checks.unloadWorkerExited = true;
    assert.equal((await js('window.companion.load()')).ok, true);
    report.checks.reload = true;
    // Crash the real native worker while idle; monitor must revoke readiness.
    process.kill(bareChildren()[0], 'SIGKILL');
    await waitFor(() => runtime.state.status === 'failed', 20000);
    report.checks.actualWorkerCrash = runtime.state.error.code === 'WORKER_FAILED';
    assert.equal(report.checks.actualWorkerCrash, true);
    assert.equal((await js('window.companion.load()')).ok, true);
    report.checks.crashRecovery = runtime.state.status === 'ready';
    report.quitWorkerPids = bareChildren();
    await js('document.getElementById("clear").click()');
    report.checks.clear = await js('document.getElementById("prompt").value === "" && document.getElementById("response").classList.contains("empty")');
  } catch (error) {
    report.failure = error.message; throw error;
  } finally {
    await fs.writeFile(path.join(directory, offline ? 'offline.json' : 'online.json'), JSON.stringify(report, null, 2));
  }
}
module.exports = { verify };
