const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter, once } = require('node:events');
const { WebSocket } = require('ws');
const { Voice } = require('../src/voice.cjs');
const { Talk } = require('../src/talk.cjs');
const { DeviceService, canonical, deviceId } = require('../src/device-service.cjs');
const { Vault } = require('../src/vault.cjs');

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
  constructor() { super(); this.status = 'ready'; this.model = { id: 'synthetic-whisper' }; this.opened = 0; }
  capability() { return { id: 'transcription', status: this.busy ? 'busy' : this.status }; }
  async open() { assert.ok(!this.busy); this.busy = true; this.opened++; this.engine = new Engine(); return this.engine; }
  release() { this.busy = false; }
}
class FakeRuntime {
  constructor() { this.prompts = []; this.replies = ['How did the interview go?', 'What happened next?', 'And after that?']; }
  async generate(prompt, { onToken }) {
    this.prompts.push(JSON.parse(prompt));
    const text = this.replies.shift();
    for (const word of text.split(/(?<= )/)) onToken(word);
    return { ok: true, text };
  }
  async cancelGeneration() {}
}
const until = async (fn) => { for (let n = 0; n < 400; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail('Timed out'); };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-talk-test-')), key = crypto.randomBytes(32);
  const protector = { isEncryptionAvailable: () => true, encryptString(value) { const nonce = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, nonce); return Buffer.concat([nonce, c.update(value), c.final(), c.getAuthTag()]); }, decryptString(value) { const d = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0,12)); d.setAuthTag(value.subarray(-16)); return Buffer.concat([d.update(value.subarray(12,-16)), d.final()]).toString(); } };
  const vault = new Vault(directory, protector); await vault.initialize();
  const phone = crypto.generateKeyPairSync('ed25519'), pub = Buffer.from(phone.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64'), device = deviceId(pub);
  await vault.change((v) => { v.devices[device] = { id: device, publicKey: pub, name: 'Synthetic phone' }; });
  const speech = new FakeSpeech(), runtime = new FakeRuntime(), voice = new Voice(vault, speech); await voice.initialize();
  const talk = new Talk(vault, speech, runtime, { pauseMs: 200, giveUpMs: 600 }); voice.talk = talk;
  const service = new DeviceService(vault, { capability: () => ({ id: 'text', status: 'ready' }) }, { forget: async () => {} }, { voice, port: 0, host: '127.0.0.1', advertise: false });
  await service.initialize(); await service.start();
  t.after(async () => { await service.stop(); await voice.shutdown(); await fs.rm(directory, { recursive: true, force: true }); });
  return { vault, voice, talk, speech, runtime, service, phone, device };
}
function challenge(f) { const nonce = crypto.randomBytes(32).toString('base64url'); f.service.nonces.set(nonce, Date.now() + 30000); return nonce; }
async function open(f, headers = {}) {
  const nonce = challenge(f), route = '/v1/talk/live';
  const signature = crypto.sign(null, Buffer.from(canonical(f.device, 'GET', route, nonce, '')), f.phone.privateKey).toString('base64');
  const ws = new WebSocket(`wss://127.0.0.1:${f.service.port}${route}`, { ca: f.service.identity.cert, checkServerIdentity: () => undefined, headers: { 'x-journal-version': '1', 'x-journal-device': f.device, 'x-journal-nonce': nonce, 'x-journal-signature': signature, ...headers } });
  const messages = []; ws.on('message', (raw) => messages.push(JSON.parse(raw))); ws.on('error', () => {});
  await once(ws, 'open'); await until(() => messages.length > 0); return { ws, messages, send: (v) => ws.send(JSON.stringify(v)) };
}
// 100 ms of 16 kHz mono audio, either talking or room quiet.
const loud = () => { const b = Buffer.alloc(3200); for (let i = 0; i < 1600; i++) b.writeInt16LE(i % 2 ? 9000 : -9000, i * 2); return b; };
const quiet = () => Buffer.alloc(3200);
function frame(ws, seq, pcm) { const data = Buffer.alloc(pcm.length + 4); data.writeUInt32BE(seq); pcm.copy(data, 4); ws.send(data); }
const types = (c) => c.messages.map((m) => m.type);

test('talk rejects browsers and bad signatures', async (t) => {
  const f = await fixture(t);
  await assert.rejects(open(f, { origin: 'https://example.com' }));
  await assert.rejects(open(f, { 'x-journal-signature': 'invalid' }));
});

test('companion opens from diary context, ends the turn after a pause and replies in the same session', async (t) => {
  const f = await fixture(t), c = await open(f);
  assert.equal(c.messages[0].type, 'ready');
  c.send({ type: 'start', turns: [], diary: [{ daysAgo: 1, text: 'Interview at the bank tomorrow.' }] });
  await until(() => types(c).includes('reply'));
  assert.equal(f.runtime.prompts[0].action, 'open');
  assert.equal(f.runtime.prompts[0].diary[0].text, 'Interview at the bank tomorrow.');
  assert.equal(c.messages.filter((m) => m.type === 'token').map((m) => m.text).join(''), 'How did the interview go?');

  c.send({ type: 'listen' }); await until(() => types(c).includes('listening'));
  let seq = 0;
  for (let i = 0; i < 5; i++) frame(c.ws, seq++, loud());
  await until(() => f.speech.engine.received.length === 5);
  f.speech.engine.push({ id: 0, text: 'It went well.' });
  await until(() => types(c).includes('segment'));
  // Talking resumes after Whisper's pause: the turn must not end yet.
  for (let i = 0; i < 3; i++) frame(c.ws, seq++, loud());
  for (let i = 0; i < 1; i++) frame(c.ws, seq++, quiet());
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!types(c).includes('endpoint'));
  f.speech.engine.push({ id: 1, text: 'They offered me the job.' });
  await until(() => c.messages.filter((m) => m.type === 'segment').length === 2);
  for (let i = 0; i < 3; i++) frame(c.ws, seq++, quiet());
  await until(() => types(c).filter((x) => x === 'reply').length === 2);
  assert.equal(c.messages.find((m) => m.type === 'turn').text, 'It went well. They offered me the job.');
  const question = f.runtime.prompts[1];
  assert.equal(question.action, 'question');
  assert.deepEqual(question.turns.map((x) => x.speaker), ['assistant', 'user']);
  assert.ok(!f.speech.busy);
  c.ws.close();
  await until(() => !f.talk.active);
});

test('done ends the turn at once, an empty turn returns to idle, and a waiting question is not regenerated', async (t) => {
  const f = await fixture(t), c = await open(f);
  c.send({ type: 'start', turns: [{ speaker: 'assistant', text: 'How was your day?' }] });
  c.send({ type: 'listen' }); await until(() => types(c).includes('listening'));
  assert.equal(f.runtime.prompts.length, 0);
  c.send({ type: 'done' }); await until(() => types(c).includes('empty'));
  c.send({ type: 'listen' }); await until(() => types(c).filter((x) => x === 'listening').length === 2);
  frame(c.ws, 0, loud()); f.speech.engine.push({ id: 0, text: 'Busy.' });
  await until(() => types(c).includes('segment'));
  c.send({ type: 'done' }); await until(() => types(c).includes('reply'));
  assert.equal(c.messages.find((m) => m.type === 'turn').text, 'Busy.');
  c.ws.close();
});

test('only one talk session runs at a time', async (t) => {
  const f = await fixture(t), first = await open(f), second = await open(f);
  assert.equal(second.messages[0].code, 'BUSY');
  first.ws.close();
});
