// I02 real-runtime check: diary photo questions with Qwen3-VL through the
// production Runtime, Vision and Jobs, with a synthetic in-memory vault.
// Photos are the app's own onboarding illustrations and the drawn I03
// fixtures (no personal images), cropped and re-encoded with macOS `sips`.
// Usage: node scripts/verify-photo-questions.cjs <new-empty-output-dir> <companion-data-dir>
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');
const { Vision, PHOTO_OPERATION } = require('../src/vision.cjs');

const onboarding = (name) => path.join(__dirname, '..', '..', 'journal', 'assets', 'images', 'onboarding', name);
const fixture = (name) => path.join(__dirname, 'fixtures', name);

/** Crops the right-hand page of an onboarding spread and re-encodes it as a PNG of at most 1280 px, as the phone does. */
function page(source, out) {
  execFileSync('sips', ['-s', 'format', 'png', source, '--out', out], { stdio: 'ignore' });
  execFileSync('sips', ['-c', '900', '640', '--cropOffset', '90', '760', out], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', '1280', out], { stdio: 'ignore' });
}

/** A heavily blurred copy: shrink to 12 px and back up. */
function blur(source, out) {
  execFileSync('sips', ['-Z', '12', source, '--out', out], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', '640', out], { stdio: 'ignore' });
}

const protector = () => {
  const key = crypto.randomBytes(32);
  return { encryptString(v) { const n = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, n); const b = Buffer.concat([c.update(v), c.final()]); return Buffer.concat([n, c.getAuthTag(), b]); },
    decryptString(b) { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(); } };
};

(async () => {
  const [out, data] = process.argv.slice(2);
  if (!out || !data) throw new Error('Usage: verify-photo-questions.cjs <new-empty-dir> <companion-data-dir>');
  await fs.mkdir(out, { recursive: true });
  if ((await fs.readdir(out)).length) throw new Error('Output directory must be empty.');
  const photos = path.join(out, 'photos'); await fs.mkdir(photos);
  page(onboarding('diary.webp'), path.join(photos, 'coffee.png'));
  page(onboarding('birthdays.webp'), path.join(photos, 'cake.png'));
  blur(path.join(photos, 'coffee.png'), path.join(photos, 'coffee-blurred.png'));
  const SAMPLES = [
    { name: 'coffee-no-caption', image: path.join(photos, 'coffee.png'), caption: '' },
    { name: 'cake-with-caption', image: path.join(photos, 'cake.png'), caption: 'Maya turned seven today' },
    { name: 'coffee-blurred', image: path.join(photos, 'coffee-blurred.png'), caption: '' },
    { name: 'drawn-house', image: fixture('scene.png'), caption: '' },
    { name: 'printed-injection', image: fixture('injection.png'), caption: '' },
  ];

  // Reads the companion's verified model files; writes only inside <out>.
  const work = path.join(out, 'runtime'); await fs.mkdir(path.join(work, 'models'), { recursive: true });
  const runtime = new Runtime(work);
  const vision = new Vision(runtime, { directory: work, protector: protector() });
  for (const { part } of vision.files()) await fs.symlink(path.join(data, 'models', part.filename), path.join(work, 'models', part.filename));
  await runtime.initialize(); await vision.initialize();
  const report = { milestone: 'I02', runtime: 'real QVAC @qvac/sdk 0.22.0 llamacpp-completion + mmproj', host: `${process.platform} ${process.arch}`, model: vision.model.id, at: new Date().toISOString() };

  // A computer without the vision model refuses before accepting anything.
  const emptyWork = path.join(out, 'no-model'); await fs.mkdir(emptyWork);
  const emptyRuntime = new Runtime(emptyWork), emptyVision = new Vision(emptyRuntime, { directory: emptyWork, protector: protector() });
  await emptyVision.initialize();
  const emptyJobs = new Jobs({ directory: emptyWork, value: { devices: { synthetic: { id: 'synthetic' } }, jobs: {} }, tail: Promise.resolve(), async change() {} }, emptyRuntime, { assignment: null, capability: () => ({ status: 'unloaded' }) });
  emptyJobs.vision = emptyVision;
  try {
    await emptyJobs.submit('synthetic', { id: 'i02-no-model', operation: PHOTO_OPERATION, prompt: '{"caption":""}', image: (await fs.readFile(SAMPLES[0].image)).toString('base64') }, { image: true });
    report.unavailable = { refused: false };
  } catch (error) {
    report.unavailable = { refused: true, code: error.code, status: emptyVision.capability().status, message: error.message };
  }
  console.log('unavailable', report.unavailable);

  let started = Date.now();
  report.selfTest = { ...(await vision.selfTest()), seconds: (Date.now() - started) / 1000, status: vision.capability().status };
  console.log('self-test', report.selfTest);
  let value = { devices: { synthetic: { id: 'synthetic' } }, jobs: {} };
  const vault = { directory: work, get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  let jobs = new Jobs(vault, runtime, { assignment: null, capability: () => ({ status: 'unloaded' }) }); jobs.vision = vision;
  report.results = [];
  for (const [i, sample] of SAMPLES.entries()) {
    started = Date.now();
    const id = `i02-evidence-${i}`;
    await jobs.submit('synthetic', { id, operation: PHOTO_OPERATION, prompt: JSON.stringify({ caption: sample.caption }), image: (await fs.readFile(sample.image)).toString('base64') }, { image: true });
    await jobs.pump();
    const job = jobs.get('synthetic', id);
    report.results.push({ name: sample.name, caption: sample.caption, state: job.state, error: job.error || null, output: job.text ? JSON.parse(job.text) : null, seconds: (Date.now() - started) / 1000 });
    console.log(sample.name, job.state, job.text || job.error);
  }

  // Shuffle: the same photo, avoiding every question already shown in each
  // group, must bring different questions (sampled, not repeated).
  const base = report.results.find((r) => r.name === 'coffee-no-caption')?.output;
  if (base) {
    report.shuffle = [];
    for (const group of ['moment', 'feeling', 'little']) {
      started = Date.now();
      const id = `i02-shuffle-${group}`;
      await jobs.submit('synthetic', { id, operation: PHOTO_OPERATION, prompt: JSON.stringify({ caption: '', avoid: base[group] }), image: (await fs.readFile(SAMPLES[0].image)).toString('base64') }, { image: true });
      await jobs.pump();
      const job = jobs.get('synthetic', id);
      const seen = new Set(base[group].map((q) => q.toLowerCase()));
      const fresh = job.text ? JSON.parse(job.text)[group].filter((q) => !seen.has(q.toLowerCase())) : [];
      report.shuffle.push({ group, avoided: base[group], state: job.state, newQuestion: fresh[0] ?? null, seconds: (Date.now() - started) / 1000 });
      console.log('shuffle', group, job.state, fresh[0] ?? '(none new)');
    }
  }

  // Interrupted: a job accepted but not started survives a companion restart
  // and runs once afterwards; its encrypted photo is then swept.
  jobs.pumping = true;
  await jobs.submit('synthetic', { id: 'i02-restart', operation: PHOTO_OPERATION, prompt: '{"caption":""}', image: (await fs.readFile(SAMPLES[1].image)).toString('base64') }, { image: true });
  const pendingFiles = (await fs.readdir(vision.root)).filter((n) => n.endsWith('.enc')).length;
  jobs = new Jobs(vault, runtime, { assignment: null, capability: () => ({ status: 'unloaded' }) }); jobs.vision = vision;
  started = Date.now();
  await jobs.pump();
  const resumed = jobs.get('synthetic', 'i02-restart');
  report.restart = { pendingEncryptedPhotos: pendingFiles, state: resumed.state, questions: resumed.text ? JSON.parse(resumed.text) : null, seconds: (Date.now() - started) / 1000 };
  console.log('restart', report.restart.state);

  await vision.sweep(value.jobs);
  report.imageFilesLeft = (await fs.readdir(vision.root)).length;
  await fs.writeFile(path.join(out, 'photo-questions-native.json'), JSON.stringify(report, null, 2));
  await runtime.shutdown();
})().catch((error) => { console.error(error); process.exitCode = 1; });
