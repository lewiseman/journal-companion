const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readTheme, saveTheme } = require('../src/appearance.cjs');

test('remembers light, dark or system and defaults to system', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-'));
  assert.equal(await readTheme(directory), 'system');
  for (const theme of ['dark', 'light', 'system']) {
    assert.equal(await saveTheme(directory, theme), theme);
    assert.equal(await readTheme(directory), theme);
  }
});

test('refuses unknown themes and ignores a damaged file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-'));
  await assert.rejects(saveTheme(directory, 'sepia'), { code: 'INVALID_INPUT' });
  await fs.writeFile(path.join(directory, 'appearance.json'), '{"theme":"neon"}');
  assert.equal(await readTheme(directory), 'system');
  await fs.writeFile(path.join(directory, 'appearance.json'), 'not json');
  assert.equal(await readTheme(directory), 'system');
});
