import { icon } from './icons.js';
import { h, pill, act, reducedMotion } from './ui.js';
import { subscribe, publish } from './store.js';
import { describe, isActive, outcome } from './tasks.js';
import { startPairing } from './phones.js';

const key = (job) => `${job.device}/${job.id}`;
const seconds = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

function headline(state, phones, active) {
  if (state.error?.code === 'UNSUPPORTED_HOST' || state.serviceError) return ['Something needs a look.', 'problem'];
  if (state.devices?.pending?.length) return ['A phone wants to join.', 'join'];
  if (active.length) return ['Busy helping your phone.', 'working'];
  if (!phones.length) return ['Let’s get you connected.', 'connect'];
  if (state.status !== 'ready') return ['Give it a brain.', 'brain'];
  return ['All set. Ready when you are.', 'ready'];
}

const TV_MOOD = { unavailable: 'asleep', failed: 'problem', loading: 'waking', ready: 'ready', working: 'thinking' };
const TV_BADGE = { asleep: 'moon', problem: 'alert', waking: 'spark', ready: 'check', thinking: 'sparkle' };

export function homeView(root, { go }) {
  const title = h('h1', { class: 'view-title' });
  const banner = h('div', { class: 'banner', hidden: true });

  // The bridge: your phones on the left, this Mac's brain (the QVAC TV) on the right.
  const phonesSide = h('div', { class: 'bridge-phones' });
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  path.setAttribute('viewBox', '0 0 400 120'); path.setAttribute('preserveAspectRatio', 'none'); path.setAttribute('class', 'bridge-line');
  path.innerHTML = '<path class="bridge-rail" d="M6 70 C 120 10, 280 10, 394 70"/><path class="bridge-flow" d="M6 70 C 120 10, 280 10, 394 70"/><path class="bridge-gap" d="M180 26 l14 18 M206 26 l-14 18"/>';
  const badge = h('span', { class: 'tv-badge' });
  const slot = h('span', { class: 'tv-slot' });
  const tv = h('div', { class: 'tv' },
    h('img', { src: 'assets/art/more_local_qvac.png', alt: '', class: 'tv-img' }),
    h('span', { class: 'tv-screen' }), badge, slot);
  const connect = pill('Connect a phone', async () => { go('phones'); await startPairing(); }, { arrow: 'qr', small: true });
  const bridge = h('section', { class: 'bridge paper' },
    phonesSide,
    h('div', { class: 'bridge-mid' }, path, connect),
    h('div', { class: 'bridge-mac' }, tv, h('span', { class: 'hand bridge-label', text: 'this Mac' })));

  const nowList = h('div', { class: 'now-list' });
  const nowEmpty = h('div', { class: 'now-empty' }, icon('moon'), h('span', { class: 'hand', text: 'Quiet for now.' }));
  const pile = h('div', { class: 'pile' });
  const pileWrap = h('section', { class: 'pile-wrap' }, h('p', { class: 'eyebrow', text: 'Finished today' }), pile);

  root.append(
    h('header', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow', text: 'Home' }), title)),
    banner, bridge,
    h('section', { class: 'now' }, h('p', { class: 'eyebrow', text: 'Working now' }), nowList, nowEmpty),
    pileWrap);

  const seen = new Set();
  let first = true, lastPhones = '', lastNow = '';

  function renderBanner(state, mode) {
    banner.hidden = !['problem', 'join'].includes(mode);
    if (banner.hidden) return;
    const join = mode === 'join';
    banner.className = `banner${join ? ' attention' : ''}`;
    const text = join ? `${state.devices.pending[0].name} is waiting for you.`
      : state.error?.code === 'UNSUPPORTED_HOST' ? state.error.message : state.serviceError;
    banner.replaceChildren(icon(join ? 'phone' : 'alert'), h('span', { text }),
      join ? h('button', { class: 'soft-btn', onclick: () => go('phones') }, icon('arrow'), h('span', { text: 'Look' })) : '');
  }

  function renderBridge(state, phones) {
    const online = phones.some((d) => d.connected);
    const mode = !state.devices?.enabled || !phones.length ? 'broken' : online ? 'live' : 'sleep';
    bridge.dataset.mode = mode;
    connect.hidden = mode !== 'broken';
    const sig = JSON.stringify(phones.slice(0, 3).map((d) => [d.name, d.connected]));
    if (sig !== lastPhones) {
      lastPhones = sig;
      phonesSide.replaceChildren(...(phones.length ? phones.slice(0, 3) : [null]).map((d) =>
        h('div', { class: `bridge-phone${d?.connected ? ' on' : ''}${d ? '' : ' ghost'}` },
          icon('phone'), d && h('span', { class: 'bridge-phone-dot' }, icon(d.connected ? 'wifi' : 'moon')),
          h('span', { class: 'hand', text: d ? d.name : 'your phone' }))),
      phones.length > 3 ? h('span', { class: 'hand more-phones', text: `+${phones.length - 3}` }) : '');
    }
    const mood = state.activity?.some(isActive) && state.status !== 'failed' ? 'thinking' : TV_MOOD[state.status] || 'asleep';
    if (tv.dataset.mood !== mood) { tv.dataset.mood = mood; badge.replaceChildren(icon(TV_BADGE[mood])); }
  }

  function taskCard(job, place) {
    const look = describe(job.operation);
    const queued = job.state === 'queued';
    return h('article', { class: `task paper${queued ? ' queued' : ''}`, vars: { '--accent': look.accent } },
      h('div', { class: 'task-icon' }, icon(queued ? 'hourglass' : look.icon)),
      h('div', { class: 'task-body' },
        h('strong', { text: look.verb }),
        h('span', { class: 'task-from' }, icon('phone'), h('span', { text: job.deviceName })),
        queued ? h('span', { class: 'task-line hand', text: place === 1 ? 'next in line' : `${place} in line` }) : h('div', { class: 'ink-bar' })),
      h('span', { class: 'task-time', 'data-since': String(job.created) }, seconds(Date.now() - job.created)),
      h('button', { class: 'round-btn task-stop', 'aria-label': 'Stop this task', title: 'Stop',
        onclick: async () => { await act(() => window.companion.cancelJob(job.device, job.id)); publish(await window.companion.state()); } }, icon('cross')));
  }

  function slip(job) {
    const look = describe(job.operation), end = outcome(job);
    return h('div', { class: `slip ${end.tone}`, 'data-key': key(job), vars: { '--accent': look.accent }, title: `${look.verb} · ${job.deviceName}` },
      h('span', { class: 'slip-icon' }, icon(look.icon)),
      h('span', { class: 'slip-name', text: job.deviceName }),
      h('span', { class: `stamp ${end.tone === 'done' ? '' : end.tone}` }, icon(end.icon), h('span', { text: end.label })));
  }

  function flyFromTv(node) {
    if (reducedMotion()) return;
    const from = slot.getBoundingClientRect(), to = node.getBoundingClientRect();
    if (!to.width) return;
    node.animate([
      { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(.3) rotate(-20deg)`, opacity: 0 },
      { transform: `translate(${(from.left - to.left) * .4}px, ${(from.top - to.top) * .4 - 60}px) scale(.8) rotate(8deg)`, opacity: 1, offset: .5 },
      { transform: 'none', opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  function renderTasks(state) {
    const jobs = [...(state.activity || [])].sort((a, b) => a.created - b.created);
    const active = jobs.filter(isActive);
    const queued = active.filter((j) => j.state === 'queued');
    const nowSig = JSON.stringify(active.map((j) => [key(j), j.state]));
    if (nowSig !== lastNow) { lastNow = nowSig; nowList.replaceChildren(...active.map((j) => taskCard(j, queued.indexOf(j) + 1))); }
    nowEmpty.hidden = !!active.length;

    const done = jobs.filter((j) => !isActive(j) && (j.finished || j.created) > Date.now() - 24 * 3600e3).reverse().slice(0, 18);
    const fresh = [];
    const existing = new Map([...pile.children].map((n) => [n.dataset.key, n]));
    const nodes = done.map((j) => {
      const k = key(j);
      if (existing.has(k) && existing.get(k).dataset.state === j.state) return existing.get(k);
      const node = slip(j); node.dataset.state = j.state;
      if (!first && !seen.has(k)) fresh.push(node);
      seen.add(k); return node;
    });
    pile.replaceChildren(...nodes);
    pileWrap.hidden = !done.length;
    fresh.forEach(flyFromTv);
    first = false;
    return active;
  }

  subscribe((state) => {
    const phones = state.devices?.devices || [];
    const active = renderTasks(state);
    const [text, mode] = headline(state, phones, active);
    title.textContent = text;
    renderBanner(state, mode);
    renderBridge(state, phones);
  });
  setInterval(() => { for (const node of root.querySelectorAll('[data-since]')) node.textContent = seconds(Date.now() - Number(node.dataset.since)); }, 1000);
}
