import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { loadConfig } from '../src/config.mjs';
import { Store } from '../src/lib/store.mjs';

function probeService(config) {
  const tls = Boolean(config.admin.tlsCertFile);
  const client = tls ? https : http;
  const tlsOptions = tls ? { ca: readFileSync(config.admin.tlsCertFile), minVersion: 'TLSv1.2' } : {};
  return new Promise((resolve, reject) => {
    const request = client.request({
      host: config.admin.listen,
      port: config.admin.port,
      path: '/healthz',
      method: 'GET',
      ...tlsOptions,
      timeout: 2000,
    }, (response) => {
      response.resume();
      resolve({ ok: response.statusCode === 200, status: response.statusCode });
    });
    request.on('timeout', () => request.destroy(new Error('service health probe timed out')));
    request.on('error', reject);
    request.end();
  });
}

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
    result.checks.runningService = await probeService(loaded.config);
  } catch { result.checks.runningService = { ok: false }; }
} catch (error) {
  result.checks.configuration = { ok: false, error: error.message };
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
