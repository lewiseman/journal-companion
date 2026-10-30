import { icon } from './icons.js';
import { h, reducedMotion } from './ui.js';
import { publish, subscribe } from './store.js';
import { homeView } from './home.js';
import { phonesView } from './phones.js';
import { skillsView } from './skills.js';
import { createBook } from './book.js';
import { bookSpreads } from './book-pages.js';
import { appearanceButton } from './appearance.js';

const BOOK_DONE = 'journal.book.done';
const remember = () => { try { localStorage.setItem(BOOK_DONE, '1'); } catch {} };
const seenBook = () => { try { return localStorage.getItem(BOOK_DONE) === '1'; } catch { return false; } };

const app = document.getElementById('app');
const views = { home: document.getElementById('view-home'), phones: document.getElementById('view-phones'), skills: document.getElementById('view-skills') };
const tabs = {};

const rail = document.getElementById('rail');
const glow = [h('span', { class: 'rail-glow' }), h('span', { class: 'rail-rim' })];

/** Slides the edge glow to the selected tab, like the phone's bottom bar. */
function placeGlow() {
  const current = Object.values(tabs).find((tab) => tab.getAttribute('aria-current') === 'page');
  rail.classList.toggle('no-glow', !current);
  if (current) rail.style.setProperty('--glow-y', `${current.offsetTop + current.offsetHeight / 2}px`);
}

function go(name) {
  for (const [key, view] of Object.entries(views)) view.classList.toggle('active', key === name);
  for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-current', key === name ? 'page' : 'false');
  placeGlow();
}

/** Cut-paper art from the phone's navigation: a quiet version that crossfades to the lively one. */
const art = (off, on = off) => h('span', { class: `tab-art${on === off ? ' single' : ''}` },
  h('img', { class: 'off', src: off, alt: '' }), h('img', { class: 'on', src: on, alt: '' }));
const navContent = (look, label) => [art(...look), h('span', { text: label })];

const TABS = [
  ['home', ['assets/art/more_local_qvac.png'], 'Home'],
  ['phones', ['assets/art/nav/phone_inactive.svg', 'assets/art/nav/phone_active.svg'], 'Phones'],
  ['skills', ['assets/art/nav/more_inactive.png', 'assets/art/nav/more_active.png'], 'Skills'],
];
const pips = {};
rail.append(...glow, h('img', { class: 'rail-logo', src: 'assets/art/j.png', alt: 'Journal' }));
for (const [key, look, label] of TABS) {
  pips[key] = h('span', { class: 'tab-pip', hidden: true });
  tabs[key] = h('button', { class: 'tab', onclick: () => go(key) }, navContent(look, label), pips[key]);
  rail.append(tabs[key]);
}
const [lookButton, lookSheet] = appearanceButton(navContent(['assets/art/nav/more_appearance.png'], 'Look'));
document.body.append(lookSheet);
rail.append(h('button', { class: 'tab', onclick: () => showBook() }, navContent(['assets/art/nav/diary_inactive.png', 'assets/art/nav/diary_active.png'], 'Journal')),
  lookButton,
  h('div', { class: 'rail-foot', title: 'Everything stays on this Mac and your home Wi-Fi.' }, icon('shield'), h('span', { text: 'Private' })));
window.addEventListener('resize', placeGlow);

homeView(views.home, { go });
phonesView(views.phones);
skillsView(views.skills);
go('home');

/* ── Book ─────────────────────────────────────────────── */
let book;
const spreads = bookSpreads({ turn: () => book.goTo(book.index + 1), finish: () => book.close() });
book = createBook({ spreads, onFinish: hideBook });
const bookHost = document.getElementById('book');
bookHost.append(book.el);

function showBook() {
  book.reset();
  bookHost.hidden = false;
  app.hidden = true;
}
function hideBook() {
  remember();
  bookHost.hidden = true;
  app.hidden = false;
  if (!reducedMotion()) app.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' });
  go('home');
}
if (seenBook()) hideBook(); else showBook();

/* ── Live state ───────────────────────────────────────── */
subscribe((state) => {
  pips.phones.hidden = !state.devices?.pending?.length && !state.serviceError;
  pips.phones.className = 'tab-pip alert';
  const working = state.activity?.some((j) => ['queued', 'running'].includes(j.state));
  pips.home.hidden = !working; pips.home.className = 'tab-pip busy';
  // An approval request always deserves attention, wherever the person is.
  if (state.devices?.pending?.length && bookHost.hidden && !views.phones.classList.contains('active') && !views.home.classList.contains('active')) go('phones');
});
window.companion.onState(publish);
window.companion.state().then(publish);
setInterval(() => window.companion.state().then(publish), 5000);
