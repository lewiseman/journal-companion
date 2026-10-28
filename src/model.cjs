const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const additionalWritingModels = require('./writing-models.cjs');
const speechModels = require('./speech-models.cjs');
const visionModels = require('./vision-models.cjs');
const ocrModels = require('./ocr-models.cjs');
const embeddingModels = require('./embedding-models.cjs');

// Pinned publisher/converter repositories + LFS SHA-256 (see docs/MODELS.md).
const MODELS = Object.freeze([{
  id: 'qwen2.5-0.5b-q4_k_m@9217f5db79a29953eb74d5343926648285ec7e67',
  name: 'Qwen2.5 · 0.5B Instruct',
  tier: 'Lightweight',
  description: 'A quick starting point for short prompts and simple writing.',
  memoryGB: 4,
  repository: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  bytes: 491400032,
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
  revision: '9217f5db79a29953eb74d5343926648285ec7e67',
  license: 'Apache 2.0',
}, {
  id: 'qwen2.5-1.5b-q4_k_m@91cad51170dc346986eccefdc2dd33a9da36ead9',
  name: 'Qwen2.5 · 1.5B Instruct',
  tier: 'Balanced',
  description: 'More capacity for rewriting, summaries and everyday writing, with a modest download.',
  memoryGB: 8,
  repository: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
  filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  bytes: 1117320736,
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  revision: '91cad51170dc346986eccefdc2dd33a9da36ead9',
  license: 'Apache 2.0',
}, {
  id: 'qwen2.5-3b-q4_k_m@7dabda4d13d513e3e842b20f0d435c732f172cbe',
  name: 'Qwen2.5 · 3B Instruct',
  tier: 'More powerful',
  description: 'More capacity for involved writing. Uses more memory and may respond more slowly.',
  memoryGB: 8,
  repository: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
  filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
  bytes: 2104932768,
  sha256: '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d',
  revision: '7dabda4d13d513e3e842b20f0d435c732f172cbe',
  license: 'Qwen Research · non-commercial',
}, {
  id: 'gemma-3-1b-it-q4_k_m@f9c28bcd85737ffc5aef028638d3341d49869c27',
  name: 'Gemma 3 · 1B Instruct',
  tier: 'Compact writing',
  description: 'Google’s compact Gemma writing model, converted to GGUF by ggml-org. Text requests only.',
  memoryGB: 8,
  origin: 'Google / ggml-org / Hugging Face',
  repository: 'ggml-org/gemma-3-1b-it-GGUF',
  filename: 'gemma-3-1b-it-Q4_K_M.gguf',
  bytes: 806058240,
  sha256: '8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135',
  revision: 'f9c28bcd85737ffc5aef028638d3341d49869c27',
  license: 'Gemma Terms of Use',
}, {
  id: 'gemma-3-4b-it-q4_k_m@d0976223747697cb51e056d85c532013931fe52e',
  name: 'Gemma 3 · 4B Instruct',
  tier: 'Larger writing',
  description: 'A larger Gemma option for writing and summaries. This app uses its text capability; image input is not enabled.',
  memoryGB: 8,
  origin: 'Google / ggml-org / Hugging Face',
  repository: 'ggml-org/gemma-3-4b-it-GGUF',
  filename: 'gemma-3-4b-it-Q4_K_M.gguf',
  bytes: 2489757856,
  sha256: '882e8d2db44dc554fb0ea5077cb7e4bc49e7342a1f0da57901c0802ea21a0863',
  revision: 'd0976223747697cb51e056d85c532013931fe52e',
  license: 'Gemma Terms of Use',
}, ...additionalWritingModels, {
  recommended: true, id: 'sd-2.1-q8_0@ef8fa11863cc80ab078276f9a0bf81601e5ed904',
  name: 'Stable Diffusion · 2.1',
  capability: 'image', engine: 'sdcpp-generation', quantization: 'Q8_0',
  tier: 'Image generation',
  description: 'Image generation weights to download for future use. Includes its text encoder and VAE. Downloading keeps your writing model active.',
  memoryGB: 8,
  origin: 'Stability AI / GPUStack / Hugging Face',
  repository: 'gpustack/stable-diffusion-v2-1-GGUF',
  filename: 'stable-diffusion-v2-1-Q8_0.gguf',
  bytes: 2322705024,
  sha256: '7b73fa47b4d1401bdf3a0898827fac94bced6633bf64ef7fe55492b6115cc74b',
  revision: 'ef8fa11863cc80ab078276f9a0bf81601e5ed904',
  license: 'CreativeML Open RAIL++-M',
}, {
  id: 'sdxl-1.0-q4_0@f00927e80a399ecb0bcacca868131d5e9d4e77aa',
  name: 'Stable Diffusion XL · 1.0',
  capability: 'image', engine: 'sdcpp-generation', quantization: 'Q4_0',
  tier: 'Larger image model',
  description: 'A larger image generation model to download for future use. Downloading keeps your writing model active.',
  memoryGB: 16,
  origin: 'Stability AI / GPUStack / Hugging Face',
  repository: 'gpustack/stable-diffusion-xl-base-1.0-GGUF',
  filename: 'stable-diffusion-xl-base-1.0-Q4_0.gguf',
  bytes: 3940010720,
  sha256: '4ab9818c9b3428eca96834c51fe294885608480991463f55bd9be53c822567c3',
  revision: 'f00927e80a399ecb0bcacca868131d5e9d4e77aa',
  license: 'CreativeML Open RAIL++-M',
}, ...speechModels, ...visionModels, ...ocrModels, ...embeddingModels].map((model) => Object.freeze({ capability: 'text', collection: 'Lightweight', engine: 'llamacpp-completion', quantization: 'Q4_K_M', origin: 'Qwen / Hugging Face', ...model })));
const MODEL = MODELS[0];

class CompanionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function getModel(id = MODEL.id) {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) throw new CompanionError('INCOMPATIBLE_MODEL', 'Choose a model from the supported list.');
  return model;
}

// Bundled speech models list their files in `parts`; everything else is one file.
function artifactParts(model) {
  return model.parts ? model.parts.map((part) => ({ ...model, ...part, parts: undefined })) : [model];
}

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.ceil(bytes / 1e6)} MB`;
}

function downloadHeaders(url, token = process.env.HF_TOKEN) {
  // Hugging Face CDN redirects use signed URLs. Never forward the account token
  // to a CDN, subdomain, or other origin.
  return token && new URL(url).origin === 'https://huggingface.co'
    ? { Authorization: `Bearer ${token}` } : {};
}

async function verifyModel(file, onProgress = () => {}, model = MODEL) {
  let stat;
  try { stat = await fsp.stat(file); }
  catch { throw new CompanionError('MISSING_WEIGHTS', 'Model file is missing. Download it or select the original GGUF again.'); }
  if (!stat.isFile() || stat.size !== model.bytes) {
    throw new CompanionError('INVALID_WEIGHTS', `This is not the complete ${model.name} ${model.quantization} model. Select the matching GGUF or download a fresh copy.`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk); bytes += chunk.length; onProgress(bytes / model.bytes);
  }
  if (hash.digest('hex') !== model.sha256) {
    throw new CompanionError('INVALID_WEIGHTS', 'The model checksum does not match. Download a fresh copy; this file will not be loaded.');
  }
  return file;
}

async function downloadModel(directory, onProgress = () => {}, signal, { fetcher = fetch, statfs = fsp.statfs, model = MODEL } = {}) {
  if (model.parts) return downloadParts(directory, onProgress, signal, { fetcher, statfs, model });
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = await statfs(directory);
  const required = model.bytes + 100 * 1024 * 1024;
  if (disk.bavail * disk.bsize < required) {
    throw new CompanionError('DISK_FULL', `Free at least ${formatBytes(required)} of disk space, then try the download again.`);
  }
  const destination = path.join(directory, model.filename);
  const partial = destination + '.partial';
  // Single explicitly requested transfer. No discovery, peer downloads, or background retry.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let idle = setTimeout(abort, 120000);
  try {
    let url = `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}`;
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !(target.hostname === 'huggingface.co' || target.hostname.endsWith('.huggingface.co') || target.hostname.endsWith('.hf.co'))) {
        throw new CompanionError('DOWNLOAD_FAILED', 'The model host redirected outside its approved HTTPS hosts. Try again later or select a local copy.');
      }
      response = await fetcher(url, { redirect: 'manual', signal: controller.signal, headers: downloadHeaders(url) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) break;
        url = new URL(location, url).href;
      } else break;
    }
    if ([401, 403].includes(response?.status)) throw new CompanionError('MODEL_ACCESS', 'The model host requires access. Open the model details to review its terms and, if required, grant your Hugging Face account access and configure HF_TOKEN. You can also select a matching local GGUF.');
    if (!response?.ok || !response.body) throw new CompanionError('DOWNLOAD_FAILED', 'The model download could not start. Check internet access, then retry or select a local copy.');
    let received = 0;
    const meter = new Transform({ transform(chunk, _, callback) {
      clearTimeout(idle); idle = setTimeout(abort, 120000);
      received += chunk.length;
      if (received > model.bytes) return callback(new Error('Unexpected download size'));
      onProgress(received / model.bytes);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { mode: 0o600 }), { signal: controller.signal });
    await verifyModel(partial, () => {}, model);
    controller.signal.throwIfAborted();
    await fsp.rename(partial, destination);
    return destination;
  } catch (error) {
    await fsp.rm(partial, { force: true });
    if (error instanceof CompanionError) throw error;
    if (error.code === 'ENOSPC') throw new CompanionError('DISK_FULL', `The disk filled during the download. Free at least ${formatBytes(required)} and try again.`);
    throw new CompanionError('DOWNLOAD_FAILED', 'Download stopped or failed. Check internet access and disk space, then retry. Partial files are discarded.');
  } finally {
    clearTimeout(idle); signal?.removeEventListener('abort', abort);
  }
}

// A multi-file Hugging Face model: each pinned part is fetched and verified
// separately; already-verified parts are kept.
async function downloadParts(directory, onProgress, signal, { fetcher, statfs, model }) {
  let done = 0;
  for (const part of artifactParts(model)) {
    try { await verifyModel(path.join(directory, part.filename), () => {}, part); }
    catch { await downloadModel(directory, (p) => onProgress((done + p * part.bytes) / model.bytes), signal, { fetcher, statfs, model: part }); }
    done += part.bytes; onProgress(done / model.bytes);
  }
  return path.join(directory, artifactParts(model)[0].filename);
}

function openRegistry(storage) {
  const { QVACRegistryClient } = require('@qvac/registry-client');
  return new QVACRegistryClient({ storage, logger: { enabled: false } });
}

// QVAC registry artifacts arrive from Hyperswarm peers. Only the blob
// coordinates pinned in the catalog are fetched, and every file must match its
// pinned size and SHA-256 before it replaces a destination.
async function downloadRegistryModel(directory, onProgress = () => {}, signal, { statfs = fsp.statfs, model, registry = openRegistry } = {}) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const parts = artifactParts(model);
  // Peer blocks are cached until each file is written, so allow one extra copy of the largest file.
  const required = model.bytes + Math.max(...parts.map((part) => part.bytes)) + 100 * 1024 * 1024;
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < required) {
    throw new CompanionError('DISK_FULL', `Free at least ${formatBytes(required)} of disk space, then try the download again.`);
  }
  const storage = path.join(path.dirname(directory), 'registry-cache');
  let client, partial, done = 0;
  try {
    for (const part of parts) {
      const destination = path.join(directory, part.filename);
      try {
        await verifyModel(destination, () => {}, part);
        done += part.bytes; onProgress(done / model.bytes); continue;
      } catch {}
      signal?.throwIfAborted();
      if (!client) { await fsp.mkdir(storage, { recursive: true, mode: 0o700 }); client = registry(storage); }
      partial = destination + '.partial';
      await client.downloadBlob({ ...part.blob, byteLength: part.bytes }, { outputFile: partial, signal, timeout: 120000,
        onProgress: ({ downloaded }) => onProgress((done + Math.min(downloaded, part.bytes)) / model.bytes) });
      signal?.throwIfAborted();
      await fsp.chmod(partial, 0o600);
      await verifyModel(partial, () => {}, part);
      await fsp.rename(partial, destination); partial = null;
      done += part.bytes;
    }
    return path.join(directory, parts[0].filename);
  } catch (error) {
    if (partial) await fsp.rm(partial, { force: true });
    if (error instanceof CompanionError) throw error;
    if (error.code === 'ENOSPC') throw new CompanionError('DISK_FULL', `The disk filled during the download. Free at least ${formatBytes(required)} and try again.`);
    throw new CompanionError('DOWNLOAD_FAILED', 'Download stopped or failed. QVAC registry models arrive from peers over the internet; check your connection, then retry. Partial files are discarded.');
  } finally {
    // Cleared blocks stay in RocksDB blob files; pinned coordinates make the cache disposable.
    if (client) { await client.close().catch(() => {}); await fsp.rm(storage, { recursive: true, force: true }); }
  }
}

async function readSelection(directory, { details = false } = {}) {
  try {
    const value = JSON.parse(await fsp.readFile(path.join(directory, 'model.json'), 'utf8'));
    const file = typeof value.path === 'string' && path.isAbsolute(value.path) ? value.path : null;
    const model = getModel(value.modelId);
    return details ? { path: file, model } : file;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CompanionError('SETTINGS_FAILED', 'The saved model selection could not be read. Select the model again to replace it.');
  }
}

async function saveSelection(directory, file, model = MODEL) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, 'model.json.tmp');
  await fsp.writeFile(temp, JSON.stringify({ path: file, modelId: model.id }), { mode: 0o600 });
  await fsp.rename(temp, path.join(directory, 'model.json'));
}

module.exports = { MODEL, MODELS, getModel, artifactParts, CompanionError, verifyModel, downloadModel, downloadRegistryModel, readSelection, saveSelection, downloadHeaders };
