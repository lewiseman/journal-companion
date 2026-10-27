const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTransformInput, validateTransformOutput } = require('../src/transform.cjs');
test('bounded writing contract rejects malformed data, missing tone intent and unwanted context fields', () => {
  const valid = { text: 'Only this passage.', intent: '' };
  assert.deepEqual(validateTransformInput(JSON.stringify(valid), 'rewrite-note'), valid);
  for (const [data, operation] of [
    ['{', 'rewrite-note'], [JSON.stringify(valid), 'unknown'],
    [JSON.stringify(valid), 'tone-note'], [JSON.stringify({ ...valid, title: 'private' }), 'rewrite-note'],
    [JSON.stringify({ ...valid, text: '🦉'.repeat(500) }), 'rewrite-note'],
    [JSON.stringify({ ...valid, intent: '🦉'.repeat(61) }), 'rewrite-note'],
    [JSON.stringify({ ...valid, text: '\ud800' }), 'rewrite-note'],
  ]) assert.throws(() => validateTransformInput(data, operation), { code: 'INVALID_INPUT' });
  assert.equal(validateTransformOutput('# Plan\n\n- Friday'), '# Plan\n\n- Friday');
});
