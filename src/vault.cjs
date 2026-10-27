const fs = require('node:fs/promises');
const path = require('node:path');

// Caller supplies Electron safeStorage. Tests use an explicitly synthetic protector.
class Vault {
  constructor(directory, protector) {
    this.directory = directory; this.protector = protector;
    this.file = path.join(directory, 'devices-and-jobs.enc');
    this.value = { devices: {}, jobs: {} }; this.tail = Promise.resolve();
  }
  async initialize() {
    if (!await this.protector.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.value = JSON.parse(await this.protector.decryptString(await fs.readFile(this.file))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!this.value.devices || !this.value.jobs) throw new Error('Invalid protected store');
  }
  change(callback) {
    const transaction = this.tail.then(async () => {
      const next = structuredClone(this.value);
      const result = await callback(next);
      const encrypted = await this.protector.encryptString(JSON.stringify(next));
      const temporary = this.file + '.tmp';
      const handle = await fs.open(temporary, 'w', 0o600);
      try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.file);
      const directory = await fs.open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.value = next;
      return result;
    });
    this.tail = transaction.catch(() => {});
    return transaction;
  }
}
module.exports = { Vault };
