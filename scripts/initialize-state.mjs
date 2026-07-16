import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadConfig, ensureStateDirectory } from '../src/config.mjs';
import { Store } from '../src/lib/store.mjs';

const configArg = process.argv[2];
if (!configArg) {
  process.stderr.write('usage: initialize-state.mjs CONFIG_PATH\n');
  process.exit(2);
}

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const { config } = loadConfig(configArg);
const databasePath = config.storage.database;
if (databasePath === ':memory:') throw new Error('managed state initialization requires a filesystem database');
if (pathEntryExists(databasePath)) throw new Error('state database path already exists; refusing to initialize or replace it');

ensureStateDirectory(config);
const temporaryDirectory = mkdtempSync(join(dirname(databasePath), '.state-initialize-'));
const temporaryDatabase = join(temporaryDirectory, 'state.db');
let store;

try {
  store = new Store(temporaryDatabase);
  store.ensureAdminAccount(config.admin.username, config.admin.passwordHash);
  store.audit('installer', 'installation.state_initialized', 'installation', 'native', 'Initialized missing state after explicit interrupted-install recovery approval');
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const integrity = store.db.prepare('PRAGMA quick_check').get().quick_check;
  if (integrity !== 'ok') throw new Error(`initialized database integrity check failed: ${integrity}`);
  store.close();
  store = undefined;

  if (existsSync(`${temporaryDatabase}-wal`) || existsSync(`${temporaryDatabase}-shm`)) {
    throw new Error('initialized database retained unexpected SQLite sidecar files');
  }
  chmodSync(temporaryDatabase, 0o640);
  linkSync(temporaryDatabase, databasePath);
  unlinkSync(temporaryDatabase);
  process.stdout.write(`${databasePath}\n`);
} catch (error) {
  if (error?.code === 'EEXIST') throw new Error('state database appeared during initialization; refusing to replace it');
  throw error;
} finally {
  try { store?.close(); } catch { /* preserve the original failure */ }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
