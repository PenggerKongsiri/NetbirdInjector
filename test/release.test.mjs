import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRuntime, verifyRuntime } from '../scripts/release.mjs';

test('runtime release is manifest-verified and excludes tests, private keys, and generated state', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'nim-release-test-'));
  const output = join(temporary, 'netbird-injector-manager');
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const built = buildRuntime(process.cwd(), output);
  const verified = verifyRuntime(output);
  assert.equal(verified.fileCount, built.fileCount);
  assert.equal(existsSync(join(output, 'test')), false);
  assert.equal(existsSync(join(output, 'tools')), false);
  assert.equal(existsSync(join(output, 'test', 'fixtures', 'tls', 'server-key.pem')), false);
  const manifest = readFileSync(join(output, 'RELEASE_MANIFEST.json'), 'utf8');
  assert.doesNotMatch(manifest, /server-key\.pem|PRIVATE KEY|C:\\Users\\/i);
});
