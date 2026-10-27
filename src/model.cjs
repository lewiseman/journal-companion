const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Official Qwen repository, immutable revision + LFS SHA-256 (see docs/D01.md).
const MODEL = Object.freeze({
  name: 'Qwen2.5 · 0.5B Instruct',
  filename: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  bytes: 491400032,
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
  revision: '9217f5db79a29953eb74d5343926648285ec7e67',
  license: 'Apache 2.0',
});
const MODEL_URL = `https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/${MODEL.revision}/${MODEL.filename}`;

class CompanionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function downloadHeaders(url, token = process.env.HF_TOKEN) {
  // Hugging Face CDN redirects use signed URLs. Never forward the account token
  // to a CDN, subdomain, or other origin.
  return token && new URL(url).origin === 'https://huggingface.co'
    ? { Authorization: `Bearer ${token}` } : {};
}

async function verifyModel(file, onProgress = () => {}) {
  let stat;
  try { stat = await fsp.stat(file); }
  catch { throw new CompanionError('MISSING_WEIGHTS', 'Model file is missing. Download it or select the original GGUF again.'); }
  if (!stat.isFile() || stat.size !== MODEL.bytes) {
    throw new CompanionError('INVALID_WEIGHTS', 'This is not the complete supported model. Select Qwen2.5 0.5B Instruct Q4_K_M or download a fresh copy.');
  }
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk); bytes += chunk.length; onProgress(bytes / MODEL.bytes);
  }
  if (hash.digest('hex') !== MODEL.sha256) {
    throw new CompanionError('INVALID_WEIGHTS', 'The model checksum does not match. Download a fresh copy; this file will not be loaded.');
  }
  return file;
}

async function downloadModel(directory, onProgress = () => {}, signal) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = await fsp.statfs(directory);
  if (disk.bavail * disk.bsize < MODEL.bytes + 100 * 1024 * 1024) {
    throw new CompanionError('DISK_FULL', 'Free at least 600 MB of disk space, then try the download again.');
  }
  const destination = path.join(directory, MODEL.filename);
  const partial = destination + '.partial';
  // Single explicitly requested transfer. No discovery, peer downloads, or background retry.
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let idle = setTimeout(abort, 120000);
  try {
    let url = MODEL_URL;
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !(target.hostname === 'huggingface.co' || target.hostname.endsWith('.huggingface.co') || target.hostname.endsWith('.hf.co'))) {
        throw new CompanionError('DOWNLOAD_FAILED', 'The model host redirected outside its approved HTTPS hosts. Try again later or select a local copy.');
      }
      response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: downloadHeaders(url) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) break;
        url = new URL(location, url).href;
      } else break;
    }
    if (!response?.ok || !response.body) throw new CompanionError('DOWNLOAD_FAILED', 'The model download could not start. Check internet access, then retry or select a local copy.');
    let received = 0;
    const meter = new Transform({ transform(chunk, _, callback) {
      clearTimeout(idle); idle = setTimeout(abort, 120000);
      received += chunk.length;
      if (received > MODEL.bytes) return callback(new Error('Unexpected download size'));
      onProgress(received / MODEL.bytes);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { mode: 0o600 }));
    await verifyModel(partial);
    await fsp.rename(partial, destination);
    return destination;
  } catch (error) {
    await fsp.rm(partial, { force: true });
    if (error instanceof CompanionError) throw error;
    if (error.code === 'ENOSPC') throw new CompanionError('DISK_FULL', 'The disk filled during the download. Free at least 600 MB and try again.');
    throw new CompanionError('DOWNLOAD_FAILED', 'Download stopped or failed. Check internet access and disk space, then retry. Partial files are discarded.');
  } finally {
    clearTimeout(idle); signal?.removeEventListener('abort', abort);
  }
}

async function readSelection(directory) {
  try {
    const value = JSON.parse(await fsp.readFile(path.join(directory, 'model.json'), 'utf8'));
    return typeof value.path === 'string' && path.isAbsolute(value.path) ? value.path : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new CompanionError('SETTINGS_FAILED', 'The saved model selection could not be read. Select the model again to replace it.');
  }
}

async function saveSelection(directory, file) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, 'model.json.tmp');
  await fsp.writeFile(temp, JSON.stringify({ path: file }), { mode: 0o600 });
  await fsp.rename(temp, path.join(directory, 'model.json'));
}

module.exports = { MODEL, CompanionError, verifyModel, downloadModel, readSelection, saveSelection, downloadHeaders };
