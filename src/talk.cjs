const { EventEmitter } = require('node:events');
const { WebSocketServer } = require('ws');
const { CompanionError } = require('./model.cjs');
const { CONVERSATION_OPERATION, validateConversationInput, validateTurns } = require('./conversation.cjs');
const { mergeSegment, MAX_BYTES } = require('./voice.cjs');

// One live, hands-free diary conversation per phone. The phone streams the
// microphone only during the person's turn; this side decides when the turn
// has ended, transcribes it and goes straight on to the companion's reply,
// streaming its tokens. Nothing here is durable: turns live on the phone,
// which sends them again when a session starts.
const PAUSE_MS = 1200, GIVE_UP_MS = 3000, IDLE_MS = 15 * 60000, TURN_LIMIT = 24, QUIET_ROOM = 0.005;
const MS_PER_BYTE = 1000 / (16000 * 2);

function loudness(pcm) {
  let energy = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) { const v = pcm.readInt16LE(i) / 32768; energy += v * v; }
  return Math.sqrt(energy / Math.max(1, pcm.length / 2));
}

class Talk extends EventEmitter {
  constructor(vault, speech, runtime, { now = Date.now, pauseMs = PAUSE_MS, giveUpMs = GIVE_UP_MS } = {}) {
    super(); Object.assign(this, { vault, speech, runtime, now, pauseMs, giveUpMs }); this.session = null;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  }
  get active() { return !!this.session; }
  upgrade(req, socket, head, device) { this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, device)); }
  send(ws, value) { if (ws.readyState === 1 && ws.bufferedAmount < 131072) ws.send(JSON.stringify(value)); else if (ws.readyState === 1) ws.terminate(); }
  connect(ws, device) {
    ws.on('error', () => {});
    if (this.session || this.speech.busy) { this.send(ws, { type: 'error', code: 'BUSY', message: 'Another voice session is active on the computer.', fatal: true }); ws.close(); return; }
    const s = this.session = { ws, device, turns: null, diary: [], state: 'starting', lastInput: this.now() };
    s.timer = setInterval(() => { if (this.now() - s.lastInput > IDLE_MS || !this.vault.value.devices[device]) ws.terminate(); }, 5000); s.timer.unref();
    let controls = Promise.resolve();
    ws.on('message', (data, binary) => {
      s.lastInput = this.now();
      // Audio is handled in arrival order, ahead of any later control message.
      if (binary) { try { this.audio(s, data); } catch (e) { this.fail(s, e); } return; }
      controls = controls.then(() => this.control(s, JSON.parse(data.toString()))).catch((e) => this.fail(s, e));
    });
    ws.on('close', () => { this.end(s).catch(() => {}); });
    this.send(ws, { type: 'ready', sampleRate: 16000, channels: 1, format: 's16le', pauseMs: this.pauseMs });
    this.emit('change');
  }
  async control(s, message) {
    if (s.closed) return;
    switch (message?.type) {
      case 'start': {
        if (s.turns) throw new CompanionError('INVALID_INPUT', 'This session has already started.');
        const turns = validateTurns(message.turns);
        if (!turns.length) validateConversationInput(JSON.stringify({ action: 'open', turns, diary: message.diary || [] }));
        s.turns = turns; s.diary = turns.length ? [] : message.diary || []; s.state = 'idle';
        // The phone speaks a waiting question itself, then asks to listen.
        if (!turns.length || turns.at(-1).speaker === 'user') await this.reply(s);
        return;
      }
      case 'listen': if (s.state === 'idle' && s.turns) await this.listen(s); return;
      case 'done': if (s.state === 'listening') await this.endTurn(s); return;
      case 'retry': if (s.state === 'idle' && s.turns && (!s.turns.length || s.turns.at(-1).speaker === 'user')) await this.reply(s); return;
      default: throw new CompanionError('INVALID_INPUT', 'Unknown talk message.');
    }
  }
  async reply(s) {
    s.state = 'thinking'; this.send(s.ws, { type: 'thinking' });
    const action = s.turns.length ? 'question' : 'open';
    const prompt = JSON.stringify({ action, turns: s.turns, ...(action === 'open' ? { diary: s.diary } : {}) });
    const result = await this.runtime.generate(prompt, { operation: CONVERSATION_OPERATION, onToken: (text) => { if (!s.closed) this.send(s.ws, { type: 'token', text }); } });
    if (s.closed) return;
    s.state = 'idle';
    if (!result.ok) { this.send(s.ws, { type: 'error', code: result.error.code, message: result.error.message }); return; }
    s.turns.push({ speaker: 'assistant', text: result.text }); s.diary = [];
    this.send(s.ws, { type: 'reply', text: result.text });
  }
  async listen(s) {
    if (s.turns.length >= TURN_LIMIT) throw new CompanionError('INPUT_LIMIT', 'This conversation has reached 24 turns. Finish and review the draft.');
    s.state = 'opening';
    const engine = await this.speech.open();
    const turn = s.turn = { engine, segments: [], bytes: 0, next: 0, voicedMs: 0, heardMs: -1, floor: QUIET_ROOM, spoke: false, released: false };
    if (s.closed) { this.release(s); return; }
    turn.consume = (async () => {
      try {
        for await (const segment of engine) {
          const value = mergeSegment(turn.segments, segment);
          turn.heardMs = turn.bytes * MS_PER_BYTE;
          this.send(s.ws, { type: 'segment', segment: value }); this.check(s);
        }
      } catch { turn.failed = true; }
    })();
    s.state = 'listening'; this.send(s.ws, { type: 'listening' });
  }
  audio(s, data) {
    // Trailing frames after the turn ended are expected; ignore them.
    if (s.state !== 'listening') return;
    const turn = s.turn;
    if (data.length <= 4 || (data.length - 4) % 2 || data.length > 6404 || data.readUInt32BE(0) !== turn.next) throw new CompanionError('AUDIO_SEQUENCE', 'Audio arrived out of order. Answer again.');
    const pcm = Buffer.from(data.subarray(4));
    turn.bytes += pcm.length; turn.next++;
    if (turn.bytes > MAX_BYTES) { this.endTurn(s).catch((e) => this.fail(s, e)); return; }
    turn.engine.write(pcm);
    // Talking is judged from loudness against the room's own noise floor, so
    // a long sentence without a Whisper pause is never cut off.
    const level = loudness(pcm);
    turn.floor = level < turn.floor ? level : turn.floor + (level - turn.floor) * 0.01;
    if (level > Math.max(0.02, turn.floor * 3)) { turn.voicedMs = turn.bytes * MS_PER_BYTE; turn.spoke = true; }
    this.check(s);
  }
  /// Ends the turn after a long enough pause, once Whisper has caught up with
  /// the last speech. A longer silence ends it regardless.
  check(s) {
    const turn = s.turn;
    if (s.state !== 'listening' || !turn.spoke || !turn.segments.some((x) => x.text.trim())) return;
    const silence = turn.bytes * MS_PER_BYTE - turn.voicedMs;
    if ((silence >= this.pauseMs && turn.heardMs >= turn.voicedMs) || silence >= this.giveUpMs) this.endTurn(s).catch((e) => this.fail(s, e));
  }
  async endTurn(s) {
    if (s.state !== 'listening') return;
    s.state = 'transcribing'; this.send(s.ws, { type: 'endpoint' });
    const turn = s.turn;
    turn.engine.end();
    let timer;
    await Promise.race([turn.consume, new Promise((resolve) => { timer = setTimeout(resolve, 15000); })]);
    clearTimeout(timer);
    this.release(s);
    if (s.closed) return;
    if (turn.failed) throw new CompanionError('TRANSCRIPTION_FAILED', 'Speech could not be transcribed. Answer again.');
    const text = turn.segments.map((x) => x.text.trim()).filter(Boolean).join(' ');
    if (!text) { s.state = 'idle'; this.send(s.ws, { type: 'empty' }); return; }
    validateTurns([{ speaker: 'user', text }]);
    s.turns.push({ speaker: 'user', text });
    this.send(s.ws, { type: 'turn', text });
    await this.reply(s);
  }
  release(s) {
    const turn = s.turn;
    if (!turn || turn.released) return;
    turn.released = true; s.turn = null; turn.engine.destroy(); this.speech.release();
  }
  fail(s, e) {
    if (s.turn) this.release(s);
    if (s.closed) return;
    s.state = 'idle';
    this.send(s.ws, { type: 'error', code: e instanceof CompanionError ? e.code : 'TALK_FAILED', message: e instanceof CompanionError ? e.message : 'The conversation hit a problem on the computer. Continue to try again.' });
  }
  async end(s) {
    if (s.closed) return;
    s.closed = true; clearInterval(s.timer); this.release(s);
    if (s.state === 'thinking') await this.runtime.cancelGeneration().catch(() => {});
    if (this.session === s) this.session = null;
    this.emit('change');
  }
  forget(device) { if (this.session?.device === device) this.session.ws.terminate(); }
  shutdown() { this.session?.ws.terminate(); }
}
module.exports = { Talk, loudness, PAUSE_MS, GIVE_UP_MS };
