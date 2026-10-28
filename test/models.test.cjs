const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { MODEL, MODELS, getModel, artifactParts, downloadModel, downloadRegistryModel, saveSelection, readSelection } = require('../src/model.cjs');
const { Runtime } = require('../src/runtime.cjs');
const { Library } = require('../src/library.cjs');

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-models-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}

test('the offline catalog has distinct immutable publisher artifacts and rejects arbitrary IDs', () => {
  assert.equal(MODELS.length, 47);
  assert.equal(new Set(MODELS.map((model) => model.id)).size, MODELS.length);
  assert.equal(MODELS.filter((model) => model.capability === 'text').length, 24);
  assert.equal(MODELS.filter((model) => model.capability === 'image').length, 2);
  assert.equal(MODELS.filter((model) => model.capability === 'transcription').length, 10);
  assert.equal(MODELS.filter((model) => model.capability === 'speech').length, 7);
  assert.equal(MODELS.filter((model) => model.capability === 'vision').length, 1);
  assert.equal(MODELS.filter((model) => model.capability === 'ocr').length, 1);
  assert.equal(MODELS.filter((model) => model.capability === 'embedding').length, 2);
  const engines = { ocr: ['ggml-ocr'], vision: ['llamacpp-completion'], text: ['llamacpp-completion'], image: ['sdcpp-generation'], speech: ['tts-ggml'], embedding: ['llamacpp-embedding'],
    transcription: ['whispercpp-transcription', 'parakeet-transcription', 'moss-transcribe'] };
  for (const model of MODELS) {
    assert.equal(getModel(model.id), model);
    assert.ok(engines[model.capability].includes(model.engine));
    assert.ok(model.id.endsWith(`@${model.revision}`));
    for (const part of artifactParts(model)) assert.match(part.sha256, /^[a-f0-9]{64}$/);
    if (model.source === 'registry') {
      assert.ok(model.parts.length && model.capability !== 'text');
      assert.equal(model.bytes, model.parts.reduce((sum, part) => sum + part.bytes, 0));
      assert.match(model.detailsUrl, /^https:\/\/huggingface\.co\//);
      continue;
    }
    assert.match(model.revision, /^[a-f0-9]{40}$/);
    assert.match(model.repository, /^(Qwen|ggml-org|gpustack|bartowski|unsloth|microsoft|LiquidAI|ggerganov)\//);
  }
  assert.match(MODELS[2].license, /non-commercial/);
  assert.throws(() => getModel('https://example.com/untrusted.gguf'), { code: 'INCOMPATIBLE_MODEL' });
});

test('expanded writing choices cover established and newer families within the 24 GB guidance', () => {
  const writing = MODELS.filter((model) => model.capability === 'text');
  for (const family of ['Llama', 'Mistral', 'Phi-4', 'Gemma 4', 'Qwen3.5', 'LFM2.5', 'SmolLM3', 'Qwen2.5-Coder', 'Qwen3-Coder', 'gpt-oss']) {
    assert.ok(writing.some((model) => model.name.startsWith(family)), `Missing ${family}`);
  }
  assert.deepEqual(new Set(writing.map((model) => model.collection)), new Set(['Lightweight', 'Popular', 'New', 'Coding']));
  for (const model of writing) {
    assert.ok(model.memoryGB <= 24);
    // Only the coding group may use the larger mixture-of-experts files.
    assert.ok(model.bytes < (model.collection === 'Coding' ? 19e9 : 10e9), 'Keep weight files within the 24 GB catalog bounds');
    assert.match(model.filename, /\.gguf$/i);
    assert.ok(!/\d+-of-\d+/.test(model.filename), 'Only complete single-file models are supported');
  }
  const files = MODELS.flatMap((model) => artifactParts(model).map((part) => part.filename));
  assert.equal(new Set(files).size, files.length);
});

test('speech choices cover transcription and read-aloud within the 24 GB guidance', () => {
  for (const capability of ['transcription', 'speech']) {
    const models = MODELS.filter((model) => model.capability === capability);
    for (const model of models) { assert.ok(model.memoryGB <= 24); assert.ok(model.bytes < 10e9); }
  }
  for (const name of ['Whisper · Large v3 Turbo', 'Parakeet TDT · 0.6B v3', 'Supertonic 3', 'Chatterbox Turbo · English', 'Parler-TTS · Mini v1']) {
    assert.ok(MODELS.some((model) => model.name === name), `Missing ${name}`);
  }
  assert.equal(getModel('chatterbox-turbo-en-q8_0@qvac-registry').parts.length, 2);
});

test('speech pins match the QVAC registry shipped with the SDK', async () => {
  const registry = require.resolve('@qvac/inference/package').replace(/package\.json$/, 'dist/models/registry/models.js');
  const { models } = await import(registry);
  const bySha = new Map(models.map((entry) => [entry.sha256Checksum, entry]));
  let matched = 0;
  for (const model of MODELS.filter((entry) => ['transcription', 'speech'].includes(entry.capability))) {
    for (const part of artifactParts(model)) {
      const entry = bySha.get(part.sha256);
      if (model.source !== 'registry') {
        // Larger Whisper quantizations are pinned from Hugging Face metadata directly.
        if (entry) { assert.equal(entry.registryPath, `${model.repository}/resolve/${model.revision}/${part.filename}`); matched++; }
        continue;
      }
      assert.ok(entry, `${part.filename} is not in the QVAC registry`);
      assert.equal(entry.expectedSize, part.bytes); assert.equal(entry.registryPath, part.registryPath);
      assert.equal(entry.registrySource, 's3'); assert.equal(entry.engine, model.engine);
      assert.deepEqual(part.blob, { coreKey: entry.blobCoreKey, blockOffset: entry.blobBlockOffset, blockLength: entry.blobBlockLength, byteOffset: entry.blobByteOffset });
      matched++;
    }
  }
  assert.equal(matched, 16);
});

function fakeRegistry(contents, calls = []) {
  return (storage) => ({
    downloadBlob: async (blob, { outputFile, onProgress, signal }) => {
      calls.push({ storage, blob }); signal?.throwIfAborted();
      const payload = contents.get(blob.coreKey + blob.blockOffset);
      await fs.writeFile(outputFile, payload); onProgress({ downloaded: payload.length }); return { artifact: { path: outputFile } };
    },
    close: async () => calls.push('closed'),
  });
}

function syntheticBundle(...payloads) {
  const parts = payloads.map((payload, index) => ({ filename: `part-${index}.gguf`, bytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'), blob: { coreKey: 'core', blockOffset: index, blockLength: 1, byteOffset: 0 } }));
  const model = { ...getModel('chatterbox-turbo-en-q8_0@qvac-registry'), parts, bytes: parts.reduce((sum, part) => sum + part.bytes, 0) };
  return { model, contents: new Map(payloads.map((payload, index) => ['core' + index, payload])) };
}

test('registry downloads fetch only pinned blobs, verify every file and reuse verified parts', async (t) => {
  const dir = await directory(t), models = path.join(dir, 'models'), calls = [], progress = [];
  const { model, contents } = syntheticBundle(Buffer.from('synthetic T3'), Buffer.from('synthetic S3Gen weights'));
  const options = { model, statfs: async () => ({ bavail: 1e12, bsize: 1 }), registry: fakeRegistry(contents, calls) };
  const file = await downloadRegistryModel(models, (value) => progress.push(value), undefined, options);
  assert.equal(file, path.join(models, 'part-0.gguf'));
  for (const part of model.parts) assert.equal((await fs.stat(path.join(models, part.filename))).mode & 0o777, 0o600);
  assert.deepEqual(calls.filter((call) => call !== 'closed').map((call) => call.blob), model.parts.map((part) => ({ ...part.blob, byteLength: part.bytes })));
  assert.equal(calls[0].storage, path.join(dir, 'registry-cache')); assert.equal(calls.at(-1), 'closed');
  await assert.rejects(fs.stat(path.join(dir, 'registry-cache')), { code: 'ENOENT' }, 'Peer block cache is removed after the transfer');
  assert.equal(progress.at(-1), 1);
  calls.length = 0;
  await downloadRegistryModel(models, () => {}, undefined, options);
  assert.deepEqual(calls, [], 'Verified files are not downloaded again');
  await fs.rm(path.join(models, 'part-1.gguf'));
  await downloadRegistryModel(models, () => {}, undefined, options);
  assert.equal(calls.filter((call) => call !== 'closed').length, 1);
});

test('registry downloads reject mismatched files, check disk space first and discard cancelled transfers', async (t) => {
  const dir = await directory(t);
  const { model } = syntheticBundle(Buffer.from('expected weights'));
  const wrong = new Map([['core0', Buffer.from('tampered weights')]]);
  const options = { model, statfs: async () => ({ bavail: 1e12, bsize: 1 }), registry: fakeRegistry(wrong) };
  await assert.rejects(downloadRegistryModel(dir, () => {}, undefined, options), { code: 'INVALID_WEIGHTS' });
  await assert.rejects(fs.stat(path.join(dir, 'part-0.gguf')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(dir, 'part-0.gguf.partial')), { code: 'ENOENT' });
  await assert.rejects(downloadRegistryModel(dir, () => {}, undefined, { ...options, statfs: async () => ({ bavail: 1, bsize: 1 }),
    registry: () => assert.fail('No transfer should start') }), { code: 'DISK_FULL' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(downloadRegistryModel(dir, () => {}, controller.signal, options), { code: 'DOWNLOAD_FAILED' });
  await assert.rejects(fs.stat(path.join(dir, 'part-0.gguf.partial')), { code: 'ENOENT' });
});

test('selection remembers the model identity, while legacy path-only settings still use 0.5B', async (t) => {
  const dir = await directory(t), file = path.join(dir, 'selected.gguf');
  await fs.writeFile(path.join(dir, 'model.json'), JSON.stringify({ path: file }));
  assert.equal((await readSelection(dir, { details: true })).model.id, MODEL.id);
  await saveSelection(dir, file, MODELS[2]);
  assert.equal(await readSelection(dir), file);
  assert.equal((await readSelection(dir, { details: true })).model.id, MODELS[2].id);
});

test('downloader uses the chosen pinned URL, verifies its checksum and never replaces a good file on failure', async (t) => {
  const dir = await directory(t), payload = Buffer.from('tiny synthetic GGUF fixture');
  const model = { ...MODELS[1], bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') };
  let requested;
  const options = { model, statfs: async () => ({ bavail: 1e12, bsize: 1 }), fetcher: async (url) => {
    requested = url; return new Response(payload);
  } };
  const file = await downloadModel(dir, () => {}, undefined, options);
  assert.equal(requested, `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}`);
  assert.deepEqual(await fs.readFile(file), payload);
  await assert.rejects(downloadModel(dir, () => {}, undefined, { ...options, fetcher: async () => new Response(Buffer.alloc(payload.length)) }), { code: 'INVALID_WEIGHTS' });
  assert.deepEqual(await fs.readFile(file), payload);
  await assert.rejects(fs.stat(`${file}.partial`), { code: 'ENOENT' });
});

test('larger downloads check their own disk requirement before any network request', async (t) => {
  const dir = await directory(t);
  await assert.rejects(downloadModel(dir, () => {}, undefined, {
    model: MODELS[2], statfs: async () => ({ bavail: 1e9, bsize: 1 }), fetcher: () => assert.fail('No transfer should start'),
  }), (error) => error.code === 'DISK_FULL' && /2\.21 GB/.test(error.message));
});

test('cancellation discards a selected model transfer before installation', async (t) => {
  const dir = await directory(t), controller = new AbortController();
  await assert.rejects(downloadModel(dir, () => controller.abort(), controller.signal, {
    model: MODELS[1], statfs: async () => ({ bavail: 1e12, bsize: 1 }),
    fetcher: async () => new Response(new Uint8Array(128)),
  }), { code: 'DOWNLOAD_FAILED' });
  await assert.rejects(fs.stat(path.join(dir, MODELS[1].filename)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(dir, MODELS[1].filename + '.partial')), { code: 'ENOENT' });
});

async function fixture(t) {
  const dir = await directory(t);
  await fs.mkdir(path.join(dir, 'models'));
  for (const model of MODELS) for (const part of artifactParts(model)) await fs.writeFile(path.join(dir, 'models', part.filename), model.id);
  const verified = [], loads = [], unloaded = [];
  const modelVerifier = async (file, _, model) => {
    assert.equal(await fs.readFile(file, 'utf8'), model.id); verified.push(model.id);
  };
  const sdk = {
    loadModel: async (input) => { loads.push(input); return `loaded-${loads.length}`; },
    unloadModel: async ({ modelId }) => unloaded.push(modelId), close: async () => {},
  };
  const options = { checkHost: () => null, modelVerifier, sdkFactory: () => sdk };
  const runtime = new Runtime(dir, options); t.after(() => runtime.shutdown());
  const library = new Library(runtime); await library.initialize();
  return { dir, runtime, library, verified, loads, unloaded, options };
}

test('switching uses downloaded weights, updates writing assignment, preserves other models and restores on restart', async (t) => {
  const f = await fixture(t);
  assert.equal(f.library.snapshot().models.filter((model) => model.installed).length, MODELS.length);
  assert.equal((await f.runtime.load()).ok, true);
  const oldId = f.runtime.modelId;
  assert.equal((await f.runtime.load(MODELS[2].id)).ok, true);
  await f.library.reconcile();
  assert.deepEqual(f.unloaded, [oldId]);
  assert.equal(f.library.assignment, MODELS[2].id);
  assert.equal(f.library.capability().status, 'ready');
  assert.equal(f.loads.at(-1).modelSrc, path.join(f.dir, 'models', MODELS[2].filename));
  assert.equal(f.loads.at(-1).modelConfig.ctx_size, 4096);
  assert.equal((await readSelection(f.dir, { details: true })).model.id, MODELS[2].id);
  assert.equal(f.library.snapshot().models.filter((model) => model.installed).length, MODELS.length);
  await f.runtime.unload();
  assert.equal(f.library.snapshot().models.some((model) => model.loaded), false);
  await f.runtime.shutdown();
  const restored = new Runtime(f.dir, f.options); t.after(() => restored.shutdown());
  await restored.initialize();
  assert.equal(restored.model.id, MODELS[2].id);
  assert.equal(restored.state.status, 'ready');
  const restoredLibrary = new Library(restored); await restoredLibrary.initialize();
  assert.equal(restoredLibrary.assignment, MODELS[2].id);
});

test('accepted phone work blocks writing model switching and replacement downloads', async (t) => {
  const f = await fixture(t); f.runtime.reserved = true;
  await assert.rejects(f.runtime.load(MODELS[1].id), { code: 'BUSY' });
  await assert.rejects(f.runtime.download(true, MODELS[1].id), { code: 'BUSY' });
  await assert.rejects(f.library.assign(MODELS[1].id), { code: 'BUSY' });
  assert.equal(f.runtime.model.id, MODEL.id);
  f.runtime.reserved = false;
});

test('download without loading records the selected model but does not start inference', async (t) => {
  const f = await fixture(t); let downloaded;
  f.runtime.downloadFile = async (dir, progress, signal, { model }) => {
    downloaded = model.id; assert.ok(signal instanceof AbortSignal); progress(1);
    return path.join(dir, model.filename);
  };
  assert.equal((await f.runtime.download(false, MODELS[1].id)).ok, true);
  await f.library.reconcile();
  assert.equal(downloaded, MODELS[1].id);
  assert.equal(f.runtime.model.id, MODELS[1].id);
  assert.equal(f.library.assignment, MODELS[1].id);
  assert.equal(f.library.capability().status, 'unloaded');
  assert.equal(f.loads.length, 0);
});

test('removing the active owned model clears saved selection and keeps the other downloads', async (t) => {
  const f = await fixture(t);
  await f.runtime.load(MODELS[1].id); await f.library.reconcile(); await f.runtime.unload();
  await f.library.remove();
  assert.equal(f.runtime.file, null); assert.equal(await readSelection(f.dir), null);
  assert.equal(f.library.capability().status, 'needs_download');
  assert.equal(f.library.snapshot().models.filter((model) => model.installed).length, MODELS.length - 1);
  await assert.rejects(fs.stat(path.join(f.dir, 'models', MODELS[1].filename)), { code: 'ENOENT' });
});

test('Gemma uses the text backend and image downloads keep phone writing and the active selection unchanged', async (t) => {
  const f = await fixture(t), gemma = MODELS.find((model) => model.name === 'Gemma 3 · 4B Instruct');
  const image = MODELS.find((model) => model.capability === 'image');
  await f.runtime.load(gemma.id); await f.library.reconcile();
  assert.equal(f.loads.at(-1).modelType, 'llamacpp-completion');
  assert.equal(f.library.assignment, gemma.id); assert.equal(f.library.capability().status, 'ready');
  let finishDownload;
  f.runtime.downloadFile = async (directory, progress) => {
    progress(0.5); return new Promise((resolve) => { finishDownload = () => resolve(path.join(directory, image.filename)); });
  };
  f.runtime.reserved = true;
  const installed = f.library.downloadArtifact(image.id);
  assert.equal(f.library.snapshot().download.progress, 0.5);
  assert.equal(f.runtime.state.status, 'ready'); assert.equal(f.library.capability().status, 'ready');
  assert.equal(f.runtime.model.id, gemma.id); assert.equal(f.library.assignment, gemma.id);
  f.runtime.sdk.completion = () => ({ tokenStream: (async function* () { yield 'Phone writing remains available.'; })(), text: Promise.resolve('Phone writing remains available.') });
  assert.equal((await f.runtime.generate('A phone request during image download', { job: true })).ok, true);
  finishDownload(); await installed;
  assert.equal(f.library.snapshot().download.status, 'installed');
  assert.equal(f.library.capability().status, 'ready');
  assert.equal(f.runtime.model.id, gemma.id); assert.equal(f.library.assignment, gemma.id);
  assert.equal((await readSelection(f.dir, { details: true })).model.id, gemma.id);
  f.runtime.reserved = false;
  await assert.rejects(f.library.assign(image.id), { code: 'INCOMPATIBLE_MODEL' });
  assert.throws(() => f.runtime.load(image.id), { code: 'INCOMPATIBLE_MODEL' });
  await f.runtime.shutdown();
  const restored = new Runtime(f.dir, f.options); t.after(() => restored.shutdown()); await restored.initialize();
  const restoredLibrary = new Library(restored); await restoredLibrary.initialize();
  assert.equal(restored.model.id, gemma.id); assert.equal(restoredLibrary.assignment, gemma.id);
  assert.equal(restoredLibrary.capability().status, 'ready');
});

test('image download cancellation and duplicate transfers do not change writing readiness', async (t) => {
  const f = await fixture(t), image = MODELS.find((model) => model.capability === 'image');
  await f.runtime.load(); await f.library.reconcile();
  f.runtime.downloadFile = async (_, __, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new (require('../src/model.cjs').CompanionError)('DOWNLOAD_FAILED', 'Cancelled synthetic transfer.')), { once: true });
  });
  const download = f.library.downloadArtifact(image.id);
  assert.throws(() => f.library.downloadArtifact(image.id), { code: 'BUSY' });
  f.library.downloadAbort.abort();
  await assert.rejects(download, { code: 'DOWNLOAD_FAILED' });
  assert.equal(f.library.snapshot().download.status, 'failed');
  assert.equal(f.library.capability().status, 'ready'); assert.equal(f.runtime.model.id, MODEL.id);
});

test('access errors explain model terms without installing any file', async (t) => {
  const dir = await directory(t), model = MODELS.find((entry) => entry.name.startsWith('Gemma'));
  await assert.rejects(downloadModel(dir, () => {}, undefined, { model,
    statfs: async () => ({ bavail: 1e12, bsize: 1 }), fetcher: async () => new Response(null, { status: 403 }),
  }), { code: 'MODEL_ACCESS' });
  await assert.rejects(fs.stat(path.join(dir, model.filename)), { code: 'ENOENT' });
});

test('newer reasoning models request direct answers without changing writing token limits', async (t) => {
  const f = await fixture(t); let request;
  for (const model of MODELS.filter((entry) => entry.reasoningBudget === 0)) {
    assert.equal((await f.runtime.load(model.id)).ok, true);
    assert.equal(f.loads.at(-1).modelConfig.reasoning_budget, 0);
    assert.equal(f.loads.at(-1).modelConfig.ctx_size, 4096);
    f.runtime.sdk.completion = (input) => { request = input; return {
      tokenStream: (async function* () { yield 'A short answer.'; })(), text: Promise.resolve('A short answer.'),
    }; };
    assert.equal((await f.runtime.generate('A synthetic writing request')).ok, true);
    assert.equal(request.generationParams.reasoning_budget, 0);
    assert.equal(request.generationParams.predict, 192);
  }
});

test('speech downloads route by source, need every bundled file and leave writing untouched', async (t) => {
  const f = await fixture(t), bundle = getModel('chatterbox-turbo-en-q8_0@qvac-registry'), whisper = getModel('whisper-large-v3-turbo@5359861c739e955e79d9a303bcbc70fb988958b1');
  await f.runtime.load(); await f.library.reconcile();
  await fs.rm(path.join(f.dir, 'models', bundle.parts[1].filename)); await f.library.reconcile();
  assert.equal(f.library.snapshot().models.find((model) => model.id === bundle.id).installed, false);
  const routes = [];
  f.runtime.downloadFile = async (directory, progress, _, { model }) => { routes.push(['https', model.id]); progress(1); return path.join(directory, model.filename); };
  f.runtime.downloadRegistry = async (directory, progress, _, { model }) => {
    routes.push(['registry', model.id]); await fs.writeFile(path.join(directory, model.parts[1].filename), model.id); progress(1);
    return path.join(directory, model.parts[0].filename);
  };
  await f.library.downloadArtifact(bundle.id); await f.library.downloadArtifact(whisper.id);
  assert.deepEqual(routes, [['registry', bundle.id], ['https', whisper.id]]);
  assert.equal(f.library.snapshot().models.find((model) => model.id === bundle.id).installed, true);
  assert.equal(f.runtime.model.id, MODEL.id); assert.equal(f.library.capability().status, 'ready');
  await assert.rejects(f.library.assign(bundle.id), { code: 'INCOMPATIBLE_MODEL' });
  assert.throws(() => f.runtime.load(whisper.id), { code: 'INCOMPATIBLE_MODEL' });
  assert.throws(() => f.library.downloadArtifact(MODELS[1].id), { code: 'INCOMPATIBLE_MODEL' });
});

test('I03/I04 image pins match the QVAC registry shipped with the SDK', async () => {
  const registry = require.resolve('@qvac/inference/package').replace(/package\.json$/, 'dist/models/registry/models.js');
  const { models } = await import(registry);
  const bySha = new Map(models.map((entry) => [entry.sha256Checksum, entry]));
  const vision = MODELS.find((m) => m.capability === 'vision'), ocr = MODELS.find((m) => m.capability === 'ocr');
  for (const part of artifactParts(vision)) {
    const entry = bySha.get(part.sha256);
    assert.equal(entry.expectedSize, part.bytes); assert.equal(entry.engine, 'llamacpp-completion');
    assert.ok(entry.registryPath.endsWith(`/${part.filename}`));
  }
  assert.equal(vision.bytes, vision.parts.reduce((sum, part) => sum + part.bytes, 0));
  for (const part of artifactParts(ocr)) {
    const entry = bySha.get(part.sha256);
    assert.equal(entry.expectedSize, part.bytes); assert.equal(entry.engine, 'ggml-ocr'); assert.equal(entry.registryPath, part.registryPath);
    assert.deepEqual(part.blob, { coreKey: entry.blobCoreKey, blockOffset: entry.blobBlockOffset, blockLength: entry.blobBlockLength, byteOffset: entry.blobByteOffset });
  }
});
