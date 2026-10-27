const $ = (id) => document.getElementById(id);
let state;
let requestPending = false;
const labels = { unavailable: ['AI unavailable', 'SETUP NEEDED'], loading: ['Getting things ready', 'LOADING'], ready: ['Your companion is ready', 'READY'], working: ['A thought is taking shape', 'WORKING'], failed: ['AI needs attention', 'FAILED'] };
function render(next) {
  state = next;
  const [title, pill] = labels[state.status];
  $('status-title').textContent = title; $('status-pill').textContent = pill;
  $('status-detail').textContent = state.detail;
  document.querySelector('.status-card').classList.toggle('failed', state.status === 'failed');
  $('status-error').hidden = !state.error; $('status-error').textContent = state.error?.code || '';
  $('download-progress').hidden = state.progress === null;
  $('download-progress').value = state.progress || 0;
  const busy = ['loading', 'working'].includes(state.status) || requestPending;
  const unsupported = state.error?.code === 'UNSUPPORTED_HOST';
  $('generate').disabled = state.status !== 'ready' || requestPending;
  $('prompt').disabled = state.status === 'working';
  for (const id of ['choose', 'download']) $(id).disabled = busy || unsupported;
  $('download').textContent = state.selected ? 'Download a fresh copy ↓' : 'Download model ↓';
  $('load').hidden = !state.selected || ['ready', 'working', 'loading'].includes(state.status);
  $('load').disabled = busy || unsupported;
  $('unload').hidden = state.status !== 'ready'; $('unload').disabled = busy;
  $('clear').disabled = state.status === 'working';
  $('model-installed').hidden = !state.selected;
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
for (const id of ['choose', 'download', 'load', 'unload']) $(id).addEventListener('click', () => act(() => window.companion[id]()));
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
