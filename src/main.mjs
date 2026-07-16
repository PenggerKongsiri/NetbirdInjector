import { createAdmin } from './admin.mjs';
import { ensureStateDirectory, loadConfig } from './config.mjs';
import { createLogger } from './lib/logger.mjs';
import { NetworkPolicy } from './lib/network.mjs';
import { Store } from './lib/store.mjs';
import { NetBirdClient } from './netbird.mjs';
import { createProxy } from './proxy.mjs';
import { closeTrackedServers, trackServerConnections } from './lib/shutdown.mjs';

process.umask(0o027);

let store;
let proxyServer;
let adminServer;
let trackedServers = [];
let stopping = false;

async function main() {
  const { config, path } = loadConfig();
  const logger = createLogger(config.logging.level);
  ensureStateDirectory(config);
  const networkPolicy = new NetworkPolicy(config.network);
  store = new Store(config.storage.database);
  const netbird = new NetBirdClient(config.netbird, logger);
  const proxy = createProxy({ store, config, networkPolicy, logger });
  const admin = createAdmin({ store, config, networkPolicy, proxy, netbird, logger });
  proxyServer = proxy.server;
  adminServer = admin.server;
  trackedServers = [trackServerConnections(proxyServer), trackServerConnections(adminServer)];
  await Promise.all([
    new Promise((resolve, reject) => proxyServer.listen(config.proxy.port, config.proxy.listen, resolve).once('error', reject)),
    new Promise((resolve, reject) => adminServer.listen(config.admin.port, config.admin.listen, resolve).once('error', reject)),
  ]);
  logger.info('service.started', {
    configPath: path, proxyListen: `${config.proxy.listen}:${config.proxy.port}`, adminListen: `${config.admin.listen}:${config.admin.port}`,
  });
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'info', event: 'service.stopping', signal })}\n`);
  const result = await closeTrackedServers(trackedServers, { graceMs: 15_000 });
  store?.close();
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'info', event: 'service.stopped', forcedSockets: result.forcedSockets })}\n`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'service.fatal', reason: error.message })}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'service.fatal_rejection', reason: error?.message ?? String(error) })}\n`);
  process.exit(1);
});

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'service.start_failed', reason: error.message })}\n`);
  process.exit(1);
});
