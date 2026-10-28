import { icon } from './icons.js';
import { h, pill, setPill, softBtn, act, toast, setStatus, statusEl, info, confirmAsk, formatSize } from './ui.js';
import { store, subscribe, publish, busy } from './store.js';

const c = () => window.companion;
const lib = (state) => state.library || { models: [] };
const models = (state) => lib(state).models || [];
const pick = (list, id) => list.find((m) => m.id === id) || list.find((m) => m.recommended) || list[0];
const libraryDownloading = (state) => lib(state).download?.status === 'downloading';
const textDownloading = (state) => state.progress !== null && state.progress !== undefined;
const anyDownload = (state) => libraryDownloading(state) || textDownloading(state);
const unsupported = (state) => state.error?.code === 'UNSUPPORTED_HOST';
const refresh = async () => publish(await c().state());

/** Runs several setup steps in order, stopping at the first that fails. */
async function steps(...actions) {
  for (const action of actions) {
    const result = await act(action);
    if (!result || result.ok === false) return false;
    await refresh();
  }
  return true;
}

/** Downloading a text model switches the writing brain, so put the writing brain back afterwards. */
function installCoding(m, state) {
  const writing = state.model?.id, awake = state.status === 'ready';
  return steps(() => c().install(m.id), () => c().assignCoding(m.id), ...(writing && awake ? [() => c().load(writing)] : []));
}

/** A capability is missing while the app is still starting up; only a service error makes it a problem. */
const starting = (state, model) => (state.serviceError ? { tone: 'problem', word: 'Unavailable', model } : { tone: 'working', word: 'Starting', model });

// Which model each skill is pointed at in the drawer before it is in use.
const chosen = {};

const isWhisper = (m) => m.engine === 'whispercpp-transcription' && !m.filename.includes('silero') && !m.filename.includes('.en-');
const vadOf = (state) => models(state).find((m) => m.filename === 'ggml-silero-v5.1.2.bin');

/* Each skill turns the snapshot into: tone + word, one main action, optional extra actions and a progress value. */
const SKILLS = [
  {
    key: 'writing', name: 'Writing', icon: 'pen', accent: '#8265B0', line: 'Notes, diary help and ideas.',
    list: (s) => models(s).filter((m) => m.capability === 'text' && m.collection !== 'Coding'),
    groups: [['Popular', 'Popular'], ['New', 'Newer'], ['Lightweight', 'Small & quick']],
    current: (s) => models(s).find((m) => m.id === s.model?.id) || pick(SKILLS[0].list(s)),
    view(s) {
      const current = this.current(s), installed = lib(s).model?.installed;
      const recommended = pick(this.list(s), null);
      if (unsupported(s)) return { tone: 'problem', word: 'Not on this Mac', model: current };
      if (textDownloading(s)) return { tone: 'working', word: 'Downloading', progress: s.progress, model: current };
      if (s.status === 'loading') return { tone: 'working', word: 'Waking up', model: current };
      if (s.status === 'working') return { tone: 'working', word: 'Busy', model: current };
      if (s.status === 'ready') return { tone: 'ready', word: 'Ready', model: current, play: true,
        extra: [['moon', 'Sleep', () => c().unload(), busy(s)]] };
      if (s.status === 'failed') return { tone: 'problem', word: 'Problem', model: current,
        main: installed ? ['Try again', 'refresh', () => c().load(current.id)] : [`Get it · ${formatSize(recommended.bytes)}`, 'download', () => c().download(recommended.id)] };
      if (installed) return { tone: 'asleep', word: 'Asleep', model: current, main: ['Wake up', 'power', () => c().load(current.id)] };
      return { tone: 'attention', word: 'Needs download', model: recommended,
        main: [`Get it · ${formatSize(recommended.bytes)}`, 'download', () => c().download(recommended.id)] };
    },
    actions(m, s) {
      if (m.loaded) return [['In use']];
      if (m.installed) return [['Use', 'check', () => c().load(m.id)]];
      return [['Get it', 'download', () => c().download(m.id)], ['Download only', 'download', () => c().install(m.id), 'soft'], ['Choose a file', 'file', () => c().choose(m.id), 'soft']];
    },
  },
  {
    key: 'listening', name: 'Listening', icon: 'mic', accent: '#AF6F84', line: 'Turns your voice into words.',
    list: (s) => models(s).filter(isWhisper),
    current: (s) => pick(SKILLS[1].list(s), chosen.listening || s.speech?.model),
    view(s) {
      const sp = s.speech, m = this.current(s), vad = vadOf(s);
      if (!sp) return starting(s, m);
      if (['loading', 'busy'].includes(sp.status)) return { tone: 'working', word: sp.status === 'busy' ? 'Listening' : 'Waking up', model: m };
      if (sp.status === 'ready' && sp.model === m.id) return { tone: 'ready', word: 'Ready', model: m };
      const missing = [m, vad].filter((x) => x && !x.installed);
      if (missing.length) return { tone: 'attention', word: 'Needs download', model: m, main: [`Get it · ${formatSize(missing.reduce((n, x) => n + x.bytes, 0))}`, 'download',
        () => steps(...missing.map((x) => () => c().install(x.id)), () => c().loadSpeech(m.id))] };
      return { tone: sp.status === 'failed' ? 'problem' : 'asleep', word: sp.status === 'failed' ? 'Problem' : 'Asleep', model: m,
        main: [sp.status === 'failed' ? 'Try again' : 'Wake up', 'power', () => c().loadSpeech(m.id)] };
    },
    actions(m, s) {
      if (s.speech?.status === 'ready' && s.speech.model === m.id) return [['In use']];
      if (m.installed) return [['Use', 'check', () => { chosen.listening = m.id; return c().loadSpeech(m.id); }]];
      return [['Download', 'download', () => { chosen.listening = m.id; return c().install(m.id); }]];
    },
    note: 'Listening also downloads a tiny pause detector (Silero VAD) so speech appears after short pauses.',
  },
  {
    key: 'search', name: 'Search', icon: 'search', accent: '#587BA0', line: 'Finds notes by meaning.',
    list: (s) => models(s).filter((m) => m.capability === 'embedding'),
    current: (s) => pick(SKILLS[2].list(s), chosen.search || s.embedding?.model),
    view(s) {
      const e = s.embedding, m = this.current(s);
      if (!e) return starting(s, m);
      if (['loading', 'busy'].includes(e.status)) return { tone: 'working', word: e.status === 'busy' ? 'Busy' : 'Waking up', model: m };
      if (e.status === 'ready' && e.model === m.id) return { tone: 'ready', word: 'Ready', model: m, extra: [['moon', 'Sleep', () => c().unloadEmbedding(), busy(s)]] };
      if (!m.installed) return { tone: 'attention', word: 'Needs download', model: m,
        main: [`Get it · ${formatSize(m.bytes)}`, 'download', () => steps(() => c().install(m.id), () => c().loadEmbedding(m.id))] };
      return { tone: e.status === 'failed' ? 'problem' : 'asleep', word: e.status === 'failed' ? 'Problem' : 'Asleep', model: m,
        main: [e.status === 'failed' ? 'Try again' : 'Wake up', 'power', () => c().loadEmbedding(m.id)] };
    },
    actions(m, s) {
      if (s.embedding?.status === 'ready' && s.embedding.model === m.id) return [['In use']];
      if (m.installed) return [['Use', 'check', () => { chosen.search = m.id; return c().loadEmbedding(m.id); }]];
      return [['Download', 'download', () => { chosen.search = m.id; return c().install(m.id); }]];
    },
    note: 'Phones send small batches of text and keep the results. Nothing is kept on this Mac. Changing the model makes phones rebuild their search.',
  },
  {
    key: 'backgrounds', name: 'Backgrounds', icon: 'picture', accent: '#AA8146', line: 'Paints note backgrounds.',
    list: (s) => models(s).filter((m) => m.capability === 'image'),
    current: (s) => pick(SKILLS[3].list(s), chosen.backgrounds || s.image?.model),
    view(s) {
      const img = s.image, m = this.current(s);
      if (!img) return starting(s, m);
      const installed = (id) => img.installed?.includes(id);
      if (img.status === 'busy') return { tone: 'working', word: 'Painting', model: m };
      if (img.status === 'incompatible') return { tone: 'problem', word: 'Not on this Mac', model: m };
      if (img.status === 'insufficient_memory') return { tone: 'problem', word: 'Too big', model: m, detail: img.reason };
      if (!installed(m.id)) return { tone: 'attention', word: 'Needs download', model: m,
        main: [`Get it · ${formatSize(m.bytes)}`, 'download', () => steps(() => c().install(m.id), () => c().assignImage(m.id))] };
      if (img.model !== m.id || img.status === 'unassigned') return { tone: 'asleep', word: 'Not in use', model: m, main: ['Use it', 'check', () => c().assignImage(m.id)] };
      if (img.status === 'ready') return { tone: 'ready', word: 'Ready', model: m, extra: [['play', 'Test again', () => c().testImage(), busy(s)]] };
      return { tone: img.status === 'failed' ? 'problem' : 'attention', word: img.status === 'failed' ? 'Test failed' : 'Needs a test', model: m,
        main: ['Test it · about 1 min', 'play', () => c().testImage()] };
    },
    actions(m, s) {
      if (s.image?.model === m.id && s.image.installed?.includes(m.id)) return [['In use']];
      if (s.image?.installed?.includes(m.id)) return [['Use', 'check', () => { chosen.backgrounds = m.id; return c().assignImage(m.id); }]];
      return [['Download', 'download', () => { chosen.backgrounds = m.id; return c().install(m.id); }]];
    },
    note: 'Each picture loads the model (about 10 s), paints (about 40 s) and unloads it. Results stay encrypted until the phone collects them, or 24 hours.',
  },
  {
    key: 'seeing', name: 'Seeing', icon: 'eye', accent: '#517E71', line: 'Reads photos and scanned pages.',
    list: (s) => models(s).filter((m) => m.capability === 'vision' || m.capability === 'ocr'),
    current: (s) => models(s).find((m) => m.capability === 'vision'),
    view(s) {
      const v = s.vision, m = this.current(s);
      if (!v || !m) return starting(s, m);
      const ocr = models(s).find((x) => x.capability === 'ocr');
      const extra = ocr && !ocr.installed ? [['scan', 'Add page checking', () => c().install(ocr.id), anyDownload(s)]] : [];
      if (v.status === 'busy') return { tone: 'working', word: 'Looking', model: m };
      if (v.status === 'incompatible') return { tone: 'problem', word: 'Not on this Mac', model: m };
      if (v.status === 'needs_download') return { tone: 'attention', word: 'Needs download', model: m,
        main: [`Get it · ${formatSize(m.bytes)}`, 'download', () => steps(() => c().install(m.id), () => c().testVision())] };
      if (v.status === 'ready') return { tone: 'ready', word: 'Ready', model: m, extra };
      return { tone: v.status === 'failed' ? 'problem' : 'attention', word: v.status === 'failed' ? 'Test failed' : 'Needs a test', model: m,
        main: ['Test it', 'play', () => c().testVision()], extra };
    },
    actions(m) {
      if (m.installed) return [['Downloaded']];
      return [['Download', 'download', () => c().install(m.id)]];
    },
    note: 'A quick test shows the model a red square and turns this on only if it answers “red”. Page checking adds a second reader that flags words it reads differently.',
  },
  {
    key: 'websites', name: 'Websites', icon: 'globe', accent: '#A46D63', line: 'Builds pages from your notes.',
    list: (s) => models(s).filter((m) => m.capability === 'text' && m.collection === 'Coding'),
    current: (s) => pick(SKILLS[5].list(s), lib(s).coding),
    view(s) {
      const l = lib(s), m = this.current(s);
      const using = l.codingReady && models(s).find((x) => x.id === l.coding);
      if (using) return { tone: 'ready', word: 'Ready', model: using, extra: [['back', 'Use writing brain', () => c().assignCoding(''), busy(s)]] };
      if (!m) return { tone: 'asleep', word: 'Uses writing', model: m };
      if (!m.installed) return { tone: 'asleep', word: 'Uses writing', model: m, optional: true,
        main: [`Get it · ${formatSize(m.bytes)}`, 'download', () => installCoding(m, s)] };
      return { tone: 'asleep', word: 'Uses writing', model: m, optional: true, main: ['Use it', 'check', () => c().assignCoding(m.id)] };
    },
    actions(m, s) {
      if (lib(s).codingReady && lib(s).coding === m.id) return [['In use']];
      if (m.installed) return [['Use', 'check', () => c().assignCoding(m.id)]];
      return [['Download', 'download', () => installCoding(m, s)]];
    },
    note: 'Without its own model, websites use the writing brain. With one, each page swaps brains for a few seconds.',
  },
];

/* ── Writing playground (keeps the ids the D01 verification drives) ───────── */
const IDEAS = ['Three gentle prompts for a busy evening', 'A kind note to my future self', 'One question to start my diary'];
function playground() {
  const prompt = h('textarea', { id: 'prompt', maxlength: '1800', 'aria-label': 'Ask the writing brain' });
  const generate = h('button', { id: 'generate', type: 'submit', class: 'round-btn yes', 'aria-label': 'Write', disabled: true }, icon('arrow'));
  const form = h('form', { id: 'prompt-form', class: 'play-form' }, prompt, generate);
  const response = h('div', { id: 'response', class: 'response empty', 'aria-live': 'polite' });
  const clear = h('button', { id: 'clear', class: 'link-btn', type: 'button' }, icon('refresh'), h('span', { text: 'Clear' }));
  const ideas = h('div', { class: 'ideas' }, IDEAS.map((idea) => h('button', { type: 'button', class: 'idea hand', text: idea, onclick: () => { prompt.value = idea; prompt.focus(); } })));
  let pending = false;
  clear.onclick = () => { prompt.value = ''; response.textContent = ''; response.classList.add('empty'); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (store.state?.status !== 'ready' || pending) return;
    const text = prompt.value;
    if (!text.trim() || new TextEncoder().encode(text).length > 2000) { toast('Write a short request first.', 'pen'); return; }
    pending = true; generate.disabled = true;
    response.textContent = ''; response.classList.remove('empty');
    const result = await act(() => c().generate(text));
    if (result?.ok && !response.textContent) response.textContent = result.text || 'Nothing came back. Try another request.';
    pending = false; publish();
  };
  window.companion.onToken((token) => { response.classList.remove('empty'); response.textContent += token; });
  const el = h('div', { class: 'playground', hidden: true }, ideas, form, h('div', { class: 'response-wrap' }, response, clear));
  return { el, render(state) { generate.disabled = state.status !== 'ready' || pending; prompt.disabled = state.status === 'working'; clear.disabled = state.status === 'working'; } };
}

/* ── Drawer of alternative models ─────────────────────────────────────────── */
function drawer() {
  const title = h('h2', { class: 'drawer-title' });
  const body = h('div', { class: 'drawer-body' });
  const foot = h('div', { class: 'drawer-foot' });
  const scrim = h('div', { class: 'scrim' });
  const el = h('aside', { class: 'drawer', 'aria-hidden': 'true' },
    h('header', { class: 'drawer-head' }, title, h('button', { class: 'round-btn', 'aria-label': 'Close', onclick: () => close() }, icon('cross'))), body, foot);
  let skill = null, sig = '';
  function close() { el.classList.remove('open'); scrim.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); skill = null; }
  scrim.onclick = close;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && skill) close(); });

  function modelCard(m, state) {
    const fits = !state.memoryGB || m.memoryGB <= state.memoryGB;
    const transfer = lib(state).download;
    const mine = (transfer?.model === m.id && transfer.status === 'downloading') || (skill.key === 'writing' && textDownloading(state) && state.model?.id === m.id);
    const pct = mine ? (transfer?.model === m.id ? transfer.progress : state.progress) : null;
    const actions = skill.actions(m, state).map(([label, iconName, run, kind]) => {
      if (!run) return h('span', { class: 'stamp', text: label });
      const button = kind === 'soft' ? softBtn(iconName, label) : pill(label, null, { small: true, arrow: iconName });
      button.disabled = anyDownload(state) || unsupported(state) || (skill.key === 'writing' && busy(state));
      button.onclick = async () => { await act(run); await refresh(); };
      return button;
    });
    return h('article', { class: `model-card paper${m.recommended ? ' recommended' : ''}` },
      m.recommended && h('span', { class: 'washi', text: 'Our pick' }),
      h('div', { class: 'model-top' }, h('strong', { text: m.name }), m.tier && h('span', { class: 'model-tier', text: m.tier })),
      h('p', { class: 'model-desc', text: m.description || '' }),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, icon('download'), h('span', { text: formatSize(m.bytes) })),
        h('span', { class: `chip ${fits ? 'good' : 'warn'}` }, icon(fits ? 'check' : 'alert'), h('span', { text: `${m.memoryGB} GB memory` })),
        m.installed && h('span', { class: 'chip good' }, icon('check'), h('span', { text: 'On this Mac' })),
        h('button', { class: 'chip chip-link', title: m.license, onclick: () => act(() => c().catalog(m.id)) }, icon('external'), h('span', { text: m.license }))),
      pct !== null && pct !== undefined ? h('div', { class: 'model-progress' },
        h('div', { class: 'bar' }, h('span', { vars: { '--p': String(pct || 0) } })), h('span', { text: `${Math.round((pct || 0) * 100)}%` })) : null,
      h('div', { class: 'model-actions' }, actions));
  }

  function render(state) {
    if (!skill) return;
    const list = skill.list(state);
    const next = JSON.stringify([skill.key, list.map((m) => [m.id, m.installed, m.loaded]), lib(state).download, state.progress, state.status, state.speech?.status, state.speech?.model, state.embedding?.status, state.embedding?.model, state.image?.model, state.image?.installed, lib(state).coding, lib(state).codingReady]);
    if (next === sig) return;
    sig = next;
    const groups = skill.groups || [[null, null]];
    body.replaceChildren(...groups.map(([collection, label]) => {
      const items = list.filter((m) => !collection || m.collection === collection).sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
      return items.length && h('section', { class: 'drawer-group' }, label && h('p', { class: 'eyebrow', text: label }), items.map((m) => modelCard(m, state)));
    }).filter(Boolean));
    const cancel = softBtn('cross', 'Stop download', async () => { await act(() => c().cancelDownload()); await refresh(); });
    cancel.hidden = !anyDownload(state);
    const parts = [cancel];
    if (skill.key === 'writing') {
      const remove = softBtn('trash', 'Remove sleeping brain', async () => {
        if (await confirmAsk({ art: 'trash', title: 'Remove this brain?', body: `${lib(state).model.name} will be deleted from this Mac. Files you chose yourself are never deleted.`, yes: 'Remove' })) {
          await act(() => c().remove()); await refresh();
        }
      }, 'danger');
      remove.disabled = !lib(state).model?.owned || lib(state).model?.loaded || busy(state);
      parts.push(remove);
    }
    foot.replaceChildren(...parts);
  }

  return {
    el: [scrim, el],
    open(next) { skill = next; sig = ''; title.textContent = next.name; el.style.setProperty('--accent', next.accent); render(store.state); el.classList.add('open'); scrim.classList.add('open'); el.setAttribute('aria-hidden', 'false'); },
    render,
  };
}

/* ── Skill cards ──────────────────────────────────────────────────────────── */
function skillCard(skill, openDrawer, play) {
  const status = statusEl();
  const progress = h('div', { class: 'ring', vars: { '--size': '92px', '--c': skill.accent } }, h('span', { class: 'ring-art' }, icon(skill.icon)));
  const modelName = h('span', { class: 'skill-model' });
  const detail = h('p', { class: 'skill-detail' });
  const main = pill('', null, { small: true });
  const extras = h('div', { class: 'skill-extras' });
  const tryIt = skill.key === 'writing' ? softBtn('sparkle', 'Try it') : null;
  if (tryIt) tryIt.onclick = () => { play.el.hidden = !play.el.hidden; tryIt.classList.toggle('on', !play.el.hidden); if (!play.el.hidden) document.getElementById('prompt').focus(); };
  const el = h('article', { class: `skill paper skill-${skill.key}`, vars: { '--accent': skill.accent } },
    h('span', { class: 'washi', text: skill.name }),
    h('div', { class: 'skill-top' }, progress, h('div', { class: 'skill-head' }, status, h('p', { class: 'skill-line', text: skill.line }), modelName)),
    detail,
    h('div', { class: 'skill-actions' }, main, tryIt, extras,
      h('span', { class: 'skill-more' },
        skill.note && info(skill.note),
        h('button', { class: 'link-btn', onclick: () => openDrawer(skill) }, icon('layers'), h('span', { text: 'Choose another' })))),
    play ? play.el : null);
  let run = null;
  main.onclick = async () => { if (!run) return; main.disabled = true; await act(run); await refresh(); };

  return {
    el,
    render(state) {
      if (!models(state).length) return;
      const v = skill.view(state);
      setStatus(status, v.tone, v.word);
      el.dataset.tone = v.tone;
      modelName.textContent = v.model ? v.model.name : '';
      const transfer = lib(state).download;
      const mine = transfer?.status === 'downloading' && skill.list(state).some((m) => m.id === transfer.model) || (transfer?.status === 'downloading' && skill.key === 'listening' && transfer.model === vadOf(state)?.id);
      const pct = v.progress ?? (mine ? transfer.progress : null);
      const working = v.tone === 'working' || mine;
      progress.classList.toggle('indeterminate', working && (pct === null || pct === undefined));
      progress.style.setProperty('--p', String(pct ?? (v.tone === 'ready' ? 1 : 0)));
      if (mine && v.tone !== 'working') setStatus(status, 'working', 'Downloading');
      detail.textContent = v.detail || (transfer?.status === 'failed' && skill.list(state).some((m) => m.id === transfer.model) ? transfer.error || '' : '');
      detail.hidden = !detail.textContent;
      run = v.main?.[2] || null;
      main.hidden = !v.main || mine;
      if (v.main) { setPill(main, v.main[0], v.main[1]); main.disabled = (v.main[1] === 'download' ? anyDownload(state) : busy(state)) || unsupported(state); }
      extras.replaceChildren(...(v.extra || []).map(([iconName, label, action, disabled]) => {
        const b = softBtn(iconName, label, async () => { await act(action); await refresh(); });
        b.disabled = !!disabled; return b;
      }));
      if (tryIt) { tryIt.hidden = !v.play; if (!v.play) { play.el.hidden = true; tryIt.classList.remove('on'); } }
    },
  };
}

export function skillsView(root) {
  const d = drawer();
  const play = playground();
  const cards = SKILLS.map((skill) => skillCard(skill, d.open, skill.key === 'writing' ? play : null));
  // Hidden hook kept for scripts/verify (D01): downloads and loads the current writing model, as before.
  const legacyDownload = h('button', { id: 'download', hidden: true, onclick: () => act(() => c().download(store.state?.model?.id)) });
  const memory = h('span', { class: 'chip' });
  root.append(
    h('header', { class: 'view-head' },
      h('div', {}, h('p', { class: 'eyebrow', text: 'What this Mac can do' }), h('h1', { class: 'view-title', text: 'Skills' })),
      h('div', { class: 'head-tools' }, memory, info('Every download comes from its listed publisher, is checked against a pinned size and fingerprint, and stays on this Mac.', 'Brains run here only. Your words never go to the internet.'))),
    h('div', { class: 'skills-grid' }, cards.map((card) => card.el)),
    legacyDownload, ...d.el);
  subscribe((state) => {
    memory.replaceChildren(icon('mac'), h('span', { text: state.memoryGB ? `${state.memoryGB} GB memory` : 'This Mac' }));
    for (const card of cards) card.render(state);
    play.render(state);
    d.render(state);
  });
}

export { SKILLS };
