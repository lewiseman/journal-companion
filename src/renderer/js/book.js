// The desktop onboarding book: a port of the phone's RenderBentBookPage to CSS 3D.
// A turning leaf is cut into nested vertical strips; each frame bends them with the same curve the phone uses:
//   angle(u) = π·t + 1.25·sin(π·t)·(u − .5)
import { icon } from './icons.js';
import { h, reducedMotion } from './ui.js';

const STRIPS = 16;
const TURN_MS = 850;
const OPEN_MS = 1100;
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInOutCubic = (x) => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const INTERACTIVE = 'button, a, input, textarea, select, label, .qr-paper, .no-turn';

export function createBook({ spreads, onFinish }) {
  const left = h('div', { class: 'page page-left' });
  const right = h('div', { class: 'page page-right' });
  const leaf = h('div', { class: 'leaf', hidden: true });
  const turnShadow = h('div', { class: 'turn-shadow' });
  const coverBack = h('div', { class: 'cover-back' });
  const cover = h('div', { class: 'cover' },
    h('div', { class: 'cover-front' },
      h('img', { src: 'assets/art/cover.webp', alt: '' }),
      h('span', { class: 'cover-spine' }),
      h('span', { class: 'cover-name', text: 'Companion' })),
    coverBack);
  const book = h('div', { class: 'book', 'data-state': 'closed' },
    h('div', { class: 'board' }), h('div', { class: 'block block-left' }), h('div', { class: 'block block-right' }),
    left, right, h('div', { class: 'gutter' }), turnShadow, leaf, cover);

  const dots = h('div', { class: 'book-dots', role: 'tablist' }, spreads.map((_, i) => h('span', { class: 'book-dot', 'aria-label': `Page ${i + 1}` })));
  const prev = h('button', { class: 'round-btn', 'aria-label': 'Previous page' }, icon('back'));
  const next = h('button', { class: 'round-btn', 'aria-label': 'Next page' }, icon('arrow'));
  const controls = h('div', { class: 'book-controls' }, prev, dots, next);
  const openBtn = h('button', { class: 'pill book-open' },
    h('span', { class: 'pill-in' }, h('span', { class: 'pill-label', text: 'Open' }), h('span', { class: 'chip-arrow' }, icon('book'))));
  const skip = h('button', { class: 'link-btn book-skip' }, h('span', { text: 'Skip' }), icon('arrow'));
  const tagline = h('p', { class: 'book-tagline hand', text: 'Your phone’s quiet helper.' });
  const scene = h('section', { class: 'book-scene', 'aria-label': 'Welcome book' },
    skip, h('div', { class: 'book-stage' }, book), h('div', { class: 'book-under' }, tagline, openBtn, controls));

  let index = 0, animating = false, opened = false;
  const sheet = (node, side) => h('div', { class: `sheet ${side}` }, node);
  const sheets = spreads.map((s, i) => ({
    left: sheet(h('div', { class: 'page-inner' }, s.left, h('span', { class: 'page-no', text: String(i * 2 + 1) })), 'left'),
    right: sheet(h('div', { class: 'page-inner' }, s.right, h('span', { class: 'page-no', text: String(i * 2 + 2) })), 'right'),
  }));

  function place() {
    left.replaceChildren(sheets[index].left);
    right.replaceChildren(sheets[index].right);
    [...dots.children].forEach((d, i) => d.classList.toggle('active', i === index));
    prev.disabled = index === 0 || animating;
    next.disabled = index === spreads.length - 1 || animating;
    spreads[index].onShow?.();
  }

  /* Builds the strip chain with inert snapshots of the two faces. */
  function buildLeaf(front, back) {
    const strips = [];
    let parent = leaf;
    leaf.replaceChildren();
    for (let k = 0; k < STRIPS; k++) {
      const face = (node, offset, side) => {
        const copy = node.cloneNode(true);
        copy.inert = true;
        const slice = h('div', { class: 'slice', vars: { '--k': String(offset) } }, copy);
        return h('div', { class: `face ${side}` }, slice, h('div', { class: 'shade' }));
      };
      const strip = h('div', { class: 'strip' }, face(front, k, 'front'), face(back, STRIPS - 1 - k, 'back'));
      parent.append(strip);
      strips.push(strip);
      parent = strip;
    }
    return strips;
  }

  function bend(strips, t) {
    let previous = 0;
    const lift = Math.sin(Math.PI * t);
    for (let k = 0; k < strips.length; k++) {
      const u = (k + .5) / strips.length;
      const angle = Math.min(Math.PI, Math.max(0, Math.PI * t + 1.25 * lift * (u - .5)));
      strips[k].style.transform = `rotateY(${-(angle - previous)}rad)`;
      const shade = (1 - Math.abs(Math.cos(angle))) * .2;
      for (const s of strips[k].querySelectorAll(':scope > .face > .shade')) s.style.opacity = String(shade);
      previous = angle;
    }
    turnShadow.style.opacity = String(.26 * lift);
    turnShadow.style.setProperty('--blur', `${1.2 + 7 * lift}px`);
  }

  function animate(from, to, duration, ease, step) {
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now) => {
        const x = Math.min(1, (now - start) / Math.max(1, duration));
        step(from + (to - from) * ease(x));
        if (x < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /* Prepares a turn. Forward turns lift the right page; backward turns bring the left page back. */
  function prepare(direction) {
    const target = index + direction;
    if (direction > 0) {
      const strips = buildLeaf(sheets[index].right, sheets[target].left);
      right.replaceChildren(sheets[target].right);
      return { strips, target, from: 0, to: 1 };
    }
    const strips = buildLeaf(sheets[target].right, sheets[index].left);
    left.replaceChildren(sheets[target].left);
    return { strips, target, from: 1, to: 0 };
  }

  async function finishTurn(turn, committed, from) {
    const end = committed ? turn.to : turn.from;
    const remaining = Math.abs(end - from);
    await animate(from, end, TURN_MS * Math.max(.25, remaining), easeOutCubic, (t) => bend(turn.strips, t));
    leaf.hidden = true; leaf.replaceChildren(); turnShadow.style.opacity = '0';
    if (committed) index = turn.target;
    animating = false;
    place();
  }

  async function turn(direction) {
    const target = index + direction;
    if (animating || !opened || target < 0 || target >= spreads.length) return;
    animating = true;
    if (reducedMotion()) {
      index = target; place();
      book.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 250 });
      animating = false; return;
    }
    const t = prepare(direction);
    leaf.hidden = false; bend(t.strips, t.from);
    await finishTurn(t, true, t.from);
  }

  /* Drag a page like paper: commits past a quarter turn or on a quick flick. */
  function onPointerDown(event, direction) {
    if (animating || !opened || event.button !== 0 || event.target.closest(INTERACTIVE)) return;
    const target = index + direction;
    if (target < 0 || target >= spreads.length) return;
    const startX = event.clientX, width = right.getBoundingClientRect().width;
    let t = null, lastX = startX, lastTime = performance.now(), velocity = 0;
    const move = (e) => {
      const dx = (startX - e.clientX) * direction;
      if (t === null && Math.abs(dx) < 6) return;
      if (t === null) { animating = true; t = prepare(direction); leaf.hidden = false; }
      const now = performance.now();
      velocity = ((lastX - e.clientX) * direction) / Math.max(1, now - lastTime) * 1000;
      lastX = e.clientX; lastTime = now;
      const progress = Math.min(1, Math.max(0, dx / (width * 1.6)));
      t.progress = progress;
      bend(t.strips, direction > 0 ? progress : 1 - progress);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (t === null) { turn(direction); return; }
      const progress = t.progress || 0;
      finishTurn(t, progress > .25 || velocity > 350, direction > 0 ? progress : 1 - progress);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  right.addEventListener('pointerdown', (e) => onPointerDown(e, 1));
  left.addEventListener('pointerdown', (e) => onPointerDown(e, -1));
  prev.onclick = () => turn(-1);
  next.onclick = () => turn(1);
  dots.addEventListener('click', (e) => { const i = [...dots.children].indexOf(e.target); if (i >= 0 && i !== index) turn(Math.sign(i - index)); });

  async function open() {
    if (opened || animating) return;
    animating = true;
    index = 0; place();
    coverBack.replaceChildren(sheets[0].left.cloneNode(true));
    coverBack.firstChild.inert = true;
    left.classList.add('waiting');
    book.dataset.state = 'opening';
    scene.dataset.state = 'open';
    const duration = reducedMotion() ? 1 : OPEN_MS;
    await animate(0, 1, duration, (x) => (x < .8 ? easeInOutCubic(x / .8) * 1.02 : 1.02 - .02 * easeOutCubic((x - .8) / .2)), (p) => {
      cover.style.transform = `rotateY(${-180 * Math.min(1, p)}deg)`;
      book.style.setProperty('--shift', String(1 - Math.min(1, p)));
    });
    book.dataset.state = 'open';
    left.classList.remove('waiting');
    opened = true; animating = false; place();
    next.focus();
  }
  openBtn.onclick = open;
  cover.addEventListener('click', open);

  async function close() {
    if (!reducedMotion()) await scene.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(40px) scale(.94)' }], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished;
    onFinish?.();
  }
  skip.onclick = close;

  function onKey(event) {
    if (scene.hidden || event.target.closest('textarea, input')) return;
    if (!opened && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')) { event.preventDefault(); open(); }
    else if (event.key === 'ArrowRight') turn(1);
    else if (event.key === 'ArrowLeft') turn(-1);
    else if (event.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  /** Resets to the closed cover, ready to be opened again. */
  function reset() {
    opened = false; animating = false; index = 0;
    book.dataset.state = 'closed'; scene.dataset.state = 'closed';
    cover.style.transform = ''; book.style.setProperty('--shift', '1');
    for (const a of scene.getAnimations()) a.cancel();
    place();
  }
  reset();

  return { el: scene, reset, close, goTo: (i) => turn(Math.sign(i - index)), get index() { return index; } };
}
