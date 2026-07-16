import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('sandbox evidence collection is explicitly bounded', () => {
  const script = readFileSync('tools/sandbox.mjs', 'utf8');
  assert.match(script, /const captureMaxBuffer = 4 \* 1024 \* 1024;/);
  assert.match(script, /const evidenceLogTailLines = 2_000;/);
  assert.match(script, /\['logs', '--no-color', '--tail', String\(evidenceLogTailLines\)\]/);
  assert.doesNotMatch(script, /docker\(\['logs', '--no-color'\], \{ capture: true \}\)/);
});
