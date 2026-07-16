import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/lib/store.mjs';

const configPath = process.argv[2] || process.env.NIM_CONFIG || './config/config.json';
const result = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, checks: {} };
try {
  const loaded = loadConfig(configPath);
  result.checks.configuration = { ok: true, path: loaded.path, adminLoopback: /^(127\.|::1$|localhost$)/.test(loaded.config.admin.listen) };
  result.checks.databaseFile = {
    exists: loaded.config.storage.database === ':memory:' || existsSync(loaded.config.storage.database),
    mode: loaded.config.storage.database !== ':memory:' && existsSync(loaded.config.storage.database) ? (statSync(loaded.config.storage.database).mode & 0o777).toString(8) : null,
  };
  const store = new Store(loaded.config.storage.database);
  result.checks.database = { ok: store.db.prepare('PRAGMA quick_check').get().quick_check === 'ok', activeRoutes: store.listActiveConfigs().length, routeRecords: store.listRoutes().length };
  store.close();
  try {
    const netbird = execFileSync(loaded.config.netbird.cliPath, ['status', '--json'], { timeout: 5000, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const status = JSON.parse(netbird);
    result.checks.netbirdCli = { ok: true, managementConnected: Boolean(status.management?.connected ?? status.management?.Connected) };
  } catch { result.checks.netbirdCli = { ok: false, optional: true }; }
  try {
    const response = await fetch(`http://${loaded.config.admin.listen}:${loaded.config.admin.port}/healthz`, { signal: AbortSignal.timeout(2000) });
    result.checks.runningService = { ok: response.ok, status: response.status };
  } catch { result.checks.runningService = { ok: false }; }
} catch (error) {
  result.checks.configuration = { ok: false, error: error.message };
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
