// I06 real-runtime check: Stable Diffusion 2.1 through the production Runtime,
// Background and Jobs with a synthetic in-memory vault.
// Usage: node scripts/verify-background.cjs <new-empty-output-dir> <companion-data-dir>
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Runtime } = require('../src/runtime.cjs');
const { Jobs } = require('../src/jobs.cjs');
const { Background, BACKGROUND_OPERATION, BACKGROUND_MODELS } = require('../src/background.cjs');

(async () => {
  const [out, data] = process.argv.slice(2);
  if (!out || !data) throw new Error('Usage: verify-background.cjs <new-empty-dir> <companion-data-dir>');
  await fs.mkdir(out, { recursive: true });
  if ((await fs.readdir(out)).length) throw new Error('Output directory must be empty.');
  const work = path.join(out, 'runtime'); await fs.mkdir(path.join(work, 'models'), { recursive: true });
  const model = BACKGROUND_MODELS.find((m) => m.memoryGB === 8);
  await fs.symlink(path.join(data, 'models', model.filename), path.join(work, 'models', model.filename));
  const key = crypto.randomBytes(32);
  const protector = { encryptString(v) { const n = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, n); const b = Buffer.concat([c.update(v), c.final()]); return Buffer.concat([n, c.getAuthTag(), b]); },
    decryptString(b) { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(); } };
  const runtime = new Runtime(work); await runtime.initialize();
  const background = new Background(runtime, { protector }); await background.initialize();
  const report = { milestone: 'I06', runtime: 'real QVAC @qvac/sdk 0.22.0 sdcpp-generation', host: `${process.platform} ${process.arch}`, totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3), model: model.id, at: new Date().toISOString(), states: [background.capability().status] };
  await background.assign(model.id); report.states.push(background.capability().status);
  let t = Date.now();
  report.selfTest = { ...(await background.selfTest()), seconds: (Date.now() - t) / 1000 };
  report.states.push(background.capability().status);
  console.log('self-test', report.selfTest, report.states);
  let value = { devices: { synthetic: { id: 'synthetic' } }, jobs: {} };
  const vault = { directory: work, get value() { return value; }, tail: Promise.resolve(), async change(fn) { const next = structuredClone(value); await fn(next); value = next; } };
  const jobs = new Jobs(vault, runtime, { assignment: null, capability: () => ({ status: 'unloaded' }) }); jobs.background = background;
  report.results = [];
  for (const [i, input] of [{ prompt: 'sea glass and soft morning fog', tone: 'light' }, { prompt: 'night forest with fireflies', tone: 'dark' }].entries()) {
    t = Date.now();
    const id = `i06-evidence-${i}`, progress = [];
    jobs.on('change', () => { const p = value.jobs[`synthetic:${id}`]?.progress; if (p && progress.at(-1)?.step !== p.step) progress.push(p); });
    await jobs.submit('synthetic', { id, operation: BACKGROUND_OPERATION, prompt: JSON.stringify(input) });
    await jobs.pump();
    const job = jobs.get('synthetic', id);
    const entry = { input, state: job.state, error: job.error || null, meta: job.text ? JSON.parse(job.text) : null, seconds: (Date.now() - t) / 1000, progress };
    if (job.state === 'completed') {
      const collected = await jobs.backgroundResult('synthetic', id);
      await fs.writeFile(path.join(out, `${id}.png`), Buffer.from(collected.image, 'base64'));
      await jobs.acknowledge('synthetic', id);
      entry.collectedAndAcknowledged = true;
    }
    report.results.push(entry); console.log(id, entry.state, entry.seconds, entry.meta);
  }
  // Cancel a running generation from the job API.
  t = Date.now();
  await jobs.submit('synthetic', { id: 'i06-evidence-cancel', operation: BACKGROUND_OPERATION, prompt: JSON.stringify({ prompt: 'warm paper', tone: 'light' }) });
  const pumping = jobs.pump();
  await new Promise((resolve) => { const check = setInterval(() => { if (value.jobs['synthetic:i06-evidence-cancel']?.progress?.step >= 2) { clearInterval(check); resolve(); } }, 200); });
  const cancelAt = Date.now();
  await jobs.cancel('synthetic', 'i06-evidence-cancel', BACKGROUND_OPERATION);
  await pumping;
  report.cancel = { state: jobs.get('synthetic', 'i06-evidence-cancel').state, secondsToStop: (Date.now() - cancelAt) / 1000, totalSeconds: (Date.now() - t) / 1000, writingRuntimeStatus: runtime.state.status };
  console.log('cancel', report.cancel);
  await background.sweep(value.jobs);
  report.outputFilesLeft = (await fs.readdir(background.root)).length;
  await fs.writeFile(path.join(out, 'background-native.json'), JSON.stringify(report, null, 2));
  await runtime.shutdown();
})().catch((error) => { console.error(error); process.exitCode = 1; });
