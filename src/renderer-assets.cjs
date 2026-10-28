const path = require('node:path');

// Only these file types are ever served to the renderer.
const TYPES = Object.freeze({
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.ttf': 'font/ttf', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
});
const ROOT_FILES = new Set(['/index.html']);
const FOLDERS = ['/assets/', '/js/', '/styles/'];

/** Maps a journal://companion pathname to a file inside `root`, or null. */
function resolveAsset(root, pathname) {
  if (typeof pathname !== 'string' || pathname.includes('\\') || pathname.includes('%') || pathname.includes('\0')) return null;
  if (!ROOT_FILES.has(pathname) && !FOLDERS.some((folder) => pathname.startsWith(folder))) return null;
  if (pathname.split('/').some((part) => part === '..' || part === '.' || part.startsWith('.') && part.length > 0)) return null;
  const type = TYPES[path.extname(pathname).toLowerCase()];
  if (!type) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, `.${pathname}`);
  if (!file.startsWith(base + path.sep)) return null;
  return { file, type };
}

module.exports = { resolveAsset };
