const fs = require('node:fs/promises');
const path = require('node:path');
const { CompanionError } = require('./model.cjs');

const THEMES = Object.freeze(['system', 'light', 'dark']);
const FILE = 'appearance.json';

/** Reads the saved theme; anything missing or unexpected falls back to following macOS. */
async function readTheme(directory) {
  try {
    const { theme } = JSON.parse(await fs.readFile(path.join(directory, FILE), 'utf8'));
    return THEMES.includes(theme) ? theme : 'system';
  } catch { return 'system'; }
}

async function saveTheme(directory, theme) {
  if (!THEMES.includes(theme)) throw new CompanionError('INVALID_INPUT', 'Choose light, dark or system.');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, FILE), temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ theme }), { mode: 0o600 });
  await fs.rename(temporary, file);
  return theme;
}

module.exports = { THEMES, readTheme, saveTheme };
