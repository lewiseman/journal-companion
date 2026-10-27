// Explicit command-line verification using synthetic content and real QVAC.
// Never exposed to renderer or LAN clients.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { canonical, fingerprint, deviceId } = require('./device-service.cjs');
async function verifyConnection({ app, window, runtime, vault, library, jobs, devices, directory, summary = false }) {
  const request = (method, route, body, headers = {}, wrongPin = false) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = https.request({ host: '127.0.0.1', port: devices.port, method, path: route, agent: false,
      rejectUnauthorized: false,
      headers: { 'x-journal-version': '1', ...headers, ...(raw ? { 'Content-Length': Buffer.byteLength(raw), 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(data) }));
    });
    req.on('socket', (socket) => socket.once('secureConnect', () => {
      // Electron's embedded TLS has different CA plumbing than stock Node.
      // Pin the peer before sending even the HTTP headers or request body.
      if (wrongPin || fingerprint(socket.getPeerCertificate().raw) !== devices.pin) req.destroy(new Error('Expected test identity rejection'));
      else req.end(raw);
    }));
    req.on('error', reject);
  });
  const clientKey = summary ? 'summaryDemoClient' : 'demoClient';
  let client = vault.value[clientKey];
  const phase = client ? 2 : 1;
  const report = { phase, packaged: app.isPackaged, electron: process.versions.electron, qvac: '0.22.0', syntheticClient: true, operation: summary ? 'summarize-note' : 'text', checks: {} };
  if (summary && process.argv.includes('--offline-summary')) {
    const net = require('node:net');
    const error = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '1.1.1.1', port: 443 });
      socket.once('connect', () => { socket.destroy(); reject(new Error('External network was reachable')); });
      socket.once('error', resolve); socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('External probe timed out; OS denial was not proven')); });
    });
    assert.ok(['EPERM', 'EACCES'].includes(error.code)); report.checks.externalLiteralIpBlockedByOS = true;
  }
  assert.equal(app.isPackaged, true); assert.equal(runtime.state.status, 'ready');
  if (!client) {
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
    client = { privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey, id: deviceId(publicKey), jobId: summary ? 'packaged_summary_request' : 'packaged_synthetic_request' };
    const qr = JSON.parse((await devices.openPairing()).code), name = 'Packaged synthetic client';
    const enrollment = { secret: qr.secret, name, publicKey,
      proof: crypto.sign(null, Buffer.from(`pair-v1\n${devices.identity.id}\n${qr.secret}\n${publicKey}\n${name}`), client.privateKey).toString('base64') };
    const pending = await request('POST', '/v1/pair', enrollment); assert.equal(pending.status, 200);
    assert.equal((await request('GET', '/v1/status')).status, 401); report.checks.unauthorized = true;
    const approve = await window.webContents.executeJavaScript(`window.companion.approve(${JSON.stringify(pending.value.ticket)}, true)`);
    assert.equal(approve.ok, true); report.checks.rendererApproval = true;
    await vault.change((data) => { data[clientKey] = client; });
  }
  const auth = async (method, route, body) => {
    const nonce = (await request('GET', '/v1/challenge')).value.nonce;
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signature = crypto.sign(null, Buffer.from(canonical(client.id, method, route, nonce, raw)), client.privateKey).toString('base64');
    return request(method, route, body, { 'x-journal-device': client.id, 'x-journal-nonce': nonce, 'x-journal-signature': signature });
  };
  const status = await auth('GET', '/v1/status'); assert.equal(status.value.capabilities[0].status, 'ready'); report.checks.authenticatedReadiness = true;
  await library.assign(library.assignment); report.checks.persistedAssignment = true;
  await assert.rejects(request('GET', '/v1/info', undefined, {}, true)); report.checks.identityMismatch = true;
  assert.equal((await request('GET', '/v1/info', undefined, { 'x-journal-version': '2' })).status, 426); report.checks.versionMismatch = true;
  if (phase === 1) {
    const input = { id: client.jobId, operation: summary ? 'summarize-note' : 'text', prompt: summary ? 'Project meeting\n\nThe project meeting is on Friday. Mira will bring the draft. Budget approval remains pending.' : 'Give two short writing prompts about a quiet garden.' };
    if (summary) {
      await runtime.unload();
      assert.equal((await auth('POST', '/v1/jobs', input)).value.error.code, 'NOT_READY');
      report.checks.missingModel = true;
      assert.equal((await runtime.load()).ok, true);
    }
    // Discard the first acceptance to exercise a lost acknowledgment retry.
    assert.equal((await auth('POST', '/v1/jobs', input)).status, 200);
    const duplicate = await auth('POST', '/v1/jobs', input); assert.equal(duplicate.value.id, input.id); report.checks.lostAckDuplicate = true;
    if (summary) {
      const activity = jobs.list().find((j) => j.id === input.id);
      assert.equal(activity.operation, 'summarize-note'); assert.equal(activity.deviceName, 'Packaged synthetic client');
      assert.equal(activity.text, undefined); assert.equal(activity.prompt, undefined); report.checks.activityAttribution = true;
    }
    const deadline = Date.now() + 90000; let result;
    while (Date.now() < deadline) {
      result = (await auth('GET', `/v1/jobs/${input.id}`)).value;
      if (result.state === 'completed' || result.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(result.state, 'completed', JSON.stringify(result)); assert.ok(result.text.length > 10);
    report.checks.realInferenceAfterDetach = true; report.output = result.text;
    if (summary) { assert.match(result.text, /Friday/i); assert.match(result.text, /pending|approval/i); report.checks.factualSyntheticSummary = true; }
    if (summary) {
      const boundedPrompt = ('Project update. The meeting is Friday. Budget approval remains pending. '.repeat(40)).slice(0, 2000);
      const boundaryId = 'summary_input_boundary';
      assert.equal(Buffer.byteLength(boundedPrompt), 2000);
      assert.equal((await auth('POST', '/v1/jobs', { id: boundaryId, operation: 'summarize-note', prompt: boundedPrompt })).status, 200);
      let boundary; const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        boundary = (await auth('GET', `/v1/jobs/${boundaryId}`)).value;
        if (['completed', 'failed'].includes(boundary.state)) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.equal(boundary.state, 'completed', JSON.stringify(boundary));
      assert.ok(Buffer.byteLength(boundary.text) <= 2048); report.checks.realInferenceAt2000ByteInputLimit = true;
      report.boundaryOutput = boundary.text;
    }
    const cancelledId = 'packaged_cancel_request';
    await auth('POST', '/v1/jobs', { id: cancelledId, operation: summary ? 'summarize-note' : 'text', prompt: 'Write a long fictional description of a peaceful garden.' });
    const cancellation = await auth('POST', `/v1/jobs/${cancelledId}/cancel`, {});
    assert.ok(['cancelled', 'completed'].includes(cancellation.value.state));
    if (cancellation.value.state === 'cancelled') assert.equal(cancellation.value.text, undefined);
    report.checks.realCancellationCompletionRace = cancellation.value.state;
    const settleDeadline = Date.now() + 10000;
    while (runtime.busy && Date.now() < settleDeadline) await new Promise((r) => setTimeout(r, 50));
    assert.equal(runtime.state.status, 'ready'); report.checks.modelReadyAfterCancellation = true;
    const bytes = await fs.readFile(vault.file); assert.equal(bytes.includes(Buffer.from(input.prompt)), false); assert.equal(bytes.includes(Buffer.from(result.text)), false); report.checks.encryptedAtRest = true;
  } else {
    const result = (await auth('GET', `/v1/jobs/${client.jobId}`)).value;
    assert.equal(result.state, 'completed'); assert.ok(result.text.length > 10); report.checks.resultAfterDesktopRestart = true;
    await devices.revoke(client.id);
    assert.equal((await auth('GET', `/v1/jobs/${client.jobId}`)).status, 401);
    assert.equal(Object.values(vault.value.jobs).some((j) => j.device === client.id), false); report.checks.revocationAndCleanup = true;
    await vault.change((data) => { delete data[clientKey]; });
  }
  await devices.openPairing(); devices.pairing.expires = Date.now() - 1;
  assert.equal((await request('POST', '/v1/pair', {})).value.error.code, 'PAIRING_EXPIRED'); report.checks.expiredPairingWithAdvancedClock = true;
  await fs.writeFile(path.join(directory, `${summary ? 'summary' : 'connection'}-native-${phase}.json`), JSON.stringify(report, null, 2));
}
module.exports = { verifyConnection };
