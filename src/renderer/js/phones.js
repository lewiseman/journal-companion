import { icon } from './icons.js';
import { h, pill, setPill, softBtn, act, toast, confirmAsk, info, listenBtn } from './ui.js';
import { store, publish, subscribe } from './store.js';

const PAIR_STEPS = 'Put your phone on the same Wi-Fi. Open Journal, then Local QVAC, then Scan QR. Point it at this code. Check the code on your phone matches, then press the green tick here.';

export async function startPairing() {
  const result = await act(() => window.companion.pair());
  if (result?.ok) {
    // Pairing turns the phone service on; read that state before showing the QR so it is not cleared as stale.
    const state = await window.companion.state();
    store.pairing = { code: result.code, qr: result.qr, expires: result.expires };
    publish(state);
  }
  return result;
}

async function answer(ticket, name, allowed) {
  const result = await act(() => window.companion.approve(ticket, allowed));
  if (result && result.ok !== false && allowed) store.joined = { name, at: Date.now() };
  store.pairing = null;
  publish(await window.companion.state());
}

/** Clears a QR that can no longer be used, like the previous UI did. */
function expirePairing(devices) {
  if (store.pairing && (Date.now() >= store.pairing.expires || devices?.pending?.length || !devices?.enabled)) store.pairing = null;
}

function codeTiles(code) {
  const groups = (code.match(/.{1,4}/g) || [code]).slice(0, 3);
  return h('div', { class: 'code-tiles' }, groups.map((g) => h('span', { class: 'code-tile', text: g })));
}

/** The pairing card: start → QR with countdown → compare codes → connected. Used by the book and the Phones screen. */
export function pairPanel({ pairId, onJoined } = {}) {
  const start = pill('Connect a phone', () => startPairing(), { id: pairId, arrow: 'qr' });
  const idle = h('div', { class: 'pair-idle' },
    h('div', { class: 'pair-scene' }, icon('phone', 'pair-phone'), h('span', { class: 'pair-dots' }), icon('mac', 'pair-mac')),
    start);

  const qrImg = h('img', { class: 'qr-img', alt: 'Pairing QR code. Scan it with Journal on your phone.', width: 260, height: 260 });
  const seconds = h('span', { class: 'qr-seconds' });
  const timer = h('div', { class: 'ring qr-timer', vars: { '--size': '64px', '--c': 'var(--honey)' } }, seconds);
  const codeBox = h('textarea', { class: 'pair-code', readonly: true, 'aria-label': 'Pairing code' });
  const copy = softBtn('copy', 'Copy', async () => {
    codeBox.select();
    try { await navigator.clipboard.writeText(codeBox.value); } catch { document.execCommand('copy'); }
    toast('Copied. Paste it in Journal on your phone.', 'copy');
  });
  const codeArea = h('div', { class: 'pair-code-area', hidden: true },
    h('p', { class: 'pair-warn' }, icon('lock'), h('span', { text: 'Only share with your own phone.' })), codeBox, copy);
  const qr = h('div', { class: 'pair-qr' },
    h('div', { class: 'qr-paper' }, qrImg, h('span', { class: 'hand qr-note', text: 'scan me with Journal' })),
    h('div', { class: 'qr-side' },
      timer,
      softBtn('refresh', 'New code', () => startPairing()),
      h('button', { class: 'link-btn', text: 'Use a code instead', onclick: () => { codeArea.hidden = !codeArea.hidden; } }),
      listenBtn(PAIR_STEPS)),
    codeArea);

  const askName = h('strong', { class: 'ask-name' });
  const askTiles = h('div');
  let ticket = null, askingName = '', askingCode = '';
  const ask = h('div', { class: 'pair-ask' },
    h('div', { class: 'ask-phone' }, icon('phone'), askName),
    h('p', { class: 'ask-question', text: 'Does your phone show this?' }),
    askTiles,
    h('div', { class: 'ask-buttons' },
      h('button', { class: 'round-btn big no', 'aria-label': 'No, deny', onclick: () => answer(ticket, askingName, false) }, icon('cross')),
      h('button', { class: 'round-btn big yes', 'aria-label': 'Yes, approve', onclick: () => answer(ticket, askingName, true) }, icon('check'))),
    listenBtn(() => `${askingName} wants to join. The code here is ${askingCode.split('').join(', ')}. If your phone shows the same code, press the green tick.`));

  const joinedName = h('strong');
  const joined = h('div', { class: 'pair-joined' },
    h('div', { class: 'joined-art' }, icon('phone'), h('span', { class: 'joined-check' }, icon('check'))),
    h('span', { class: 'stamp land', text: 'Connected!' }), joinedName);

  const problem = h('div', { class: 'pair-problem' }, icon('alert'), h('p'));
  const el = h('div', { class: 'pair-panel' }, idle, qr, ask, joined, problem);
  let shown = null, lastPending = '';

  function show(part) { for (const p of [idle, qr, ask, joined, problem]) p.hidden = p !== part; shown = part; }
  function tick() {
    if (!store.pairing) return;
    const left = Math.max(0, store.pairing.expires - Date.now());
    seconds.textContent = `${Math.ceil(left / 1000)}`;
    timer.style.setProperty('--p', `${left / 120000}`);
    if (!left) publish();
  }

  function render(state) {
    const devices = state.devices;
    expirePairing(devices);
    const pending = devices?.pending?.[0];
    if (!devices) { problem.querySelector('p').textContent = state.serviceError || 'Phone connections are unavailable.'; show(problem); return; }
    if (pending) {
      if (lastPending !== pending.ticket) {
        ticket = pending.ticket; askingName = pending.name; askingCode = pending.verification; lastPending = ticket;
        askName.textContent = pending.name; askTiles.replaceChildren(codeTiles(pending.verification));
      }
      show(ask); return;
    }
    if (store.joined && Date.now() - store.joined.at < 7000) {
      if (shown !== joined) { joinedName.textContent = store.joined.name; show(joined); onJoined?.(); }
      return;
    }
    if (store.pairing) {
      if (qrImg.src !== store.pairing.qr) { qrImg.src = store.pairing.qr; codeBox.value = store.pairing.code; codeArea.hidden = true; }
      show(qr); tick(); return;
    }
    setPill(start, devices.devices?.length ? 'Add another phone' : 'Connect a phone');
    show(idle);
  }
  setInterval(tick, 1000);
  subscribe(render);
  return el;
}

function phoneCard(device) {
  return h('div', { class: `phone-card paper${device.connected ? ' online' : ''}` },
    h('div', { class: 'phone-art' }, icon('phone'), h('span', { class: 'phone-dot' }, icon(device.connected ? 'wifi' : 'moon'))),
    h('div', { class: 'phone-meta' },
      h('strong', { text: device.name }),
      h('span', { class: `status ${device.connected ? 'ready' : ''}` },
        h('span', { class: 'dot' }, icon(device.connected ? 'check' : 'moon')), h('span', { text: device.connected ? 'Here now' : 'Away' }))),
    h('button', {
      class: 'round-btn remove', 'aria-label': `Remove ${device.name}`, title: 'Remove',
      onclick: async () => {
        if (await confirmAsk({ art: 'trash', title: `Remove ${device.name}?`, body: 'It will need a new QR to come back. Its waiting work is deleted.', yes: 'Remove' })) {
          await act(() => window.companion.revoke(device.id)); publish(await window.companion.state());
        }
      },
    }, icon('trash')));
}

export function phonesView(root) {
  const toggle = h('button', { class: 'switch', role: 'switch', 'aria-checked': 'false' },
    h('span', { class: 'track' }, h('span', { class: 'knob' })), h('span', { text: 'Phones can connect' }));
  toggle.onclick = async () => {
    if (toggle.getAttribute('aria-checked') === 'true') { await act(() => window.companion.disableService()); store.pairing = null; publish(await window.companion.state()); }
    else await startPairing();
  };
  const identity = h('code');
  const list = h('div', { class: 'phone-list' });
  const empty = h('div', { class: 'phone-empty' }, icon('phone'), h('span', { class: 'hand', text: 'your phones will live here' }));
  root.append(
    h('header', { class: 'view-head' },
      h('div', {}, h('p', { class: 'eyebrow', text: 'Your devices' }), h('h1', { class: 'view-title', text: 'Your phones' })),
      h('div', { class: 'head-tools' }, toggle,
        info('Phones talk to this Mac only on your home Wi-Fi. Stopping keeps your phones and their work.', h('p', {}, 'This Mac’s identity: ', identity)))),
    h('div', { class: 'phones-grid' },
      h('section', { class: 'paper pair-card', vars: { '--accent': '#8265B0' } }, h('span', { class: 'washi', text: 'Join' }), pairPanel({ pairId: 'pair' })),
      h('section', { class: 'paper list-card', vars: { '--accent': '#517E71' } }, h('span', { class: 'washi', text: 'Trusted' }), list, empty)));

  let lastList = '';
  subscribe((state) => {
    const devices = state.devices;
    toggle.setAttribute('aria-checked', String(!!devices?.enabled));
    toggle.disabled = !devices;
    identity.textContent = devices?.fingerprint ? devices.fingerprint.match(/.{1,4}/g).join(' ') : '—';
    const phones = devices?.devices || [];
    const key = JSON.stringify(phones.map((d) => [d.id, d.name, d.connected]));
    if (key !== lastList) { list.replaceChildren(...phones.map(phoneCard)); lastList = key; }
    empty.hidden = !!phones.length;
  });
}
