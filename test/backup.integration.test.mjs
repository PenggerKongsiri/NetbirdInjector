import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { hashPassword } from '../src/lib/security.mjs';
import { Store } from '../src/lib/store.mjs';

const execFileAsync = promisify(execFile);

test('backup creates a consistent database, manifest checksums, and detects corruption', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nim-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'state.db');
  const configPath = join(directory, 'config.json');
  const destination = join(directory, 'backup-one');
  const store = new Store(database);
  store.audit('test', 'backup.fixture', 'test', 'fixture', 'fake event');
  store.close();
  writeFileSync(configPath, JSON.stringify({
    proxy: { listen: '127.0.0.1', port: 18080 },
    admin: { listen: '127.0.0.1', port: 19090, passwordHash: await hashPassword('a sufficiently long backup test password') },
    storage: { database },
    network: { allowedTargetCidrs: ['127.0.0.1/32'], allowedPorts: [18080], trustedIngressCidrs: [] },
    netbird: { mode: 'manual' },
  }));
  await execFileAsync(process.execPath, ['scripts/backup.mjs', 'create', configPath, destination], { cwd: process.cwd() });
  const verification = await execFileAsync(process.execPath, ['scripts/backup.mjs', 'verify', join(destination, 'config.json'), destination], { cwd: process.cwd() });
  assert.match(verification.stdout, /verified/);
  const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files).sort(), ['config.json', 'state.db']);
  assert.deepEqual(manifest.excludes, ['NetBird API token file', 'external TLS/private keys']);
  writeFileSync(join(destination, 'state.db'), 'corrupt');
  await assert.rejects(execFileAsync(process.execPath, ['scripts/backup.mjs', 'verify', join(destination, 'config.json'), destination], { cwd: process.cwd() }), /checksum mismatch/);
});
