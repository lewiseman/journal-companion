import { icon } from './icons.js';
import { h, pill, setPill, act, listenBtn, formatSize } from './ui.js';
import { subscribe, publish } from './store.js';
import { pairPanel } from './phones.js';
import { SKILLS } from './skills.js';

const head = (chapter, word) => h('header', { class: 'chapter' },
  h('span', { class: 'chapter-no', text: chapter }), h('span', { class: 'chapter-rule' }, icon('sparkle')), h('span', { class: 'chapter-word', text: word }));

const leftPage = ({ chapter, word, title, line, art }) => h('div', { class: 'left-page' },
  head(chapter, word), h('h2', { class: 'book-title', text: title }), h('p', { class: 'book-line', text: line }), art);

const runningHead = (text) => h('header', { class: 'chapter right-head' }, h('span', { class: 'chapter-no', text }), h('span', { class: 'chapter-rule' }, icon('sparkle')));

function hello() {
  return {
    left: leftPage({ chapter: 'Chapter 01', word: 'Hello', title: 'Your Mac helps your phone.', line: 'Your phone asks. This Mac thinks.',
      art: h('div', { class: 'art-j' }, h('img', { src: 'assets/art/j.png', alt: '' }), h('span', { class: 'hand art-note', text: 'hi there!' })) }),
    right: h('div', { class: 'right-page' }, runningHead('Journal / Companion'),
      h('div', { class: 'hello-scene' },
        h('div', { class: 'hello-phone' }, icon('phone'), h('span', { class: 'hand', text: 'your phone' })),
        h('span', { class: 'hello-bridge' }, h('i'), h('i'), h('i'), h('i'), h('i')),
        h('div', { class: 'hello-mac' }, h('img', { src: 'assets/art/more_local_qvac.png', alt: '' }), h('span', { class: 'hand', text: 'this Mac' }))),
      h('div', { class: 'page-foot' }, listenBtn('Hello. This app lets your Mac help your Journal phone app. Your phone asks, and this Mac does the thinking.'))),
  };
}

function privacy() {
  const row = (name, text) => h('li', {}, h('span', { class: 'pict' }, icon(name)), h('span', { text }));
  return {
    left: leftPage({ chapter: 'Chapter 02', word: 'Private', title: 'It stays in your home.', line: 'No cloud. No account. Just your own devices.',
      art: h('div', { class: 'art-house' }, icon('house'), h('span', { class: 'art-house-lock' }, icon('lock'))) }),
    right: h('div', { class: 'right-page' }, runningHead('Your words, your home'),
      h('ul', { class: 'pict-list' }, row('wifi', 'Same Wi-Fi'), row('shield', 'Only your phones'), row('cloudOff', 'No internet needed')),
      h('div', { class: 'page-foot' }, listenBtn('Everything stays in your home. Your phone and this Mac talk over your own Wi-Fi. Only phones you approve can connect. No internet is needed.'))),
  };
}

function brain({ turn }) {
  const writing = SKILLS[0];
  const ring = h('div', { class: 'ring brain-ring', vars: { '--size': '150px', '--c': '#8265B0' } }, icon('brain'));
  const name = h('strong', { class: 'brain-name' });
  const size = h('span', { class: 'chip' });
  const fit = h('span', { class: 'chip' });
  const word = h('p', { class: 'brain-word hand' });
  const stamp = h('span', { class: 'stamp land', text: 'Ready!' });
  const main = pill('Get it', null);
  const later = h('button', { class: 'link-btn', onclick: () => turn() }, h('span', { text: 'Later' }), icon('arrow'));
  let run = null;
  main.onclick = async () => { if (run) { main.disabled = true; await act(run); publish(await window.companion.state()); } else turn(); };
  const right = h('div', { class: 'right-page brain-page' }, runningHead('Journal / Brain'),
    h('div', { class: 'brain-card' }, ring, stamp, name, h('div', { class: 'chips' }, size, fit), word, main, later),
    h('div', { class: 'page-foot' }, listenBtn('Press the big button to download a writing brain. It stays on this Mac and works without internet.')));

  subscribe((state) => {
    if (!state.library?.models?.length) return;
    const v = writing.view(state);
    const m = v.model;
    name.textContent = m ? m.name : '';
    size.replaceChildren(icon('download'), h('span', { text: m ? formatSize(m.bytes) : '' }));
    const fits = !state.memoryGB || (m && m.memoryGB <= state.memoryGB);
    fit.className = `chip ${fits ? 'good' : 'warn'}`;
    fit.replaceChildren(icon(fits ? 'check' : 'alert'), h('span', { text: m ? `${m.memoryGB} GB memory` : '' }));
    const ready = v.tone === 'ready';
    stamp.hidden = !ready;
    ring.style.setProperty('--p', String(v.progress ?? (ready ? 1 : 0)));
    ring.classList.toggle('indeterminate', v.tone === 'working' && v.progress == null);
    word.textContent = ready ? 'All set!' : v.tone === 'working' ? `${v.word}${v.progress != null ? ` · ${Math.round(v.progress * 100)}%` : '…'}` : '';
    run = v.main?.[2] || null;
    setPill(main, ready ? 'Next' : v.main ? v.main[0] : v.word, ready ? 'arrow' : v.main?.[1] || 'spark');
    main.disabled = !ready && (!v.main || v.tone === 'working');
    later.hidden = ready;
  });
  return {
    left: leftPage({ chapter: 'Chapter 03', word: 'Brain', title: 'Give it a brain.', line: 'One download. It lives on this Mac.',
      art: h('div', { class: 'art-tv' }, h('img', { src: 'assets/art/more_local_qvac.png', alt: '' })) }),
    right,
  };
}

function connect({ finish }) {
  const step = (n, name, text) => h('li', {}, h('span', { class: 'step-no hand', text: n }), h('span', { class: 'pict' }, icon(name)), h('span', { text }));
  return {
    left: h('div', { class: 'left-page' }, head('Chapter 04', 'Connect'),
      h('h2', { class: 'book-title', text: 'Say hello to your phone.' }),
      h('ol', { class: 'steps' },
        step('1', 'wifi', 'Same Wi-Fi'),
        step('2', 'qr', 'Journal › Local QVAC › Scan QR'),
        step('3', 'check', 'Codes match? Tap the tick'))),
    right: h('div', { class: 'right-page pair-page' }, runningHead('Journal / Connect'),
      pairPanel({ onJoined: () => setTimeout(finish, 2600) }),
      h('button', { class: 'link-btn later', onclick: finish }, h('span', { text: 'Finish' }), icon('arrow'))),
  };
}

export function bookSpreads({ turn, finish }) {
  return [hello(), privacy(), brain({ turn }), connect({ finish })];
}
