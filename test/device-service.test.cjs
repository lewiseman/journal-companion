const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Vault } = require('../src/vault.cjs');
const { Jobs } = require('../src/jobs.cjs');
const { DeviceService, canonical, deviceId, fingerprint } = require('../src/device-service.cjs');

function syntheticProtector() {
  const key = crypto.randomBytes(32);
  return { isEncryptionAvailable: () => true,
    encryptString(value) { const nonce = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, nonce); const bytes = Buffer.concat([c.update(value), c.final()]); return Buffer.concat([nonce, c.getAuthTag(), bytes]); },
    decryptString(bytes) { const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString(); },
  };
}
async function fixture(t, generate = async () => ({ ok: true, text: 'Synthetic test completion' })) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-connection-'));
  const protector = syntheticProtector(); const vault = new Vault(directory, protector); await vault.initialize();
  const runtime = { generate, cancelGeneration: async () => {} };
  const library = { assignment: 'pinned-text-model', capability: () => ({ id: 'text', status: 'ready', model: 'pinned-text-model', implemented: true }) };
  const jobs = new Jobs(vault, runtime, library); await jobs.initialize();
  let clock = Date.now();
  const service = new DeviceService(vault, library, jobs, { port: 0, host: '127.0.0.1', advertise: false, now: () => clock });
  await service.initialize(); await service.start();
  t.after(async () => { await service.stop(); await jobs.shutdown(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, vault, jobs, service, protector, runtime, advance: (ms) => { clock += ms; } };
}
function phone() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  return { ...pair, raw, id: deviceId(raw) };
}
function request(service, method, route, body, headers = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: service.port, method, path: route,
      ca: service.identity.cert, checkServerIdentity: (_, cert) => fingerprint(cert.raw) === service.pin ? undefined : new Error('Pin mismatch'),
      headers: { 'x-journal-version': '1', ...headers, ...(raw ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}) } }, (res) => {
      let value = ''; res.on('data', (c) => { value += c; }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(value) }));
    }); req.on('error', reject); req.end(raw);
  });
}
async function auth(service, p, method, route, body, { nonce, signature } = {}) {
  nonce ??= (await request(service, 'GET', '/v1/challenge')).value.nonce;
  const raw = body === undefined ? '' : JSON.stringify(body);
  signature ??= crypto.sign(null, Buffer.from(canonical(p.id, method, route, nonce, raw)), p.privateKey).toString('base64');
  return request(service, method, route, body, { 'x-journal-device': p.id, 'x-journal-nonce': nonce, 'x-journal-signature': signature });
}
async function enroll(service, p = phone(), approved = true) {
  service.pairing = { secret: crypto.randomBytes(32).toString('base64url'), expires: service.now() + 120000, attempts: 0 };
  const secret = service.pairing.secret, name = 'Synthetic phone';
  const body = { secret, name, publicKey: p.raw, proof: crypto.sign(null, Buffer.from(`pair-v1\n${service.identity.id}\n${secret}\n${p.raw}\n${name}`), p.privateKey).toString('base64') };
  const result = await request(service, 'POST', '/v1/pair', body); assert.equal(result.status, 200);
  if (approved !== null) await service.approve(result.value.ticket, approved);
  return { p, body, ticket: result.value.ticket };
}
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail('Timed out'); }

test('pinned TLS, explicit approval, signing, replay and browser/version restrictions', async (t) => {
  const { service } = await fixture(t);
  assert.equal((await request(service, 'GET', '/v1/status')).status, 401);
  assert.equal((await request(service, 'GET', '/v1/info')).value.capabilities, undefined);
  assert.equal((await request(service, 'GET', '/v1/info', undefined, { Origin: 'https://attacker.example' })).value.error.code, 'FORBIDDEN');
  assert.equal((await request(service, 'GET', '/v1/info', undefined, { 'x-journal-version': '2' })).status, 426);
  const { p, body, ticket } = await enroll(service, phone(), null);
  assert.equal((await auth(service, p, 'GET', '/v1/status')).status, 401);
  assert.equal((await request(service, 'POST', '/v1/pair', body)).value.error.code, 'PAIRING_EXPIRED');
  await service.approve(ticket, true);
  const nonce = (await request(service, 'GET', '/v1/challenge')).value.nonce;
  assert.equal((await auth(service, p, 'GET', '/v1/status', undefined, { nonce })).value.transport, 'connected');
  assert.equal((await auth(service, p, 'GET', '/v1/status', undefined, { nonce })).status, 401);
  assert.equal((await auth(service, p, 'GET', '/v1/status', undefined, { signature: crypto.randomBytes(64).toString('base64') })).status, 401);
});
test('incorrect, expired and denied pairing; expired challenge and immutable server identity', async (t) => {
  const f = await fixture(t), { service, vault } = f;
  service.pairing = { secret: 'secret', attempts: 0, expires: service.now() + 1000 };
  assert.equal((await request(service, 'POST', '/v1/pair', { secret: 'wrong' })).value.error.code, 'VERIFICATION_FAILED');
  f.advance(2000);
  assert.equal((await request(service, 'POST', '/v1/pair', {})).value.error.code, 'PAIRING_EXPIRED');
  const denied = await enroll(service, phone(), false);
  assert.equal((await request(service, 'POST', '/v1/pair-status', { ticket: denied.ticket })).value.state, 'denied');
  assert.equal((await auth(service, denied.p, 'GET', '/v1/status')).status, 401);
  const { p } = await enroll(service);
  const nonce = (await request(service, 'GET', '/v1/challenge')).value.nonce; f.advance(31000);
  assert.equal((await auth(service, p, 'GET', '/v1/status', undefined, { nonce })).status, 401);
  const pin = service.pin; await service.stop();
  const restored = new DeviceService(vault, service.library, service.jobs, { port: 0, host: '127.0.0.1', advertise: false });
  await restored.initialize(); await restored.start();
  try { assert.equal(restored.pin, pin); assert.equal((await auth(restored, p, 'GET', '/v1/status')).status, 200); }
  finally { await restored.stop(); }
});
test('durable acceptance, lost ack deduplication, result isolation and revoke cleanup', async (t) => {
  let finish; let executions = 0;
  const f = await fixture(t, () => { executions++; return new Promise((r) => { finish = r; }); });
  const { p } = await enroll(f.service); const other = (await enroll(f.service)).p;
  const input = { id: 'synthetic_request_1', operation: 'text', prompt: 'Synthetic private input' };
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', input)).value.state, 'queued');
  await until(() => !!finish);
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', input)).value.id, input.id);
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', { ...input, prompt: 'different' })).value.error.code, 'ID_CONFLICT');
  assert.equal((await auth(f.service, other, 'GET', `/v1/jobs/${input.id}`)).value.error.code, 'NOT_FOUND');
  assert.equal((await fs.readFile(f.vault.file)).includes(Buffer.from(input.prompt)), false);
  finish({ ok: true, text: 'Synthetic retained result' });
  await until(() => f.vault.value.jobs[`${p.id}:${input.id}`].state === 'completed');
  assert.equal(executions, 1);
  assert.equal((await auth(f.service, p, 'GET', `/v1/jobs/${input.id}`)).value.text, 'Synthetic retained result');
  const restored = new Vault(f.directory, f.protector); await restored.initialize();
  assert.equal(restored.value.jobs[`${p.id}:${input.id}`].state, 'completed');
  await f.service.revoke(p.id);
  assert.equal((await auth(f.service, p, 'GET', `/v1/jobs/${input.id}`)).status, 401);
  assert.equal(Object.values(f.vault.value.jobs).filter((j) => j.device === p.id).length, 0);
});
test('cancellation wins completion races and restart honestly classifies running work', async (t) => {
  let finish;
  const f = await fixture(t, () => new Promise((r) => { finish = r; }));
  const { p } = await enroll(f.service);
  await f.jobs.submit(p.id, { id: 'cancel_race_1', operation: 'text', prompt: 'Synthetic input' }); await until(() => !!finish);
  await f.jobs.cancel(p.id, 'cancel_race_1'); finish({ ok: true, text: 'Must not be retained' });
  await until(() => !f.jobs.pumping);
  assert.equal(f.jobs.get(p.id, 'cancel_race_1').state, 'cancelled');
  assert.equal(f.jobs.get(p.id, 'cancel_race_1').text, undefined);
  await f.vault.change((data) => { data.jobs[`${p.id}:restart_case`] = { id: 'restart_case', device: p.id, state: 'running', prompt: 'private', created: Date.now() }; });
  const recovered = new Jobs(f.vault, f.runtime, f.service.library); recovered.stopped = true; await recovered.initialize();
  assert.equal(recovered.get(p.id, 'restart_case').state, 'interrupted'); assert.equal(recovered.get(p.id, 'restart_case').prompt, undefined);
  await recovered.shutdown();
  finish = null;
  await f.jobs.submit(p.id, { id: 'clean_shutdown_case', operation: 'text', prompt: 'Synthetic input interrupted by quit' });
  await until(() => !!finish);
  await f.jobs.shutdown();
  finish({ ok: true, text: 'Must not replace interruption' });
  await until(() => !f.jobs.pumping);
  assert.equal(f.jobs.get(p.id, 'clean_shutdown_case').state, 'interrupted');
  assert.equal(f.jobs.get(p.id, 'clean_shutdown_case').error, 'DESKTOP_STOPPED');
  assert.equal(f.jobs.get(p.id, 'clean_shutdown_case').text, undefined);
  assert.equal(f.vault.value.jobs[`${p.id}:clean_shutdown_case`].prompt, undefined);
});
test('acceptance fails closed if protected persistence fails', async (t) => {
  const f = await fixture(t); const { p } = await enroll(f.service);
  const original = f.protector.encryptString;
  f.protector.encryptString = () => { throw Object.assign(new Error('disk or encryption failed'), { code: 'ENOSPC' }); };
  await assert.rejects(f.jobs.submit(p.id, { id: 'failed_storage', operation: 'text', prompt: 'Synthetic input' }));
  assert.equal(Object.keys(f.vault.value.jobs).length, 0); f.protector.encryptString = original;
});
module.exports = { syntheticProtector, request, auth, enroll };

test('summary contract preserves operation, rejects excess input and invalid output, and retries without duplicate inference', async (t) => {
  let finish, calls = 0, options;
  const f = await fixture(t, (_, captured) => { calls++; options = captured; return new Promise((r) => { finish = r; }); });
  const { p } = await enroll(f.service);
  const input = { id: 'summary_request_1', operation: 'summarize-note', prompt: 'Planning\n\nThe meeting is on Friday. Budget approval is still pending.' };
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', input)).value.operation, 'summarize-note');
  await until(() => !!finish);
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', input)).value.id, input.id);
  assert.equal(calls, 1); assert.equal(options.operation, 'summarize-note');
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', { ...input, operation: 'text' })).value.error.code, 'ID_CONFLICT');
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', { ...input, id: 'too_long_summary', prompt: '🦉'.repeat(501) })).value.error.code, 'INVALID_INPUT');
  finish({ ok: true, text: '  The meeting is Friday; budget approval remains pending.  ' });
  await until(() => f.jobs.get(p.id, input.id).state === 'completed');
  assert.equal(f.jobs.get(p.id, input.id).text, 'The meeting is Friday; budget approval remains pending.');
  assert.equal(f.jobs.list()[0].prompt, undefined); assert.equal(f.jobs.list()[0].text, undefined);
  finish = null;
  await f.jobs.submit(p.id, { ...input, id: 'invalid_summary_output' }); await until(() => !!finish);
  finish({ ok: true, text: '\x00invalid' });
  await until(() => f.jobs.get(p.id, 'invalid_summary_output').state === 'failed');
  assert.equal(f.jobs.get(p.id, 'invalid_summary_output').error, 'INVALID_OUTPUT');
  assert.equal(f.jobs.get(p.id, 'invalid_summary_output').text, undefined);
});

test('acknowledgment is repeatable and leaves a receipt that prevents re-execution after restart', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { ok: true, text: 'Synthetic result retained once' }; });
  const { p } = await enroll(f.service);
  const input = { id: 'ack_receipt_case', operation: 'summarize-note', prompt: 'Synthetic saved note', expires: Date.now() + 60000 };
  await f.jobs.submit(p.id, input);
  await until(() => f.jobs.get(p.id, input.id).state === 'completed');
  await f.jobs.acknowledge(p.id, input.id);
  await f.jobs.acknowledge(p.id, input.id);
  const vault = new Vault(f.directory, f.protector); await vault.initialize();
  const recovered = new Jobs(vault, f.runtime, f.service.library); await recovered.initialize();
  try {
    const receipt = await recovered.submit(p.id, input);
    assert.equal(receipt.state, 'completed'); assert.equal(receipt.acknowledged, true);
    assert.equal(receipt.text, undefined); assert.equal(calls, 1);
  } finally { await recovered.shutdown(); }
});

test('a cancel before a delayed submission fences acceptance, and completion before cancel stays completed', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { ok: true, text: 'Completed before cancel' }; });
  const { p } = await enroll(f.service);
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs/cancel_before_send/cancel', {})).value.state, 'cancelled');
  assert.equal((await f.jobs.submit(p.id, { id: 'cancel_before_send', operation: 'summarize-note', prompt: 'Delayed private input' })).state, 'cancelled');
  assert.equal(calls, 0);
  await f.jobs.submit(p.id, { id: 'complete_before_cancel', operation: 'summarize-note', prompt: 'Complete first' });
  await until(() => f.jobs.get(p.id, 'complete_before_cancel').state === 'completed');
  assert.equal((await f.jobs.cancel(p.id, 'complete_before_cancel')).state, 'completed');
  assert.equal(calls, 1);
});

test('expiry removes private data, fences retry and prevents late worker output from publishing', async (t) => {
  let finish, calls = 0, clock = Date.now();
  const f = await fixture(t, () => { calls++; return new Promise((r) => { finish = r; }); });
  f.jobs.now = () => clock;
  const { p } = await enroll(f.service);
  const input = { id: 'expire_while_running', operation: 'summarize-note', prompt: 'Private pending text', expires: clock + 1000 };
  await f.jobs.submit(p.id, input); await until(() => !!finish);
  clock += 1001;
  assert.equal(f.jobs.get(p.id, input.id).state, 'expired');
  await f.jobs.cleanup();
  assert.equal(f.vault.value.jobs[`${p.id}:${input.id}`].prompt, undefined);
  finish({ ok: true, text: 'Must never appear after expiry' });
  await until(() => !f.jobs.pumping);
  assert.equal(f.jobs.get(p.id, input.id).text, undefined);
  assert.equal((await f.jobs.submit(p.id, input)).state, 'expired'); assert.equal(calls, 1);
  clock += 8 * 86400000; await f.jobs.cleanup();
  await assert.rejects(f.jobs.submit(p.id, input), { code: 'EXPIRED' }); assert.equal(calls, 1);
});

test('restart resumes queued work once, preserves completed work and never resumes interrupted generation', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { ok: true, text: 'Queued work completed after restart' }; });
  const { p } = await enroll(f.service);
  f.jobs.stopped = true;
  await f.jobs.submit(p.id, { id: 'queued_before_crash', operation: 'summarize-note', prompt: 'Complete on restart' });
  await f.vault.change((data) => {
    data.jobs[`${p.id}:running_before_crash`] = { id: 'running_before_crash', device: p.id, operation: 'summarize-note', model: 'pinned-text-model', state: 'running', prompt: 'Do not restart tokens', created: Date.now() };
    data.jobs[`${p.id}:completed_before_crash`] = { id: 'completed_before_crash', device: p.id, operation: 'summarize-note', model: 'pinned-text-model', state: 'completed', text: 'Already completed', created: Date.now() };
  });
  const vault = new Vault(f.directory, f.protector); await vault.initialize();
  const recovered = new Jobs(vault, f.runtime, f.service.library); await recovered.initialize();
  try {
    await until(() => recovered.get(p.id, 'queued_before_crash').state === 'completed');
    assert.equal(calls, 1);
    assert.equal(recovered.get(p.id, 'running_before_crash').state, 'interrupted');
    assert.equal(recovered.get(p.id, 'completed_before_crash').text, 'Already completed');
    assert.equal(vault.value.jobs[`${p.id}:running_before_crash`].prompt, undefined);
  } finally { await recovered.shutdown(); }
});

test('writing jobs retain operation through signed cancellation fences, restart retrieval and invalid output failure', async (t) => {
  const f = await fixture(t, async () => ({ ok: true, text: '<html>invalid replacement</html>' }));
  const { p } = await enroll(f.service);
  const input = { id: 'writing_invalid_result', operation: 'rewrite-note', prompt: JSON.stringify({ text: 'Original.', intent: '' }) };
  await auth(f.service, p, 'POST', '/v1/jobs', input);
  await until(() => f.jobs.get(p.id, input.id).state === 'failed');
  assert.equal(f.jobs.get(p.id, input.id).error, 'INVALID_OUTPUT');
  assert.equal(f.jobs.get(p.id, input.id).text, undefined);
  const restored = new Vault(f.directory, f.protector); await restored.initialize();
  assert.equal(restored.value.jobs[`${p.id}:${input.id}`].operation, 'rewrite-note');
  const cancellation = await auth(f.service, p, 'POST', '/v1/jobs/writing_cancel_fence/cancel', { operation: 'markdown-note' });
  assert.equal(cancellation.value.operation, 'markdown-note');
  const duplicate = await auth(f.service, p, 'POST', '/v1/jobs', { ...input, id: 'writing_cancel_fence', operation: 'markdown-note' });
  assert.equal(duplicate.value.state, 'cancelled');
});

test('presentation jobs use signed durable requests, cancel fences and bounded envelope validation', async (t) => {
  let calls = 0, output = JSON.stringify({ html: '<article><section data-source="b0" class="s0"></section></article>', css: '.s0 {font-size:1em;}' });
  const f = await fixture(t, async () => { calls++; return { ok: true, text: output }; });
  const { p } = await enroll(f.service);
  const input = { id: 'presentation_good', operation: 'present-text', prompt: JSON.stringify({ blocks: [{ id: 'b0', text: 'Only these words.' }], intent: '' }) };
  await auth(f.service, p, 'POST', '/v1/jobs', input);
  await until(() => f.jobs.get(p.id, input.id).state === 'completed');
  await auth(f.service, p, 'POST', '/v1/jobs', input); assert.equal(calls, 1);
  const restored = new Vault(f.directory, f.protector); await restored.initialize();
  assert.equal(restored.value.jobs[`${p.id}:${input.id}`].text, output);
  await auth(f.service, p, 'POST', `/v1/jobs/${input.id}/ack`, {});
  assert.equal(f.jobs.get(p.id, input.id).text, undefined);
  const fence = { ...input, id: 'presentation_cancelled' };
  await auth(f.service, p, 'POST', `/v1/jobs/${fence.id}/cancel`, { operation: 'present-text' });
  assert.equal((await auth(f.service, p, 'POST', '/v1/jobs', fence)).value.state, 'cancelled');
  output = '<script>not an envelope</script>';
  const bad = { ...input, id: 'presentation_bad' };
  await auth(f.service, p, 'POST', '/v1/jobs', bad);
  await until(() => f.jobs.get(p.id, bad.id).state === 'failed');
  assert.equal(f.jobs.get(p.id, bad.id).error, 'INVALID_OUTPUT');
});

test('I03: image questions use a separate signed route with a larger body limit and advertise vision status', async (t) => {
  const { service, jobs } = await fixture(t);
  const { VISION_OPERATION, selfTestImage } = require('../src/vision.cjs');
  const submitted = [];
  jobs.vision = { capability: () => ({ id: 'vision', status: 'ready', operations: [VISION_OPERATION], visionContract: 1 }), sweep: async () => {} };
  const original = jobs.submit.bind(jobs);
  jobs.submit = async (device, body, options) => { submitted.push(options?.image === true); if (options?.image) return { id: body.id, state: 'queued' }; return original(device, body, options); };
  const { p } = await enroll(service);
  const status = await auth(service, p, 'GET', '/v1/status');
  assert.equal(status.value.capabilities.find((c) => c.id === 'vision').status, 'ready');
  const image = Buffer.concat([selfTestImage(), Buffer.alloc(200000)]).toString('base64');
  const body = { id: 'image-route-1', operation: VISION_OPERATION, prompt: '{"mode":"describe","question":""}', image };
  assert.equal((await auth(service, p, 'POST', '/v1/jobs', body)).value.error.code, 'INVALID_INPUT');
  const accepted = await auth(service, p, 'POST', '/v1/image-jobs', body);
  assert.equal(accepted.status, 200); assert.equal(accepted.value.state, 'queued');
  assert.deepEqual(submitted, [true]); // the text route refused the large body before submission
  const tooLarge = await auth(service, p, 'POST', '/v1/image-jobs', { ...body, image: 'A'.repeat(4.3 * 1024 * 1024) }).catch((e) => ({ error: e }));
  assert.ok(tooLarge.error || tooLarge.value.error.code === 'INVALID_INPUT');
});
