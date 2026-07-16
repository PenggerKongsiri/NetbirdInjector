import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRuntime, REQUIRED_EXECUTABLES, verifyRuntime } from '../scripts/release.mjs';

test('runtime release is manifest-verified and excludes tests, private keys, and generated state', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'nim-release-test-'));
  const output = join(temporary, 'netbird-injector-manager');
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const previousUmask = process.umask(0o077);
  let built;
  try {
    built = buildRuntime(process.cwd(), output);
  } finally {
    process.umask(previousUmask);
  }
  const verified = verifyRuntime(output);
  assert.equal(verified.fileCount, built.fileCount);
  assert.equal(existsSync(join(output, 'test')), false);
  assert.equal(existsSync(join(output, 'tools')), false);
  assert.equal(existsSync(join(output, 'bootstrap-ubuntu.sh')), true);
  assert.equal(existsSync(join(output, 'install.sh')), true);
  assert.equal(existsSync(join(output, 'test', 'fixtures', 'tls', 'server-key.pem')), false);
  if (process.platform !== 'win32') {
    assert.equal(statSync(output).mode & 0o777, 0o755);
    assert.equal(statSync(join(output, 'src')).mode & 0o777, 0o755);
    assert.equal(statSync(join(output, 'src', 'main.mjs')).mode & 0o777, 0o644);
    assert.equal(statSync(join(output, 'RELEASE_MANIFEST.json')).mode & 0o777, 0o644);
    for (const name of REQUIRED_EXECUTABLES) assert.equal(statSync(join(output, ...name.split('/'))).mode & 0o777, 0o755);
    chmodSync(join(output, 'setup'), 0o644);
    assert.throws(() => verifyRuntime(output), /release entrypoint is not mode 0755: setup/);
    chmodSync(join(output, 'setup'), 0o755);
    chmodSync(join(output, 'src'), 0o700);
    assert.throws(() => verifyRuntime(output), /release directory is not mode 0755: src/);
    chmodSync(join(output, 'src'), 0o755);
    chmodSync(join(output, 'src', 'main.mjs'), 0o600);
    assert.throws(() => verifyRuntime(output), /release file is not mode 0644: src\/main\.mjs/);
    chmodSync(join(output, 'src', 'main.mjs'), 0o644);
    symlinkSync('README.md', join(output, 'unexpected-link'));
    assert.throws(() => verifyRuntime(output), /release contains symbolic link: unexpected-link/);
    unlinkSync(join(output, 'unexpected-link'));
  }
  const manifest = readFileSync(join(output, 'RELEASE_MANIFEST.json'), 'utf8');
  assert.doesNotMatch(manifest, /server-key\.pem|PRIVATE KEY|C:\\Users\\/i);
});
