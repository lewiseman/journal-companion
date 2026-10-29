const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportOperations, targets } = require('../scripts/export-operations.cjs');
test('phone operation export is deterministic and stale assets fail verification', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-operations-'));
  try {
    exportOperations(false, dir); exportOperations(true, dir);
    const file = path.join(dir, 'operations.json'); fs.writeFileSync(file, '{}');
    assert.throws(() => exportOperations(true, dir), /stale/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('exports the desktop summary prompt, schema and pinned model checksums', () => {
  const { SUMMARY_SYSTEM } = require('../src/summary.cjs');
  assert.equal(targets['operations.json'].operations['summarize-note'].system, SUMMARY_SYSTEM);
  assert.equal(targets['operations.json'].operations['suggest-note-template'].responseFormat.type, 'json_schema');
  for (const model of targets['models.json'].models) { assert.match(model.sha256, /^[a-f0-9]{64}$/); assert.match(model.revision, /^[a-f0-9]{40}$/); }
});
