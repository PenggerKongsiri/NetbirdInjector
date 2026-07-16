import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('systemd resolves Node from fixed root-owned installation paths', () => {
  const unit = readFileSync('packaging/netbird-injector-manager.service', 'utf8');
  assert.match(unit, /^Environment=PATH=\/usr\/local\/bin:\/usr\/bin:\/bin$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/env node --jitless --disable-proto=throw /m);
  assert.doesNotMatch(unit, /^ExecStart=\/usr\/bin\/node\b/m);
});
