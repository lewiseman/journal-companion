// Opt-in packaged process-crash demonstration. Synthetic notes/client only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { canonical, deviceId, fingerprint } = require('./device-service.cjs');
const { RETENTION } = require('./jobs.cjs');
async function verifyRecovery({ app, runtime, vault, library, jobs, devices, directory }) {
  const request = (method, route, body, headers = {}) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = https.request({ host: '127.0.0.1', port: devices.port, method, path: route, agent: false, rejectUnauthorized: false,
      headers: { 'x-journal-version': '1', ...headers, ...(raw ? { 'Content-Length': Buffer.byteLength(raw) } : {}) } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('socket', (socket) => socket.once('secureConnect', () => {
      if (fingerprint(socket.getPeerCertificate().raw) !== devices.pin) req.destroy(new Error('Pin mismatch'));
      else req.end(raw);
    })); req.on('error', reject);
  });
  assert.equal(app.isPackaged, true); assert.ok(['ready', 'working'].includes(runtime.state.status));
  let client = vault.value.recoveryDemoClient;
  const phase = client ? 2 : 1;
  if (!client) {
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
    client = { privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey, id: deviceId(publicKey) };
    // Isolated CLI-only synthetic enrollment; production phone uses approval UI.
    await vault.change((data) => { data.recoveryDemoClient = client; data.devices[client.id] = { id: client.id, name: 'R01 crash demo', publicKey }; data.enabled = true; });
  }
  await devices.start();
  const auth = async (method, route, body) => {
    const { nonce } = await request('GET', '/v1/challenge');
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signature = crypto.sign(null, Buffer.from(canonical(client.id, method, route, nonce, raw)), client.privateKey).toString('base64');
    const value = await request(method, route, body, { 'x-journal-device': client.id, 'x-journal-nonce': nonce, 'x-journal-signature': signature });
    if (value.error && typeof value.error === 'object') throw new Error(value.error.code); return value;
  };
  const submit = (id, prompt = 'Project meeting. The meeting is Friday. Budget approval is pending.') => auth('POST', '/v1/jobs', { id, operation: 'summarize-note', prompt, expires: Date.now() + RETENTION });
  const get = (id) => auth('GET', `/v1/jobs/${id}`);
  const until = async (predicate) => {
    const deadline = Date.now() + 90000;
    while (!await predicate()) { if (Date.now() > deadline) throw new Error('Recovery verification timed out'); await new Promise((r) => setTimeout(r, 50)); }
  };
  const report = { phase, packaged: true, electron: process.versions.electron, qvac: '0.22.0', syntheticClient: true, checks: {} };
  if (phase === 1) {
    await submit('recovery_completed');
    await until(async () => (await get('recovery_completed')).state === 'completed');
    await submit('recovery_acknowledged');
    await until(async () => (await get('recovery_acknowledged')).state === 'completed');
    await auth('POST', '/v1/jobs/recovery_acknowledged/ack', {});
    await auth('POST', '/v1/jobs/recovery_acknowledged/ack', {});
    assert.equal((await get('recovery_acknowledged')).text, undefined);
    report.checks.repeatableAcknowledgment = true;
    // Treat the real signed acceptance as lost and retry exactly the same identity.
    const duplicate = await submit('recovery_completed');
    assert.equal(duplicate.state, 'completed');
    report.checks.retryAfterDiscardedAcceptanceUsesSameJob = true;
    await submit('recovery_running', 'A project meeting is Friday. '.repeat(60));
    await submit('recovery_queued');
    assert.equal(vault.value.jobs[`${client.id}:recovery_running`].state, 'running');
    assert.equal(vault.value.jobs[`${client.id}:recovery_queued`].state, 'queued');
    report.checks.realRunningAndQueuedAtAbruptExit = true;
    require('node:fs').writeFileSync(path.join(directory, 'recovery-native-1.json'), JSON.stringify(report, null, 2));
    // Synchronous SIGKILL: no graceful worker callback can publish before death.
    process.kill(process.pid, 'SIGKILL');
    return;
  }
  assert.equal((await get('recovery_running')).state, 'interrupted');
  assert.equal((await get('recovery_running')).error, 'DESKTOP_RESTARTED');
  assert.equal(vault.value.jobs[`${client.id}:recovery_running`].prompt, undefined);
  report.checks.runningBecameTruthfulInterruptedFailure = true;
  await until(async () => ['completed', 'failed'].includes((await get('recovery_queued')).state));
  assert.equal((await get('recovery_queued')).state, 'completed');
  report.checks.queuedContinuedWithRealQvacAfterRestart = true;
  assert.equal((await get('recovery_completed')).state, 'completed');
  assert.ok((await get('recovery_completed')).text.length > 10);
  report.checks.completedResultSurvivedRestart = true;
  const receipt = await submit('recovery_acknowledged');
  assert.equal(receipt.acknowledged, true); assert.equal(receipt.text, undefined);
  report.checks.acknowledgedTaskDidNotRunAgain = true;
  await submit('recovery_cancel_race', 'A quiet garden has many flowers. '.repeat(50));
  const cancellation = await auth('POST', '/v1/jobs/recovery_cancel_race/cancel', {});
  assert.ok(['cancelled', 'completed'].includes(cancellation.state));
  await until(() => !jobs.pumping);
  assert.equal((await get('recovery_cancel_race')).state, cancellation.state);
  report.checks.realCancellationCompletionRace = cancellation.state;
  await auth('POST', '/v1/jobs/recovery_cancel_fence/cancel', {});
  assert.equal((await submit('recovery_cancel_fence')).state, 'cancelled');
  report.checks.cancelFencesDelayedSubmission = true;
  jobs.now = () => Date.now() + RETENTION + 60000; // Explicit synthetic clock advance.
  await jobs.cleanup();
  assert.equal((await get('recovery_completed')).state, 'expired');
  assert.equal((await get('recovery_completed')).text, undefined);
  assert.equal(vault.value.jobs[`${client.id}:recovery_completed`].text, undefined);
  report.checks.expiryWithAdvancedClockRemovedPrivateResult = true;
  await devices.revoke(client.id);
  await vault.change((data) => { delete data.recoveryDemoClient; });
  await fs.writeFile(path.join(directory, 'recovery-native-2.json'), JSON.stringify(report, null, 2));
  app.quit();
}
module.exports = { verifyRecovery };
