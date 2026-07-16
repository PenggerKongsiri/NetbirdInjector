import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRuntime, REQUIRED_EXECUTABLES, verifyRuntime } from '../scripts/release.mjs';

test('runtime release is manifest-verified and excludes tests, private keys, and generated state', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'nim-release-test-'));
  const output = join(temporary, 'netbird-injector-manager');
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const built = buildRuntime(process.cwd(), output);
  const verified = verifyRuntime(output);
  assert.equal(verified.fileCount, built.fileCount);
  assert.equal(existsSync(join(output, 'test')), false);
  assert.equal(existsSync(join(output, 'tools')), false);
  assert.equal(existsSync(join(output, 'bootstrap-ubuntu.sh')), true);
  assert.equal(existsSync(join(output, 'install.sh')), true);
  assert.equal(existsSync(join(output, 'test', 'fixtures', 'tls', 'server-key.pem')), false);
  if (process.platform !== 'win32') {
    for (const name of REQUIRED_EXECUTABLES) assert.equal(statSync(join(output, ...name.split('/'))).mode & 0o111, 0o111);
    chmodSync(join(output, 'setup'), 0o644);
    assert.throws(() => verifyRuntime(output), /release entrypoint is not executable: setup/);
    chmodSync(join(output, 'setup'), 0o755);
  }
  const manifest = readFileSync(join(output, 'RELEASE_MANIFEST.json'), 'utf8');
  assert.doesNotMatch(manifest, /server-key\.pem|PRIVATE KEY|C:\\Users\\/i);
});
