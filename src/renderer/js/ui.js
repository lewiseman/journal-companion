import { icon } from './icons.js';

/** Builds an element. Attributes starting with `on` become listeners; `style` is never set as an attribute (CSP). */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'vars') for (const [name, v] of Object.entries(value)) node.style.setProperty(name, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export const pill = (label, onclick, { arrow = 'arrow', small = false, id } = {}) =>
  h('button', { class: `pill${small ? ' small' : ''}`, id, onclick },
    h('span', { class: 'pill-in' }, h('span', { class: 'pill-label', text: label }), h('span', { class: 'chip-arrow' }, icon(arrow))));

export const setPill = (button, label, arrow) => {
  button.querySelector('.pill-label').textContent = label;
  if (arrow && button.dataset.arrow !== arrow) { button.querySelector('.chip-arrow').replaceChildren(icon(arrow)); button.dataset.arrow = arrow; }
};

export const softBtn = (iconName, label, onclick, extra = '') =>
  h('button', { class: `soft-btn ${extra}`.trim(), onclick }, iconName && icon(iconName), label && h('span', { text: label }));

const STATUS_ICON = { ready: 'check', working: 'spark', attention: 'download', problem: 'alert', asleep: 'moon' };
/** One status vocabulary everywhere: tone decides colour and icon, the word is secondary. */
export function setStatus(node, tone, word) {
  if (node.dataset.tone !== tone) {
    node.className = `status ${tone}`;
    node.replaceChildren(h('span', { class: 'dot' }, icon(STATUS_ICON[tone] || 'moon')), h('span'));
    node.dataset.tone = tone;
  }
  node.lastChild.textContent = word;
}
export const statusEl = () => h('span', { class: 'status', role: 'status' });

export function info(...paragraphs) {
  const pop = h('div', { class: 'pop', hidden: true }, paragraphs.map((p) => (typeof p === 'string' ? h('p', { text: p }) : p)));
  const wrap = h('span', { class: 'info' },
    h('button', { 'aria-label': 'More details', text: 'i', onclick: (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; } }), pop);
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.hidden = true; });
  return wrap;
}

let toastTimer;
export function toast(message, iconName = 'alert') {
  const node = document.getElementById('toast');
  node.replaceChildren(icon(iconName), h('span', { text: message }));
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 5200);
}

/** Runs an IPC action and surfaces its error in the toast, keeping the returned result. */
export async function act(callback) {
  try {
    const result = await callback();
    if (result?.ok === false) toast(result.error?.message || 'That did not work. Try again.');
    return result;
  } catch {
    toast('The companion could not respond. Quit and reopen the app.');
    return null;
  }
}

/** A picture-first confirm dialog. Resolves true only for the yes button. */
export function confirmAsk({ art = 'alert', title, body, yes, no = 'Keep' }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'confirm' },
      h('div', { class: 'art' }, icon(art)), h('h2', { text: title }), body && h('p', { text: body }),
      h('div', { class: 'row' },
        softBtn('back', no, () => dialog.close('no')),
        softBtn('check', yes, () => dialog.close('yes'), 'danger')));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'yes'); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Reads short guidance aloud with the Mac's offline voices, for people who prefer listening. */
export function listenBtn(text) {
  const button = h('button', { class: 'round-btn listen', 'aria-label': 'Listen', title: 'Listen' }, icon('speaker'));
  button.onclick = () => {
    if (!('speechSynthesis' in window)) return;
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    const utterance = new SpeechSynthesisUtterance(typeof text === 'function' ? text() : text);
    utterance.rate = .92;
    utterance.onend = utterance.onerror = () => button.classList.remove('speaking');
    button.classList.add('speaking');
    speechSynthesis.speak(utterance);
  };
  return button;
}

export const formatSize = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
