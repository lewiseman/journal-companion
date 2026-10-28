const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { CompanionError } = require('./model.cjs');
const MAX_BYTES = 16000 * 2 * 600, RETENTION = 86400000;
const terminal = (s) => ['completed', 'failed', 'cancelled', 'expired'].includes(s);
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id);

// Whisper's metadata updates replace the segment with the same ID. No text
// concatenation on retransmission, and each microphone session has its own IDs.
function mergeSegment(segments, segment) {
  if (!Number.isSafeInteger(segment.id) || segment.id < 0 || typeof segment.text !== 'string' || Buffer.byteLength(segment.text) > 8192) throw new CompanionError('INVALID_OUTPUT', 'Invalid speech segment.');
  const prior = segments.find((s) => s.id === segment.id);
  const next = { id: segment.id, text: segment.append && prior ? prior.text + segment.text : segment.text, startMs: segment.startMs, endMs: segment.endMs };
  if (Buffer.byteLength(next.text) > 16384) throw new CompanionError('OUTPUT_LIMIT', 'Speech segment exceeded its limit.');
  if (prior) Object.assign(prior, next); else segments.push(next);
  if (segments.length > 512 || Buffer.byteLength(segments.map((s) => s.text).join(' ')) > 48000) throw new CompanionError('OUTPUT_LIMIT', 'Recording transcript exceeded its limit.');
  return next;
}
class Voice extends EventEmitter {
  constructor(vault, speech, { now = Date.now } = {}) {
    super(); Object.assign(this, { vault, speech, now }); this.connections = new Map(); this.root = path.join(vault.directory, 'voice-input');
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 6404, perMessageDeflate: false });
    this.wss.on('connection', (ws, req, device, id) => this.connect(ws, device, id));
    speech.on('change', () => { this.emit('change'); this.pump().catch(() => {}); });
  }
  key(device, id) { return `${device}:${id}`; }
  file(device, id) { if (!/^[a-f0-9]{32}$/.test(device) || !validId(id)) throw new CompanionError('INVALID_INPUT', 'Invalid voice identity.'); return path.join(this.root, `${device}-${id}.enc`); }
  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.vault.change((data) => { data.voice ||= {}; for (const job of Object.values(data.voice)) if (job.state === 'running') job.state = 'queued'; });
    await this.cleanup(); this.timer = setInterval(() => this.cleanup().catch(() => {}), 60000); this.timer.unref(); this.pump().catch(() => {});
  }
  list() { return Object.values(this.vault.value.voice || {}).map(({ segments, digest, ...j }) => ({ ...j, deviceName: this.vault.value.devices[j.device]?.name || 'Removed device' })); }
  get(device, id) {
    const job = this.vault.value.voice?.[this.key(device, id)];
    if (!job || !this.vault.value.devices[device]) throw new CompanionError('NOT_FOUND', 'No accepted recording found. Original audio is retained on the phone until discard or expiry.');
    return job.expires <= this.now() ? { id, device, state: 'expired', accepted: true } : structuredClone(job);
  }
  async cleanup() {
    await this.vault.change((data) => {
      for (const [key, job] of Object.entries(data.voice || {})) {
        if (!data.devices[job.device] || job.expires + 7 * RETENTION <= this.now()) delete data.voice[key];
        else if (job.expires <= this.now()) { job.state = 'expired'; delete job.segments; delete job.error; }
      }
    });
    const owned = new Set(Object.values(this.vault.value.voice || {}).filter((j) => !terminal(j.state)).map((j) => path.basename(this.file(j.device, j.id))));
    for (const session of this.connections.values()) if (session.ending) { const name = path.basename(this.file(session.device, session.id)); owned.add(name); owned.add(name + '.tmp'); }
    for (const name of await fs.readdir(this.root)) if (!owned.has(name)) await fs.rm(path.join(this.root, name), { force: true });
    for (const [key, session] of this.connections) if (!this.vault.value.devices[session.device] || session.created + RETENTION <= this.now()) session.ws.terminate();
    this.emit('change');
  }
  attach(server, service) {
    server.on('upgrade', (req, socket, head) => {
      try {
        service.limit(req.socket.remoteAddress);
        if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['x-journal-version'] !== '1') throw new CompanionError('FORBIDDEN', 'Native authenticated clients only.');
        if (req.url === '/v1/talk/live' && this.talk) { const device = service.authenticate(req, ''); this.talk.upgrade(req, socket, head, device); return; }
        const match = /^\/v1\/voice\/live\/([a-zA-Z0-9_-]{8,80})$/.exec(req.url);
        if (!match) throw new CompanionError('NOT_FOUND', 'Unknown stream.');
        const device = service.authenticate(req, '');
        this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req, device, match[1]));
      } catch { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); }
    });
  }
  send(ws, value) { if (ws.readyState === 1 && ws.bufferedAmount < 131072) ws.send(JSON.stringify(value)); else if (ws.readyState === 1) ws.terminate(); }
  async connect(ws, device, id) {
    const key = this.key(device, id);
    ws.on('error', () => {});
    let session;
    try {
      if (this.vault.value.voice?.[key]) { this.send(ws, { type: 'job', job: this.get(device, id) }); ws.close(); return; }
      if (this.connections.size || this.pumping) throw new CompanionError('BUSY', 'Another recording is active. Wait for it to finish.');
      if (Object.values(this.vault.value.voice || {}).filter((j) => !terminal(j.state)).length >= 4 || Object.keys(this.vault.value.voice || {}).length >= 128) throw new CompanionError('QUEUE_FULL', 'Clear previous voice work before recording.');
      // Reserve immediately, before opening the native engine.
      session = { ws, device, id, key, chunks: [], bytes: 0, next: 0, segments: [], created: this.now(), lastInput: this.now() };
      this.connections.set(key, session);
      ws.on('close', () => {
        clearInterval(session.timer);
        if (!session.accepted && !session.ending) { session.engine?.destroy(); session.chunks = []; }
        // consume() owns engine release; an old socket cannot release a newer session.
      });
      session.engine = await this.speech.open();
      if (ws.readyState !== 1) { session.engine.destroy(); this.connections.delete(key); this.speech.release(); return; }
      session.consume = this.consume(session);
      session.timer = setInterval(() => { if (this.now() - session.lastInput > 20000 && !session.accepted) ws.terminate(); else ws.ping(); }, 5000); session.timer.unref();
      let processing = Promise.resolve();
      ws.on('message', (data, binary) => {
        // ws delivers one message at a time, but durable acceptance is async.
        processing = processing.then(async () => {
          if (!this.vault.value.devices[device] || session.ending || session.accepted) throw new CompanionError('INVALID_INPUT', 'Recording already stopped or trust revoked.');
          session.lastInput = this.now();
          if (binary) {
            if (data.length <= 4 || (data.length - 4) % 2 || data.length > 6404 || data.readUInt32BE(0) !== session.next) throw new CompanionError('AUDIO_SEQUENCE', 'Audio sequence is incomplete. Retry the retained recording.');
            if (session.bytes + data.length - 4 > MAX_BYTES) throw new CompanionError('AUDIO_LIMIT', 'A recording can be at most ten minutes.');
            const pcm = Buffer.from(data.subarray(4)); session.chunks.push(pcm); session.bytes += pcm.length; session.next++;
            session.engine.write(pcm); this.send(ws, { type: 'ack', next: session.next, bytes: session.bytes });
          } else {
            const control = JSON.parse(data.toString());
            if (control.type === 'cancel') { session.engine.destroy(); ws.close(); return; }
            if (control.type !== 'finish' || control.frames !== session.next || control.bytes !== session.bytes || !session.bytes) throw new CompanionError('AUDIO_SEQUENCE', 'Only a complete recording can be accepted.');
            session.ending = true;
            const pcm = Buffer.concat(session.chunks), digest = crypto.createHash('sha256').update(pcm).digest('hex');
            if (control.sha256 !== digest) throw new CompanionError('AUDIO_SEQUENCE', 'Recording checksum did not match.');
            const file = this.file(device, id), encrypted = await this.vault.protector.encryptString(pcm.toString('base64'));
            const handle = await fs.open(file + '.tmp', 'wx', 0o600);
            try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
            await fs.rename(file + '.tmp', file);
            const dir = await fs.open(this.root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
            await this.vault.change((v) => {
              if (!v.devices[device]) throw new CompanionError('UNAUTHORIZED', 'Device revoked.');
              if (v.voice[key]?.state === 'cancelled') throw new CompanionError('CANCELLED', 'Recording cancelled before acceptance.');
              v.voice[key] = { id, device, operation: 'voice.transcribe', model: this.speech.model.id, state: 'running', accepted: true, bytes: session.bytes, digest, created: session.created, expires: session.created + RETENTION };
            });
            session.accepted = true; session.chunks = []; this.send(ws, { type: 'accepted', job: this.get(device, id) }); this.emit('change');
            session.engine.end();
            session.finishTimer = setTimeout(() => session.engine.destroy(), 120000); session.finishTimer.unref();
          }
        }).catch((e) => { this.send(ws, { type: 'error', code: e instanceof CompanionError ? e.code : 'VOICE_FAILED', message: e instanceof CompanionError ? e.message : 'Recording transfer failed. Retry the retained phone audio.' }); session.engine?.destroy(); ws.close(); });
      });
      this.send(ws, { type: 'ready', sampleRate: 16000, channels: 1, format: 's16le', maxBytes: MAX_BYTES });
    } catch (e) {
      // No iterator exists when opening the native engine fails. Release only
      // this setup reservation, so NOT_READY/BUSY cannot wedge future attempts.
      if (session && !session.consume && this.connections.get(key) === session) {
        clearInterval(session.timer); session.engine?.destroy(); this.connections.delete(key);
        if (session.engine) this.speech.release();
      }
      this.send(ws, { type: 'error', code: e.code || 'VOICE_FAILED', message: e instanceof CompanionError ? e.message : 'Speech is unavailable. Load speech on the computer.' }); ws.close(); this.emit('change');
    }
  }
  async consume(session) {
    let failure;
    try { for await (const segment of session.engine) { const value = mergeSegment(session.segments, segment); this.send(session.ws, { type: 'segment', segment: value }); } }
    catch { failure = 'TRANSCRIPTION_FAILED'; }
    try {
      if (session.accepted && !this.stopped) {
        await this.vault.change((v) => {
          const job = v.voice[session.key]; if (job?.state !== 'running' || job.expires <= this.now()) return;
          job.state = failure ? 'failed' : 'completed'; job.finished = this.now();
          if (failure) job.error = failure; else job.segments = session.segments;
        });
        await fs.rm(this.file(session.device, session.id), { force: true });
        if (this.vault.value.devices[session.device]) this.send(session.ws, { type: 'job', job: this.get(session.device, session.id) });
      } else if (session.ws.readyState === 1 && !session.ending) {
        this.send(session.ws, { type: 'error', code: 'TRANSCRIPTION_FAILED', message: 'Speech stopped before the full recording was accepted. Stop and retry the retained audio.' });
      }
    } catch { this.send(session.ws, { type: 'error', code: 'STORAGE_FAILED', message: 'Could not retain the transcript. Retry retrieval; keep the phone recording.' }); }
    finally { clearTimeout(session.finishTimer); clearInterval(session.timer); session.ws.close(); this.connections.delete(session.key); this.speech.release(); this.emit('change'); }
  }
  async cancel(device, id) {
    const key = this.key(device, id); const live = this.connections.get(key);
    live?.engine?.destroy(); live?.ws.terminate();
    await this.vault.change((v) => {
      v.voice ||= {};
      if (!v.voice[key]) v.voice[key] = { id, device, created: this.now(), expires: this.now() + RETENTION, operation: 'voice.transcribe', accepted: false };
      if (!terminal(v.voice[key].state)) { v.voice[key].state = 'cancelled'; delete v.voice[key].segments; }
    });
    await fs.rm(this.file(device, id), { force: true }); this.emit('change'); return this.get(device, id);
  }
  async ack(device, id) {
    const job = this.get(device, id); if (!terminal(job.state)) throw new CompanionError('BUSY', 'Stop transcription before discarding.');
    await this.vault.change((v) => { delete v.voice[this.key(device, id)].segments; v.voice[this.key(device, id)].acknowledged = true; }); return { ok: true };
  }
  async forget(device) {
    this.talk?.forget(device);
    for (const live of this.connections.values()) if (live.device === device) { live.engine?.destroy(); live.ws.terminate(); }
    await this.vault.change((v) => { for (const [key, job] of Object.entries(v.voice || {})) if (job.device === device) delete v.voice[key]; }); await this.cleanup();
  }
  async pump() {
    if (this.stopped || this.pumping || this.connections.size || this.talk?.active || this.speech.capability().status !== 'ready') return;
    this.pumping = true;
    try {
      for (const job of Object.values(this.vault.value.voice || {}).filter((j) => j.state === 'queued' && j.expires > this.now())) {
        let engine, segments = [], error;
        try {
          engine = await this.speech.open(); this.recoveryEngine = engine;
          const pcm = Buffer.from(await this.vault.protector.decryptString(await fs.readFile(this.file(job.device, job.id))), 'base64');
          if (pcm.length !== job.bytes || crypto.createHash('sha256').update(pcm).digest('hex') !== job.digest) throw new Error('Invalid accepted input');
          const consume = (async () => { for await (const s of engine) mergeSegment(segments, s); })();
          for (let at = 0; at < pcm.length; at += 6400) { engine.write(pcm.subarray(at, at + 6400)); await new Promise((r) => setImmediate(r)); }
          engine.end(); await consume;
        } catch { error = 'TRANSCRIPTION_FAILED'; engine?.destroy(); }
        finally { this.recoveryEngine = null; this.speech.release(); }
        if (this.stopped) break;
        await this.vault.change((v) => { const j = v.voice[this.key(job.device, job.id)]; if (j?.state !== 'queued') return; j.state = error ? 'failed' : 'completed'; if (error) j.error = error; else j.segments = segments; });
        await fs.rm(this.file(job.device, job.id), { force: true });
      }
    } finally { this.pumping = false; this.emit('change'); }
  }
  async shutdown() { this.stopped = true; this.talk?.shutdown(); this.recoveryEngine?.destroy(); clearInterval(this.timer); for (const s of this.connections.values()) { s.engine?.destroy(); s.ws.terminate(); } await this.vault.tail; }
}
module.exports = { Voice, mergeSegment, MAX_BYTES };
