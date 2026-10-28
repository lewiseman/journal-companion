import { icon } from './icons.js';
import { h, reducedMotion } from './ui.js';
import { publish, subscribe } from './store.js';
import { homeView } from './home.js';
import { phonesView } from './phones.js';
import { skillsView } from './skills.js';
import { createBook } from './book.js';
import { bookSpreads } from './book-pages.js';

const BOOK_DONE = 'journal.book.done';
const remember = () => { try { localStorage.setItem(BOOK_DONE, '1'); } catch {} };
const seenBook = () => { try { return localStorage.getItem(BOOK_DONE) === '1'; } catch { return false; } };

const app = document.getElementById('app');
const views = { home: document.getElementById('view-home'), phones: document.getElementById('view-phones'), skills: document.getElementById('view-skills') };
const tabs = {};

function go(name) {
  for (const [key, view] of Object.entries(views)) view.classList.toggle('active', key === name);
  for (const [key, tab] of Object.entries(tabs)) tab.setAttribute('aria-current', key === name ? 'page' : 'false');
}

const TABS = [['home', 'home', 'Home'], ['phones', 'phone', 'Phones'], ['skills', 'brain', 'Skills']];
const pips = {};
const rail = document.getElementById('rail');
rail.append(h('img', { class: 'rail-logo', src: 'assets/art/j.png', alt: 'Journal' }));
for (const [key, iconName, label] of TABS) {
  pips[key] = h('span', { class: 'tab-pip', hidden: true });
  tabs[key] = h('button', { class: 'tab', onclick: () => go(key) }, icon(iconName), h('span', { text: label }), pips[key]);
  rail.append(tabs[key]);
}
rail.append(h('button', { class: 'tab', onclick: () => showBook() }, icon('book'), h('span', { text: 'Book' })),
  h('div', { class: 'rail-foot', title: 'Everything stays on this Mac and your home Wi-Fi.' }, icon('shield'), h('span', { text: 'Private' })));

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
