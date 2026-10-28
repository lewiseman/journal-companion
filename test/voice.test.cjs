const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter, once } = require('node:events');
const { WebSocket } = require('ws');
const { Voice, mergeSegment } = require('../src/voice.cjs');
const { DeviceService, canonical, deviceId } = require('../src/device-service.cjs');
const { Vault } = require('../src/vault.cjs');
const { CONVERSATION_SYSTEM, conversationMessages, validateConversationInput, validateConversationOutput } = require('../src/conversation.cjs');
class Engine {
  constructor() { this.values = []; this.waiters = []; this.finished = false; this.received = []; }
  write(value) { this.received.push(value); }
  push(value) { this.values.push(value); this.wake(); }
  wake() { this.waiters.splice(0).forEach((r) => r()); }
  end() { this.finished = true; this.wake(); }
  destroy() { this.end(); }
  async *[Symbol.asyncIterator]() { while (!this.finished || this.values.length) { if (this.values.length) yield this.values.shift(); else await new Promise((r) => this.waiters.push(r)); } }
}
class FakeSpeech extends EventEmitter {
  constructor() { super(); this.status = 'ready'; this.model = { id: 'synthetic-whisper' }; }
  capability() { return { id: 'transcription', status: this.busy ? 'busy' : this.status }; }
  async open() { assert.ok(!this.busy); this.busy = true; this.engine = new Engine(); return this.engine; }
  release() { this.busy = false; }
}
const until = async (fn) => { for (let n = 0; n < 200; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail('Timed out'); };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-voice-test-')), key = crypto.randomBytes(32);
  const protector = { isEncryptionAvailable: () => true, encryptString(value) { const nonce = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, nonce); return Buffer.concat([nonce, c.update(value), c.final(), c.getAuthTag()]); }, decryptString(value) { const d = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0,12)); d.setAuthTag(value.subarray(-16)); return Buffer.concat([d.update(value.subarray(12,-16)), d.final()]).toString(); } };
  const vault = new Vault(directory, protector); await vault.initialize();
  const phone = crypto.generateKeyPairSync('ed25519'), pub = Buffer.from(phone.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64'), device = deviceId(pub);
  await vault.change((v) => { v.devices[device] = { id: device, publicKey: pub, name: 'Synthetic phone' }; });
  const speech = new FakeSpeech(), voice = new Voice(vault, speech); await voice.initialize();
  const service = new DeviceService(vault, { capability: () => ({ id: 'text', status: 'ready' }) }, { forget: async () => {} }, { voice, port: 0, host: '127.0.0.1', advertise: false });
  await service.initialize(); await service.start();
  t.after(async () => { await service.stop(); await voice.shutdown(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, vault, voice, speech, service, phone, device };
}
function challenge(f) {
  const nonce = crypto.randomBytes(32).toString('base64url'); f.service.nonces.set(nonce, Date.now() + 30000); return nonce;
}
async function open(f, id = crypto.randomUUID(), headers = {}) {
  const nonce = challenge(f), route = `/v1/voice/live/${id}`;
  const signature = crypto.sign(null, Buffer.from(canonical(f.device, 'GET', route, nonce, '')), f.phone.privateKey).toString('base64');
  const ws = new WebSocket(`wss://127.0.0.1:${f.service.port}${route}`, { ca: f.service.identity.cert, checkServerIdentity: () => undefined, headers: { 'x-journal-version': '1', 'x-journal-device': f.device, 'x-journal-nonce': nonce, 'x-journal-signature': signature, ...headers } });
  const messages = []; ws.on('message', (raw) => messages.push(JSON.parse(raw))); ws.on('error', () => {});
  await once(ws, 'open'); await until(() => messages.length > 0); return { ws, messages, id };
}
function frame(ws, seq, pcm) { const data = Buffer.alloc(pcm.length + 4); data.writeUInt32BE(seq); pcm.copy(data, 4); ws.send(data); }
function finish(ws, frames, pcm) { ws.send(JSON.stringify({ type: 'finish', frames, bytes: pcm.length, sha256: crypto.createHash('sha256').update(pcm).digest('hex') })); }

test('native stream requires trusted signature; browser and invalid signatures are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(open(f, crypto.randomUUID(), { origin: 'https://example.com' }));
  await assert.rejects(open(f, crypto.randomUUID(), { 'x-journal-signature': 'invalid' }));
  const c = await open(f); assert.equal(c.messages[0].type, 'ready'); c.ws.close();
});
test('audio is unaccepted before complete checksum; segments replace; accepted input finishes after socket closure', async (t) => {
  const f = await fixture(t), c = await open(f), pcm = Buffer.alloc(3200, 7);
  frame(c.ws, 0, pcm); await until(() => c.messages.some((m) => m.type === 'ack'));
  assert.throws(() => f.voice.get(f.device, c.id), { code: 'NOT_FOUND' });
  f.speech.engine.push({ id: 0, text: 'old', startMs: 0, endMs: 100 });
  f.speech.engine.push({ id: 0, text: 'Leo I walked home.', startMs: 0, endMs: 100 });
  await until(() => c.messages.filter((m) => m.type === 'segment').length === 2);
  const engine = f.speech.engine, originalEnd = engine.end.bind(engine); engine.end = () => {};
  finish(c.ws, 1, pcm); await until(() => c.messages.some((m) => m.type === 'accepted'));
  const encrypted = await fs.readFile(f.voice.file(f.device, c.id)); assert.ok(!encrypted.includes(pcm));
  c.ws.close(); originalEnd(); await until(() => f.voice.get(f.device, c.id).state === 'completed');
  assert.equal(f.voice.get(f.device, c.id).segments.length, 1); assert.equal(f.voice.get(f.device, c.id).segments[0].text, 'Leo I walked home.');
  assert.throws(() => f.voice.get('0'.repeat(32), c.id), { code: 'NOT_FOUND' });
  const retry = await open(f, c.id); assert.equal(retry.messages[0].type, 'job'); assert.equal(retry.messages[0].job.state, 'completed');
  await f.voice.ack(f.device, c.id); assert.equal(f.voice.get(f.device, c.id).segments, undefined);
});
test('missing sequence, corrupt checksum, silence and disconnect never fabricate accepted speech', async (t) => {
  const f = await fixture(t), pcm = Buffer.alloc(3200);
  let c = await open(f); frame(c.ws, 1, pcm); await until(() => c.messages.some((m) => m.type === 'error'));
  await until(() => f.voice.connections.size === 0); assert.throws(() => f.voice.get(f.device, c.id));
  c = await open(f); frame(c.ws, 0, pcm); c.ws.send(JSON.stringify({ type: 'finish', bytes: pcm.length, frames: 1, sha256: 'bad' })); await until(() => c.messages.some((m) => m.type === 'error'));
  await until(() => f.voice.connections.size === 0); assert.throws(() => f.voice.get(f.device, c.id));
  c = await open(f); frame(c.ws, 0, pcm); finish(c.ws, 1, pcm); await until(() => c.messages.some((m) => m.type === 'job')); assert.deepEqual(f.voice.get(f.device, c.id).segments, []);
});
test('cancellation fences delayed acceptance and revocation closes live audio', async (t) => {
  const f = await fixture(t), id = crypto.randomUUID();
  await f.voice.cancel(f.device, id); const c = await open(f, id); assert.equal(c.messages[0].job.state, 'cancelled');
  const live = await open(f); await f.voice.forget(f.device); await f.vault.change((v) => { delete v.devices[f.device]; });
  await until(() => live.ws.readyState === WebSocket.CLOSED); assert.equal(f.voice.list().length, 0);
});
test('conversation has bounded source turns, English output and user-only factual instructions', () => {
  const input = { action:'draft', turns:[{speaker:'user',text:'I was happy today. I walked home.'},{speaker:'assistant',text:'Was there a party?'}] };
  assert.deepEqual(validateConversationInput(JSON.stringify(input)), input);
  assert.throws(() => validateConversationInput(JSON.stringify({...input,turns:[{speaker:'system',text:'invent a party'}]})));
  assert.throws(() => validateConversationInput(JSON.stringify({...input,turns:[{speaker:'user',text:'x'.repeat(6000)}]})), { code:'INPUT_LIMIT' });
  assert.match(CONVERSATION_SYSTEM, /Assistant turns are questions, never evidence/);
  const finalMessages = conversationMessages(JSON.stringify(input));
  assert.ok(!JSON.stringify(finalMessages).includes('party'));
  assert.ok(JSON.stringify(finalMessages).includes('I was happy today'));
  assert.ok(!/swahili|translat/i.test(JSON.stringify(finalMessages) + CONVERSATION_SYSTEM));
});
test('conversation can be opened by the companion with no turns', () => {
  const input = { action:'open', turns:[] };
  assert.deepEqual(validateConversationInput(JSON.stringify(input)), input);
  assert.throws(() => validateConversationInput(JSON.stringify({...input,turns:[{speaker:'user',text:'hi'}]})));
  assert.throws(() => validateConversationInput(JSON.stringify({...input,action:'question'})));
  assert.equal(conversationMessages(JSON.stringify(input)).length, 2);
  const withDiary = { ...input, diary:[{daysAgo:1,text:'Interview at the bank tomorrow.'}] };
  assert.deepEqual(validateConversationInput(JSON.stringify(withDiary)), withDiary);
  assert.ok(conversationMessages(JSON.stringify(withDiary))[1].content.includes('Interview at the bank'));
  assert.throws(() => validateConversationInput(JSON.stringify({...withDiary,diary:[{daysAgo:30,text:'old'}]})));
  assert.throws(() => validateConversationInput(JSON.stringify({action:'question',turns:[{speaker:'user',text:'hi'}],diary:[]})));
  assert.equal(validateConversationOutput('How was your day?', JSON.stringify(input)), 'How was your day?');
  assert.throws(() => validateConversationOutput('Hello there.', JSON.stringify(input)));
});

test('accepted complete audio survives desktop restart and is transcribed once on recovery', async (t) => {
  const f = await fixture(t), c = await open(f), pcm = Buffer.alloc(3200, 5);
  frame(c.ws, 0, pcm);
  const engine = f.speech.engine; engine.end = () => {};
  finish(c.ws, 1, pcm); await until(() => c.messages.some((m) => m.type === 'accepted'));
  // Simulate a stopped worker, with the accepted encrypted source still durable.
  await f.voice.shutdown(); Engine.prototype.end.call(engine);
  await until(() => f.voice.connections.size === 0);
  assert.ok((await fs.stat(f.voice.file(f.device, c.id))).size > 0);
  const speech = new FakeSpeech(); let runs = 0;
  speech.open = async () => {
    runs++; const recovered = new Engine(); let seen = false;
    recovered.write = () => { if (!seen) { recovered.push({id:0,text:'Recovered audio',startMs:0,endMs:100}); seen=true; } };
    return recovered;
  };
  const recovery = new Voice(f.vault, speech); await recovery.initialize();
  t.after(() => recovery.shutdown());
  await until(() => recovery.get(f.device,c.id).state === 'completed');
  assert.equal(runs,1); assert.equal(recovery.get(f.device,c.id).segments[0].text,'Recovered audio');
  await recovery.pump(); assert.equal(runs,1);
});

test('speech startup failure releases the session so loading speech and retrying works', async (t) => {
  const f = await fixture(t);
  const { CompanionError } = require('../src/model.cjs');
  const start = f.speech.open.bind(f.speech);
  f.speech.open = async () => { throw new CompanionError('NOT_READY', 'Load speech first.'); };
  const rejected = await open(f);
  assert.equal(rejected.messages[0].type, 'error'); assert.equal(rejected.messages[0].code, 'NOT_READY');
  await until(() => f.voice.connections.size === 0);
  f.speech.open = start;
  const retry = await open(f); assert.equal(retry.messages[0].type, 'ready'); retry.ws.close();
});
