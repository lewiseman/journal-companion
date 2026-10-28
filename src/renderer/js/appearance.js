import { icon } from './icons.js';
import { h, act } from './ui.js';

const CHOICES = [
  ['light', 'Light', 'assets/art/theme_light.png'],
  ['dark', 'Dark', 'assets/art/theme_dark.png'],
  ['system', 'Like my Mac', 'assets/art/theme_system.png'],
];

/** Side-bar button plus a picture-first sheet for light, dark or following macOS. */
export function appearanceButton() {
  const cards = new Map();
  const sheet = h('div', { class: 'appearance paper', role: 'dialog', 'aria-label': 'Appearance', hidden: true },
    h('p', { class: 'eyebrow', text: 'Appearance' }),
    h('div', { class: 'appearance-cards', role: 'radiogroup' }, CHOICES.map(([theme, label, art]) => {
      const card = h('button', { class: 'theme-card', role: 'radio', 'aria-checked': 'false', onclick: () => choose(theme) },
        h('img', { src: art, alt: '' }),
        h('span', { class: 'theme-name', text: label }),
        h('span', { class: 'theme-check' }, icon('check')));
      cards.set(theme, card);
      return card;
    })));
  const button = h('button', { class: 'tab', 'aria-haspopup': 'dialog', onclick: (e) => { e.stopPropagation(); sheet.hidden = !sheet.hidden; } },
    icon('theme'), h('span', { text: 'Look' }));

  function mark(theme) { for (const [key, card] of cards) card.setAttribute('aria-checked', String(key === theme)); }
  async function choose(theme) {
    mark(theme);
    const result = await act(() => window.companion.setTheme(theme));
    if (result?.ok) mark(result.theme);
  }
  document.addEventListener('click', (e) => { if (!sheet.hidden && !sheet.contains(e.target)) sheet.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.hidden = true; });
  window.companion.theme().then((result) => mark(result?.theme || 'system'));
  return [button, sheet];
}
