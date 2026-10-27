// Synthetic interoperability peer only. This auto-approval is never imported by
// the application and test/ is excluded from the packaged app.
const crypto = require('node:crypto');
const { DeviceService } = require('../../src/device-service.cjs');
const vault = { value: { devices: {}, jobs: {} }, change: async (f) => f(vault.value) };
const library = { capability: () => ({ id: 'text', status: 'unloaded', implemented: true, reason: 'Synthetic interoperability peer' }) };
const jobs = { forget: async (id) => { delete vault.value.devices[id]; } };
const service = new DeviceService(vault, library, jobs, { port: 0, host: '127.0.0.1', advertise: false });
(async () => {
  await service.initialize(); await service.start();
  service.pairing = { secret: crypto.randomBytes(32).toString('base64url'), expires: Date.now() + 120000, attempts: 0 };
  service.on('change', () => { for (const [ticket, p] of service.pending) if (p.state === 'pending') { p.state = 'approving'; service.vault.change((data) => { data.devices[p.id] = { id: p.id, name: p.name, publicKey: p.publicKey }; }).then(() => { p.state = 'approved'; }); } });
  process.stdout.write(JSON.stringify({ v: 1, id: service.identity.id, name: 'Synthetic desktop', pin: service.pin,
    endpoints: [`https://127.0.0.1:${service.port}`], secret: service.pairing.secret, expires: service.pairing.expires }) + '\n');
  process.stdin.on('data', async (data) => {
    if (data.toString().trim() === 'revoke') { for (const id of Object.keys(vault.value.devices)) await service.revoke(id); process.stdout.write('revoked\n'); }
    if (data.toString().trim() === 'quit') { await service.stop(); process.exit(0); }
  });
})().catch(() => process.exit(1));
