const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { CompanionError } = require('./model.cjs');

const VERSION = 1;
// Base64 of one image of at most 3 MB plus its small JSON envelope.
const IMAGE_JOB_BYTES = 4.2 * 1024 * 1024;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const canonical = (device, method, route, nonce, body) => `v1\n${device}\n${method}\n${route}\n${nonce}\n${digest(body)}`;
const deviceId = (key) => digest(Buffer.from(key, 'base64')).slice(0, 32);
const publicKey = (raw) => {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error('Invalid public key');
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'base64').toString('base64url') }, format: 'jwk' });
};
const fingerprint = (cert) => digest(new crypto.X509Certificate(cert).raw);
function localAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}
class DeviceService extends EventEmitter {
  constructor(vault, library, jobs, { port = 47921, host = '0.0.0.0', advertise = true, now = Date.now, voice = null } = {}) {
    super(); Object.assign(this, { vault, library, jobs, port, host, advertise, now });
    this.voice = voice; this.nonces = new Map(); this.pending = new Map(); this.seen = new Map(); this.buckets = new Map(); this.error = null;
  }
  async initialize() {
    if (!this.vault.value.identity) {
      const pems = await require('selfsigned').generate([{ name: 'commonName', value: 'Journal Companion' }], {
        keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notAfterDate: new Date(this.now() + 10 * 365 * 86400000),
        extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true }, { name: 'extKeyUsage', serverAuth: true }],
      });
      await this.vault.change((data) => { data.identity = { id: crypto.randomUUID(), key: pems.private, cert: pems.cert }; });
    }
    this.identity = this.vault.value.identity; this.pin = fingerprint(this.identity.cert);
    if (this.vault.value.enabled) await this.start();
  }
  snapshot() {
    this.expire();
    return { enabled: !!this.server, error: this.error, id: this.identity?.id, fingerprint: this.pin,
      port: this.port, addresses: localAddresses(),
      devices: Object.values(this.vault.value.devices).map(({ publicKey, ...d }) => ({ ...d, connected: (this.seen.get(d.id) || 0) + 35000 > this.now() })),
      pending: [...this.pending.entries()].filter(([, p]) => p.state === 'pending').map(([ticket, p]) => ({ ticket, name: p.name, verification: digest(Buffer.from(p.publicKey, 'base64')).slice(0, 12), expires: p.expires })),
    };
  }
  expire() {
    for (const [nonce, expiry] of this.nonces) if (expiry < this.now()) this.nonces.delete(nonce);
    for (const [ticket, p] of this.pending) if (p.expires < this.now()) this.pending.delete(ticket);
    for (const [key, b] of this.buckets) if (b.reset < this.now()) this.buckets.delete(key);
    if (this.pairing?.expires < this.now()) this.pairing = null;
  }
  limit(address) {
    this.expire();
    const key = address || 'unknown'; const b = this.buckets.get(key) || { count: 0, reset: this.now() + 60000 };
    if (++b.count > 120 || this.buckets.size > 256) throw new CompanionError('RATE_LIMITED', 'Wait a minute before retrying.');
    this.buckets.set(key, b);
  }
  async start() {
    if (this.server) return;
    const server = https.createServer({ key: this.identity.key, cert: this.identity.cert, minVersion: 'TLSv1.2', maxHeaderSize: 4096 }, (req, res) => this.handle(req, res));
    this.voice?.attach(server, this);
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, this.host, resolve); });
    this.server = server; this.port = server.address().port;
    server.on('error', () => { this.error = 'LAN service failed. Quit and reopen the companion.'; this.emit('change'); });
    if (this.advertise) {
      const { Bonjour } = require('bonjour-service');
      this.bonjour = new Bonjour(undefined, () => { this.error = 'Discovery unavailable. Use the QR or full pairing code.'; this.emit('change'); });
      this.broadcast = this.bonjour.publish({ name: `Journal ${os.hostname().slice(0, 32)}`, type: 'journal-ai', port: this.port,
        txt: { id: this.identity.id, v: String(VERSION), fp: this.pin }, probe: false });
      this.broadcast.on('error', () => { this.error = 'Discovery unavailable. Use the QR or full pairing code.'; this.emit('change'); });
    }
    this.emit('change');
  }
  async openPairing() {
    await this.start();
    await this.vault.change((data) => { data.enabled = true; });
    // Replacing the QR invalidates unapproved tickets as well as the old secret.
    this.pending.clear();
    this.pairing = { secret: random(), expires: this.now() + 120000, attempts: 0 };
    const payload = { v: VERSION, id: this.identity.id, name: os.hostname().slice(0, 48), pin: this.pin,
      endpoints: localAddresses().map((host) => `https://${host}:${this.port}`), secret: this.pairing.secret, expires: this.pairing.expires };
    if (!payload.endpoints.length) throw new CompanionError('NO_NETWORK', 'Connect this Mac and phone to the same routable local network, then create a fresh code.');
    const code = JSON.stringify(payload);
    const qr = await require('qrcode').toDataURL(code, { width: 320, errorCorrectionLevel: 'M' });
    this.emit('change'); return { ok: true, code, qr, expires: payload.expires };
  }
  async approve(ticket, allowed) {
    this.expire(); const p = this.pending.get(ticket);
    if (!p || p.state !== 'pending') throw new CompanionError('PAIRING_EXPIRED', 'Create a new QR and try pairing again.');
    if (allowed) {
      await this.vault.change((data) => {
        if (Object.keys(data.devices).length >= 20) throw new CompanionError('DEVICE_LIMIT', 'Remove a trusted device before adding another.');
        data.devices[p.id] = { id: p.id, name: p.name, publicKey: p.publicKey, paired: this.now() };
      });
    }
    p.state = allowed ? 'approved' : 'denied'; this.emit('change'); return { ok: true };
  }
  async revoke(id) {
    await this.voice?.forget(id); await this.jobs.forget(id); this.seen.delete(id);
    for (const [ticket, p] of this.pending) if (p.id === id) this.pending.delete(ticket);
    this.emit('change'); return { ok: true };
  }
  authenticate(req, raw) {
    const id = req.headers['x-journal-device'], nonce = req.headers['x-journal-nonce'];
    const expiry = this.nonces.get(nonce); this.nonces.delete(nonce);
    const device = this.vault.value.devices[id];
    try {
      if (!expiry || expiry < this.now() || !device || !crypto.verify(null, Buffer.from(canonical(id, req.method, req.url, nonce, raw)), publicKey(device.publicKey), Buffer.from(req.headers['x-journal-signature'] || '', 'base64'))) throw new Error();
    } catch { throw new CompanionError('UNAUTHORIZED', 'Device trust is missing, revoked, or verification failed. Pair again on the desktop.'); }
    this.seen.set(id, this.now()); this.emit('change'); return id;
  }
  async route(req, raw) {
    this.limit(req.socket.remoteAddress);
    if (req.headers.origin || req.headers['sec-fetch-site']) throw new CompanionError('FORBIDDEN', 'Browser access is disabled.');
    if (req.headers['x-journal-version'] !== String(VERSION)) throw new CompanionError('INCOMPATIBLE_VERSION', 'Update Journal and the companion to matching protocol versions.');
    const route = req.url;
    if (req.method === 'GET' && route === '/v1/info') return { v: VERSION, id: this.identity.id };
    if (req.method === 'GET' && route === '/v1/challenge') {
      if (this.nonces.size >= 256) throw new CompanionError('RATE_LIMITED', 'Retry shortly.');
      const nonce = random(); this.nonces.set(nonce, this.now() + 30000); return { nonce };
    }
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { throw new CompanionError('INVALID_INPUT', 'Invalid JSON.'); } }
    if (req.method === 'POST' && route === '/v1/pair') {
      const p = this.pairing;
      if (!p || p.expires < this.now()) throw new CompanionError('PAIRING_EXPIRED', 'Create a fresh QR on the desktop.');
      if (++p.attempts > 5) { this.pairing = null; throw new CompanionError('PAIRING_EXPIRED', 'Too many attempts. Create a fresh QR.'); }
      let valid = false;
      try {
        const a = Buffer.from(body.secret || ''), b = Buffer.from(p.secret);
        const enrollment = `pair-v1\n${this.identity.id}\n${p.secret}\n${body.publicKey}\n${body.name}`;
        valid = a.length === b.length && crypto.timingSafeEqual(a, b) && typeof body.name === 'string' && /^[^\x00-\x1f\x7f]{1,48}$/.test(body.name)
          && crypto.verify(null, Buffer.from(enrollment), publicKey(body.publicKey), Buffer.from(body.proof || '', 'base64'));
      } catch {}
      if (!valid) throw new CompanionError('VERIFICATION_FAILED', 'Scan the intended desktop’s current QR again.');
      this.pairing = null;
      const ticket = random(), id = deviceId(body.publicKey);
      this.pending.set(ticket, { id, publicKey: body.publicKey, name: body.name, state: 'pending', expires: this.now() + 120000 });
      this.emit('change'); return { ticket, id };
    }
    if (req.method === 'POST' && route === '/v1/pair-status') {
      const p = this.pending.get(body.ticket);
      if (!p) throw new CompanionError('PAIRING_EXPIRED', 'Pairing expired or was replaced. Create a fresh QR.');
      return { state: p.state, id: p.id };
    }
    const id = this.authenticate(req, raw);
    if (req.method === 'GET' && route === '/v1/status') return { v: VERSION, recovery: 1, id: this.identity.id, name: os.hostname().slice(0, 48), transport: 'connected', capabilities: [this.library.capability(), ...(this.jobs.vision ? [this.jobs.vision.capability()] : []), ...(this.voice ? [this.voice.speech.capability(), { id: 'speech', implemented: false, status: 'unavailable', reason: 'Read replies on screen. Speech synthesis is not enabled.' }] : [])] };
    if (req.method === 'POST' && route === '/v1/disconnect') { this.seen.delete(id); this.emit('change'); return { ok: true }; }
    if (req.method === 'POST' && route === '/v1/forget') return this.revoke(id);
    const voiceMatch = /^\/v1\/voice\/([a-zA-Z0-9_-]{8,80})(\/cancel|\/ack)?$/.exec(route);
    if (voiceMatch && this.voice) {
      if (req.method === 'GET' && !voiceMatch[2]) return this.voice.get(id, voiceMatch[1]);
      if (req.method === 'POST' && voiceMatch[2] === '/cancel') return this.voice.cancel(id, voiceMatch[1]);
      if (req.method === 'POST' && voiceMatch[2] === '/ack') return this.voice.ack(id, voiceMatch[1]);
    }
    if (req.method === 'POST' && route === '/v1/jobs') return this.jobs.submit(id, body);
    if (req.method === 'POST' && route === '/v1/image-jobs') return this.jobs.submit(id, body, { image: true });
    const match = /^\/v1\/jobs\/([a-zA-Z0-9_-]{8,80})(\/cancel|\/ack)?$/.exec(route);
    if (match) {
      if (req.method === 'GET' && !match[2]) return this.jobs.get(id, match[1]);
      if (req.method === 'POST' && match[2] === '/cancel') return this.jobs.cancel(id, match[1], body.operation);
      if (req.method === 'POST' && match[2] === '/ack') { await this.jobs.acknowledge(id, match[1]); return { ok: true }; }
    }
    throw new CompanionError('NOT_FOUND', 'Operation not found.');
  }
  async handle(req, res) {
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > (req.url === '/v1/image-jobs' ? IMAGE_JOB_BYTES : req.url === '/v1/jobs' ? 32768 : 8192)) throw new CompanionError('INVALID_INPUT', 'Request too large.'); chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString('utf8');
      const result = await this.route(req, raw);
      this.reply(res, 200, result);
    } catch (e) {
      const known = e instanceof CompanionError;
      const code = known ? e.code : 'SERVICE_FAILED';
      this.reply(res, code === 'UNAUTHORIZED' ? 401 : code === 'INCOMPATIBLE_VERSION' ? 426 : code === 'RATE_LIMITED' ? 429 : known ? 400 : 503,
        { error: { code, message: known ? e.message : 'The companion could not save or complete this operation. Check disk space and try again.' } });
    }
  }
  reply(res, status, value) {
    if (res.destroyed) return;
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' }); res.end(body);
  }
  async stop() {
    this.pairing = null; this.pending.clear(); this.nonces.clear(); this.seen.clear();
    this.broadcast?.stop(); this.bonjour?.destroy(); this.bonjour = null;
    if (this.server) { const server = this.server; this.server = null; for (const session of this.voice?.connections.values() || []) session.ws.terminate(); this.voice?.talk?.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
    this.emit('change');
  }
  async disable() { await this.vault.change((data) => { data.enabled = false; }); await this.stop(); return { ok: true }; }
}
module.exports = { DeviceService, canonical, deviceId, fingerprint, VERSION };
