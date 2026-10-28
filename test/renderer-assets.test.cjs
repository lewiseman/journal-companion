const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { resolveAsset } = require('../src/renderer-assets.cjs');

const root = path.join(__dirname, '..', 'src', 'renderer');

test('serves the page, scripts, styles, fonts and art with fixed types', () => {
  assert.deepEqual(resolveAsset(root, '/index.html'), { file: path.join(root, 'index.html'), type: 'text/html' });
  assert.equal(resolveAsset(root, '/js/main.js').type, 'text/javascript');
  assert.equal(resolveAsset(root, '/styles/base.css').type, 'text/css');
  assert.equal(resolveAsset(root, '/assets/fonts/Lora-Regular.ttf').type, 'font/ttf');
  assert.equal(resolveAsset(root, '/assets/art/cover.webp').type, 'image/webp');
  assert.equal(resolveAsset(root, '/assets/art/j.png').type, 'image/png');
});

test('refuses traversal, encoded paths, unknown types and other folders', () => {
  for (const pathname of ['/../main.cjs', '/assets/../../main.cjs', '/assets/%2e%2e/main.cjs', '/js/..%2fmain.cjs',
    '/assets/fonts/OFL.txt', '/preload.cjs', '/app.js', '/assets/.hidden.png', '/js\\..\\main.js', '/assets/art/j.png\0', '/other/x.js', '']) {
    assert.equal(resolveAsset(root, pathname), null, pathname);
  }
});

test('every asset the page references exists and resolves', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readdirSync(path.join(root, 'styles')).map((f) => fs.readFileSync(path.join(root, 'styles', f), 'utf8')).join('\n');
  const js = fs.readdirSync(path.join(root, 'js')).map((f) => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');
  const refs = new Set([
    ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => `/${m[1]}`),
    ...[...css.matchAll(/url\(['"]?\.\.\/([^'")]+)/g)].map((m) => `/${m[1]}`),
    ...[...js.matchAll(/['"`](assets\/[^'"`]+\.(?:png|webp))['"`]/g)].map((m) => `/${m[1]}`),
  ]);
  assert.ok(refs.size > 5);
  for (const ref of refs) {
    const asset = resolveAsset(root, ref);
    assert.ok(asset, ref);
    assert.ok(fs.existsSync(asset.file), ref);
  }
});
