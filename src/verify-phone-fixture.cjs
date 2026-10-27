// CLI-only isolated physical-phone fixture. No pairing-UI claim is made.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { deviceId } = require('./device-service.cjs');
async function preparePhoneFixture({ vault, devices, jobs, directory }) {
  if (!vault.value.recoveryPhoneFixture) {
    const pair = crypto.generateKeyPairSync('ed25519');
    const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
    const seed = Buffer.from(pair.privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
    await vault.change((data) => {
      data.recoveryPhoneFixture = { id: deviceId(publicKey), publicKey, seed };
      data.devices[deviceId(publicKey)] = { id: deviceId(publicKey), publicKey, name: 'R01 physical Android fixture' };
      data.enabled = true;
    });
  }
  const client = vault.value.recoveryPhoneFixture;
  await vault.change((data) => {
    data.devices[client.id] = { id: client.id, publicKey: client.publicKey, name: 'R01 physical Android fixture' };
    data.enabled = true;
  });
  await devices.start();
  const address = devices.snapshot().addresses[0];
  if (!address) throw new Error('Connect to the phone LAN');
  const trusted = { id: devices.identity.id, name: 'R01 isolated computer', pin: devices.pin, endpoint: `https://${address}:${devices.port}`, seed: client.seed, publicKey: client.publicKey, deviceId: client.id, enabled: true };
  await fs.writeFile(path.join(directory, 'device-config.json'), JSON.stringify({ RECOVERY_TRUSTED_COMPUTER: JSON.stringify(trusted) }), { mode: 0o600 });
  let tail = Promise.resolve();
  const record = () => {
    const metadata = jobs.list().filter((j) => j.device === client.id);
    if (!metadata.length) return;
    tail = tail.then(() => fs.appendFile(path.join(directory, 'task-states.jsonl'), JSON.stringify({ time: Date.now(), jobs: metadata }) + '\n', { mode: 0o600 })).catch(() => {});
  };
  jobs.on('change', record); record();
}
module.exports = { preparePhoneFixture };
