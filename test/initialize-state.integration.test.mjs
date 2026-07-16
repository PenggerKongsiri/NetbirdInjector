import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import test from 'node:test';
import { hashPassword } from '../src/lib/security.mjs';

const execFileAsync = promisify(execFile);

async function fixture(directory) {
  const database = join(directory, 'state.db');
  const configPath = join(directory, 'config.json');
  const passwordHash = await hashPassword('a sufficiently long interrupted install password');
  const configText = `${JSON.stringify({
    proxy: { listen: '127.0.0.1', port: 18080 },
    admin: { listen: '127.0.0.1', port: 19090, username: 'recovered-admin', passwordHash },
    storage: { database },
    network: { allowedTargetCidrs: ['127.0.0.1/32'], allowedPorts: [18080], trustedIngressCidrs: [] },
    netbird: { mode: 'manual' },
  }, null, 2)}\n`;
  writeFileSync(configPath, configText, { mode: 0o640 });
  return { configPath, configText, database, passwordHash };
}

test('interrupted-install recovery creates initial state without changing configuration or replacing paths', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nim-initialize-state-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { configPath, configText, database, passwordHash } = await fixture(directory);

  await execFileAsync(process.execPath, ['scripts/initialize-state.mjs', configPath], { cwd: process.cwd() });
  assert.equal(readFileSync(configPath, 'utf8'), configText);
  assert.equal(lstatSync(database).isFile(), true);
  if (process.platform !== 'win32') assert.equal(statSync(database).mode & 0o777, 0o640);

  const state = new DatabaseSync(database, { readOnly: true, allowExtension: false });
  assert.equal(state.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual({ ...state.prepare('SELECT username,password_hash,totp_enabled FROM admin_account WHERE id=1').get() }, {
    username: 'recovered-admin', password_hash: passwordHash, totp_enabled: 0,
  });
  assert.equal(state.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='installation.state_initialized'").get().count, 1);
  state.close();

  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/initialize-state.mjs', configPath], { cwd: process.cwd() }),
    /state database path already exists/,
  );
});

test('interrupted-install recovery refuses a dangling database symlink', { skip: process.platform === 'win32' }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nim-initialize-state-link-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { configPath, database } = await fixture(directory);
  symlinkSync(join(directory, 'missing-target.db'), database);

  await assert.rejects(
    execFileAsync(process.execPath, ['scripts/initialize-state.mjs', configPath], { cwd: process.cwd() }),
    /state database path already exists/,
  );
  assert.equal(lstatSync(database).isSymbolicLink(), true);
});
