import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.mjs';

const [mode = 'create', configArg, destinationArg] = process.argv.slice(2);
if (!configArg || !destinationArg || !['create', 'verify'].includes(mode)) {
  process.stderr.write('usage: backup.mjs create|verify CONFIG_PATH BACKUP_DIRECTORY\n');
  process.exit(2);
}
const destination = resolve(destinationArg);
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (mode === 'create') {
  const { config, path: configPath } = loadConfig(configArg);
  if (config.storage.database === ':memory:') throw new Error('in-memory databases cannot be backed up');
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const configOutput = join(destination, 'config.json');
  const databaseOutput = join(destination, 'state.db');
  copyFileSync(configPath, configOutput);
  chmodSync(configOutput, 0o600);
  const source = new DatabaseSync(config.storage.database, { readOnly: true, allowExtension: false });
  await backup(source, databaseOutput);
  source.close();
  chmodSync(databaseOutput, 0o600);
  const manifest = {
    format: 'netbird-injector-manager-backup', version: 1, createdAt: new Date().toISOString(),
    files: { 'config.json': sha256(configOutput), 'state.db': sha256(databaseOutput) },
    excludes: ['NetBird API token file', 'external TLS/private keys'],
  };
  const manifestPath = join(destination, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${destination}\n`);
} else {
  const manifestPath = join(destination, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'netbird-injector-manager-backup' || manifest.version !== 1) throw new Error('unsupported backup manifest');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (basename(name) !== name) throw new Error('unsafe backup file name');
    const actual = sha256(join(destination, name));
    if (actual !== expected) throw new Error(`checksum mismatch for ${name}`);
  }
  const database = new DatabaseSync(join(destination, 'state.db'), { readOnly: true, allowExtension: false });
  const check = database.prepare('PRAGMA quick_check').get().quick_check;
  database.close();
  if (check !== 'ok') throw new Error(`backup database integrity check failed: ${check}`);
  JSON.parse(readFileSync(join(destination, 'config.json'), 'utf8'));
  process.stdout.write(`${destination}: verified\n`);
}
