const $ = (id) => document.getElementById(id);
let state;
let requestPending = false;
let pairingExpires = 0;
let selectedModelId;
let selectedSpeechModelId;
let selectedEmbeddingModelId;
// Download-only capabilities and the future feature each one is kept for.
const futureUse = { embedding: 'search by meaning', image: 'image generation', transcription: 'speech-to-text', speech: 'read-aloud', vision: 'note image questions', ocr: 'scan checking' };
const labels = { unavailable: ['AI unavailable', 'SETUP NEEDED'], loading: ['Getting things ready', 'LOADING'], ready: ['Your companion is ready', 'READY'], working: ['A thought is taking shape', 'WORKING'], failed: ['AI needs attention', 'FAILED'] };
function render(next) {
  state = next;
  const [title, pill] = labels[state.status];
  $('status-title').textContent = title; $('status-pill').textContent = pill;
  $('status-detail').textContent = state.detail;
  document.querySelector('.status-card').classList.toggle('failed', state.status === 'failed');
  $('status-error').hidden = !state.error; $('status-error').textContent = state.error?.code || '';
  const transfer = state.library?.download;
  const downloading = transfer?.status === 'downloading';
  $('download-progress').hidden = !downloading && state.progress === null;
  $('download-progress').value = downloading ? transfer.progress : state.progress || 0;
  const busy = ['loading', 'working'].includes(state.status) || requestPending || state.activity?.some((job) => ['queued', 'running'].includes(job.state));
  const unsupported = state.error?.code === 'UNSUPPORTED_HOST';
  $('generate').disabled = state.status !== 'ready' || requestPending;
  $('prompt').disabled = state.status === 'working';
  renderModels(busy || unsupported, downloading, unsupported);
  $('load').hidden = !state.selected || ['ready', 'working', 'loading'].includes(state.status);
  $('load').disabled = busy || unsupported;
  $('unload').hidden = state.status !== 'ready'; $('unload').disabled = busy;
  $('clear').disabled = state.status === 'working';
  $('speech-state').textContent = state.speech ? `${state.speech.status} · ${state.speech.reason}` : 'Speech unavailable';
  $('vision-state').textContent = state.vision ? `${state.vision.status} · ${state.vision.reason}${state.vision.ocrCheck ? ' · Scan check: EasyOCR installed.' : ' · Scan check: not installed.'}` : 'Image input needs secure storage.';
  $('test-vision').disabled = !state.vision || ['needs_download', 'incompatible', 'busy'].includes(state.vision.status) || busy;
  renderImage(busy);
  renderCoding(busy);
  const speechModels = (state.library?.models || []).filter((m) => m.engine === 'whispercpp-transcription' && !m.filename.includes('silero') && !m.filename.includes('.en-'));
  if (!speechModels.some((m) => m.id === selectedSpeechModelId)) selectedSpeechModelId = state.speech?.model || speechModels[0]?.id;
  const speechPicker = $('speech-model-select');
  const speechCatalog = JSON.stringify(speechModels.map(({ id, installed }) => ({ id, installed })));
  if (speechPicker.dataset.catalog !== speechCatalog) {
    speechPicker.replaceChildren(...speechModels.map((m) => { const option = document.createElement('option'); option.value = m.id; option.textContent = `${m.name}${m.installed ? ' · Downloaded' : ' · Needs download'}`; return option; }));
    speechPicker.dataset.catalog = speechCatalog;
  }
  speechPicker.value = selectedSpeechModelId;
  speechPicker.disabled = ['loading', 'busy'].includes(state.speech?.status);
  const selectedSpeech = speechModels.find((m) => m.id === selectedSpeechModelId);
  const vadInstalled = state.library?.models.some((m) => m.filename === 'ggml-silero-v5.1.2.bin' && m.installed);
  $('load-speech').disabled = !selectedSpeech?.installed || !vadInstalled || ['loading', 'busy'].includes(state.speech?.status) || state.status === 'working';
  if (!selectedSpeech?.installed || !vadInstalled) $('speech-state').textContent += ' · Download the selected Whisper model and Silero VAD first.';
  renderEmbedding(busy);
  renderConnections();
}
function renderEmbedding(busy) {
  const embedding = state.embedding;
  $('embedding-state').textContent = embedding ? `${embedding.status} · ${embedding.reason}` : 'Embeddings unavailable';
  const models = (state.library?.models || []).filter((m) => m.capability === 'embedding');
  if (!models.some((m) => m.id === selectedEmbeddingModelId)) selectedEmbeddingModelId = embedding?.model || models[0]?.id;
  const picker = $('embedding-model-select');
  const catalog = JSON.stringify(models.map(({ id, installed }) => ({ id, installed })));
  if (picker.dataset.catalog !== catalog) {
    picker.replaceChildren(...models.map((m) => { const option = document.createElement('option'); option.value = m.id; option.textContent = `${m.name}${m.installed ? ' · Downloaded' : ' · Needs download'}`; return option; }));
    picker.dataset.catalog = catalog;
  }
  picker.value = selectedEmbeddingModelId;
  const working = ['loading', 'busy'].includes(embedding?.status);
  picker.disabled = working;
  const selected = models.find((m) => m.id === selectedEmbeddingModelId);
  $('load-embedding').disabled = !selected?.installed || working || (embedding?.status === 'ready' && embedding.model === selectedEmbeddingModelId);
  $('unload-embedding').hidden = embedding?.status !== 'ready'; $('unload-embedding').disabled = working || busy;
  if (!selected?.installed) $('embedding-state').textContent += ' · Download the selected embedding model first.';
}
function renderModels(disabled, downloading, unsupported) {
  const models = state.library?.models || [];
  if (!models.length) return;
  if (!models.some((model) => model.id === selectedModelId)) selectedModelId = state.model.id;
  const picker = $('model-select');
  const catalog = JSON.stringify(models.map(({ id, installed, loaded }) => ({ id, installed, loaded })));
  if (picker.dataset.catalog !== catalog) {
    picker.replaceChildren(...[
      ['Popular', 'Writing · popular choices'], ['New', 'Writing · newer & interesting'], ['Coding', 'Writing · coding & HTML'],
      ['Lightweight', 'Writing · lightweight'], ['transcription', 'Speech to text · Whisper available'],
      ['embedding', 'Search by meaning · load below'], ['speech', 'Text to speech · download only'], ['image', 'Image generation · download only'], ['vision', 'Image understanding · after self-test'], ['ocr', 'Scan checking · optional'],
    ].map(([collection, label]) => {
      const group = document.createElement('optgroup'); group.label = label;
      for (const model of models.filter((entry) => Object.hasOwn(futureUse, collection) ? entry.capability === collection : entry.capability === 'text' && entry.collection === collection)) {
        const option = document.createElement('option'); option.value = model.id;
        option.textContent = `${model.name}${model.loaded ? ' · Active' : model.installed ? ' · Downloaded' : ''}`;
        group.append(option);
      }
      return group;
    }));
    picker.dataset.catalog = catalog;
  }
  picker.value = selectedModelId; picker.disabled = downloading || state.status === 'loading' || unsupported;
  const model = models.find((entry) => entry.id === selectedModelId);
  const image = model.capability !== 'text', future = futureUse[model.capability];
  const files = model.parts?.length > 1 ? ` · ${model.parts.length} files` : '';
  const size = model.bytes >= 1e9 ? `${(model.bytes / 1e9).toFixed(2)} GB` : `${Math.round(model.bytes / 1e6)} MB`;
  $('model-name').textContent = model.name;
  $('model-meta').textContent = `${model.quantization} · ${size} download${files} · ${model.license}`;
  $('model-description').textContent = model.description;
  $('model-guidance').textContent = `${model.tier} · ${model.memoryGB} GB+ system memory suggested. ${image ? `${model.engine === 'whispercpp-transcription' ? 'Whisper and Silero VAD enable Android voice capture.' : model.capability === 'vision' ? 'Downloads the model and its image projector; run the image self-test before phones can ask about note images or scan pages.' : model.capability === 'ocr' ? 'Optional second reader for scanned pages: words it reads differently are flagged on the phone for checking.' : model.capability === 'embedding' ? 'After downloading, load it under Search by meaning so opted-in phones can find entries by meaning.' : `Download weights now; ${future} will be added later.`}${model.source === 'registry' ? ' Downloads from peers in the QVAC model registry.' : ''}` : model.fitHint || 'Speed depends on your Mac.'}`;
  $('download').textContent = model.installed ? 'Download a fresh copy ↓' : `${image ? 'Download' : 'Download & use'} · ${size} ↓`;
  $('use-model').hidden = !model.installed || image;
  $('use-model').textContent = model.loaded ? 'Currently loaded' : 'Use downloaded model';
  for (const id of ['choose', 'download', 'use-model']) $(id).disabled = downloading || (image ? unsupported || state.progress !== null : disabled) || (id === 'use-model' && model.loaded);
  $('choose').hidden = image;
  $('install').textContent = image ? 'Download selected model' : 'Download selected without loading';
  $('model-installed').hidden = !model.installed;
  $('model-installed').textContent = model.loaded ? '✓ Active writing model · runs locally' : model.capability === 'embedding' ? '✓ Downloaded · load it under Search by meaning' : image ? `✓ Downloaded · kept for future ${future}` : '✓ Downloaded · ready to load';
  const transfer = state.library.download;
  $('model-download-status').hidden = transfer?.model !== model.id;
  $('model-download-status').textContent = transfer?.status === 'downloading' ? `Downloading · ${Math.round(transfer.progress * 100)}%. Writing remains available.` : transfer?.error || (transfer?.status === 'installed' ? 'Download verified. Your active writing model is unchanged.' : '');
}
async function act(callback) {
  $('action-error').hidden = true;
  try {
    const result = await callback();
    if (result?.ok === false) { $('action-error').textContent = result.error.message; $('action-error').hidden = false; }
    return result;
  } catch { $('action-error').textContent = 'The companion could not respond. Quit and reopen the app.'; $('action-error').hidden = false; }
}
window.companion.onState(render);
window.companion.onToken((token) => { $('response').classList.remove('empty'); $('response').textContent += token; });
window.companion.state().then(render);
for (const id of ['load', 'unload']) $(id).addEventListener('click', () => act(() => window.companion[id]()));
for (const id of ['choose', 'download']) $(id).addEventListener('click', () => act(() => window.companion[id](selectedModelId)));
$('model-select').addEventListener('change', (event) => { selectedModelId = event.target.value; render(state); });
$('use-model').addEventListener('click', () => act(() => window.companion.load(selectedModelId)));
$('clear').addEventListener('click', () => {
  $('prompt').value = ''; $('response').textContent = 'A fresh perspective will appear here.'; $('response').classList.add('empty'); $('action-error').hidden = true;
});
$('prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.status !== 'ready' || requestPending) return;
  const prompt = $('prompt').value;
  if (!prompt.trim() || new TextEncoder().encode(prompt).length > 2000) {
    $('action-error').textContent = 'Enter a short request of up to 2,000 UTF-8 bytes.'; $('action-error').hidden = false; return;
  }
  requestPending = true; render(state);
  $('response').textContent = ''; $('response').classList.remove('empty');
  const result = await act(() => window.companion.generate(prompt));
  if (result?.ok && !$('response').textContent) $('response').textContent = result.text || 'The model returned no text. Try a different short request.';
  requestPending = false; render(state);
});

function renderCoding(busy) {
  const library = state.library, picker = $('coding-model-select');
  const models = (library?.models || []).filter((m) => m.capability === 'text' && m.collection === 'Coding' && m.installed);
  const catalog = JSON.stringify(models.map((m) => m.id));
  if (picker.dataset.catalog !== catalog) {
    const same = document.createElement('option'); same.value = ''; same.textContent = 'Same as the writing model';
    picker.replaceChildren(same, ...models.map((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.name} · ${m.memoryGB} GB+`; return o; }));
    picker.dataset.catalog = catalog;
  }
  if (document.activeElement !== picker) picker.value = library?.codingReady ? library.coding : '';
  const chosen = library?.codingReady && models.find((m) => m.id === library.coding);
  $('coding-state').textContent = chosen ? `Websites use ${chosen.name}.`
    : library?.coding ? 'The chosen coding model is not downloaded. Websites use the writing model.'
    : models.length ? 'Websites use the writing model.' : 'Websites use the writing model. Download a coding model above for better pages.';
  $('assign-coding').disabled = busy || picker.value === (library?.codingReady ? library.coding : '');
}
$('coding-model-select').addEventListener('change', () => render(state));
$('assign-coding').addEventListener('click', () => act(() => window.companion.assignCoding($('coding-model-select').value)));
function renderImage(busy) {
  const image = state.image, picker = $('image-model-select');
  $('image-state').textContent = image ? `${image.status} · ${image.reason}` : 'Image generation needs secure storage.';
  const models = (state.library?.models || []).filter((m) => m.capability === 'image' && image?.installed?.includes(m.id));
  const catalog = JSON.stringify(models.map((m) => m.id));
  if (picker.dataset.catalog !== catalog) {
    picker.replaceChildren(...models.map((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.name} · ${m.memoryGB} GB+`; return o; }));
    picker.dataset.catalog = catalog;
  }
  if (image?.model && models.some((m) => m.id === image.model) && document.activeElement !== picker) picker.value = image.model;
  $('assign-image').disabled = !models.length || busy || image?.status === 'busy';
  $('test-image').disabled = !image || !['untested', 'ready', 'failed'].includes(image.status) || busy;
}
$('assign-image').addEventListener('click', () => act(() => window.companion.assignImage($('image-model-select').value)));
$('test-image').addEventListener('click', () => act(() => window.companion.testImage()));
function button(label, action) {
  const node = document.createElement('button'); node.className = 'secondary'; node.textContent = label; node.onclick = () => act(action); return node;
}
function renderConnections() {
  const library = state.library, devices = state.devices;
  $('library-state').textContent = library ? `${library.model.name} · ${library.model.installed ? 'Verified installed artifact' : 'No verified installed selection'} · ${library.model.partialBytes ? `${library.model.partialBytes} partial bytes · ` : ''}Writing: ${library.text.status}. ${library.model.fit}. ${library.model.guidance}` : 'Checking artifacts…';
  for (const id of ['install', 'remove', 'assign']) $(id).disabled = ['loading', 'working'].includes(state.status) || requestPending || state.error?.code === 'UNSUPPORTED_HOST' || state.activity?.some((j) => ['queued', 'running'].includes(j.state));
  const image = (library?.models.find((model) => model.id === selectedModelId)?.capability ?? 'text') !== 'text';
  const downloading = library?.download?.status === 'downloading';
  if (image) $('install').disabled = downloading || state.error?.code === 'UNSUPPORTED_HOST' || state.progress !== null;
  else $('install').disabled ||= downloading;
  $('remove').disabled ||= !library?.model.owned || library?.model.loaded;
  $('assign').disabled ||= !library?.model.installed;
  $('cancel-download').hidden = !downloading && state.progress === null;
  $('device-service').textContent = state.serviceError || devices?.error || (devices?.enabled ? `Listening on the local network, port ${devices.port}` : 'Phone connections are stopped. Create a QR to start.');
  $('identity').textContent = devices?.fingerprint ? `This computer’s identity: ${devices.fingerprint.match(/.{1,4}/g).join(' ')}` : '';
  $('pair').disabled = !devices; $('disable-service').disabled = !devices?.enabled;
  if (pairingExpires && (Date.now() >= pairingExpires || devices?.pending?.length || !devices?.enabled)) {
    $('pairing').hidden = true; $('pair-code').value = ''; $('pair-qr').removeAttribute('src'); pairingExpires = 0;
  }
  $('pending-devices').replaceChildren();
  for (const p of devices?.pending || []) {
    const row = document.createElement('p'); row.textContent = `${p.name} · Compare on phone: ${p.verification} `;
    row.append(button('Approve', () => window.companion.approve(p.ticket, true)), button('Deny', () => window.companion.approve(p.ticket, false))); $('pending-devices').append(row);
  }
  $('trusted-devices').replaceChildren();
  for (const d of devices?.devices || []) {
    const row = document.createElement('p'); row.textContent = `${d.name} · ${d.connected ? 'Connected recently' : 'Trusted / disconnected'} `;
    row.append(button('Revoke & delete work', () => window.companion.revoke(d.id))); $('trusted-devices').append(row);
  }
  $('activity').replaceChildren();
  for (const job of state.activity || []) {
    const row = document.createElement('p'); row.textContent = `${job.deviceName} · ${({ 'summarize-note': 'Summarize note', 'rewrite-note': 'Rewrite note', 'expand-note': 'Expand note', 'tone-note': 'Adjust tone', 'clarify-note': 'Grammar / clarity', 'markdown-note': 'Format Markdown', 'present-text': 'Style presentation', 'suggest-diary-day': 'Suggest diary details', 'reflect-thought': 'Reflect on thought', 'suggest-note-metadata': 'Suggest title & tags', 'suggest-note-ideas': 'Suggest starting ideas', 'ask-note-image': 'Ask about an image', 'scan-note-image': 'Scan a page', 'generate-note-background': 'Generate background' })[job.operation] || job.operation} · ${job.model} · ${job.state} · ${Math.max(0, Math.round(((job.finished || Date.now()) - job.created) / 1000))} s `;
    if (['queued', 'running'].includes(job.state)) row.append(button('Cancel', () => window.companion.cancelJob(job.device, job.id)));
    $('activity').append(row);
  }
}
for (const [id, method] of [['cancel-download', 'cancelDownload'], ['remove', 'remove'], ['disable-service', 'disableService']]) {
  $(id).onclick = async () => { await act(() => window.companion[method]()); render(await window.companion.state()); };
}
for (const id of ['install', 'catalog']) $(id).onclick = () => act(() => window.companion[id](selectedModelId));
$('assign').onclick = () => act(() => window.companion.assign(state.library.model.id));
$('pair').onclick = async () => {
  const result = await act(() => window.companion.pair());
  if (result?.ok) { pairingExpires = result.expires; $('pairing').hidden = false; $('pair-code').value = result.code; $('pair-qr').src = result.qr; $('pair-expiry').textContent = `Expires ${new Date(result.expires).toLocaleTimeString()}. Keep this code private.`; }
};
setInterval(() => window.companion.state().then(render), 5000);

$('speech-model-select').addEventListener('change', (event) => { selectedSpeechModelId = event.target.value; render(state); });
$('test-vision').addEventListener('click', () => act(() => window.companion.testVision()));
$('load-speech').addEventListener('click', () => act(() => window.companion.loadSpeech(selectedSpeechModelId)));
$('embedding-model-select').addEventListener('change', (event) => { selectedEmbeddingModelId = event.target.value; render(state); });
$('load-embedding').addEventListener('click', () => act(() => window.companion.loadEmbedding(selectedEmbeddingModelId)));
$('unload-embedding').addEventListener('click', () => act(() => window.companion.unloadEmbedding()));
