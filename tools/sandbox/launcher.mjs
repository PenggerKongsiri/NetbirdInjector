import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../../src/config.mjs';
import { defaultRoute, validateRoute } from '../../src/lib/model.mjs';
import { NetworkPolicy } from '../../src/lib/network.mjs';
import { Store } from '../../src/lib/store.mjs';

const { config } = loadConfig(process.env.NIM_CONFIG);
writeFileSync(config.netbird.tokenFile, 'fake-netbird-token-only\n', { mode: 0o600 });
chmodSync(config.netbird.tokenFile, 0o600);
const store = new Store(config.storage.database);
if (!store.listRoutes().length) {
  const policy = new NetworkPolicy(config.network);
  const caPem = readFileSync(new URL('../../test/fixtures/tls/ca.pem', import.meta.url), 'utf8');
  const definitions = [
    { hostname: 'html.test.invalid', mode: 'inject', protocol: 'http', port: 8081 },
    { hostname: 'api.test.invalid', mode: 'passthrough', protocol: 'http', port: 8081 },
    { hostname: 'files.test.invalid', mode: 'passthrough', protocol: 'http', port: 8081 },
    { hostname: 'websocket.test.invalid', mode: 'passthrough', protocol: 'http', port: 8081 },
    { hostname: 'sse.test.invalid', mode: 'passthrough', protocol: 'http', port: 8081 },
    { hostname: 'secure.test.invalid', mode: 'inject', protocol: 'https', port: 8443, serverName: 'upstream.test', caPem },
  ];
  for (const definition of definitions) {
    const route = defaultRoute();
    route.hostname = definition.hostname;
    route.enabled = true;
    route.mode = definition.mode;
    route.upstream = {
      ...route.upstream, protocol: definition.protocol, host: 'fake-upstream', port: definition.port,
      hostHeader: definition.hostname, serverName: definition.serverName ?? '', caPem: definition.caPem ?? '', tlsVerify: true,
    };
    route.timeouts = { connectMs: 1000, responseMs: 1500, idleMs: 5000 };
    route.health = { enabled: true, path: '/health', method: 'GET', expectedStatuses: [200] };
    route.response.maxInjectBytes = 4096;
    route.excludedPaths = ['/api/*', '/excluded/*'];
    route.injections = definition.mode === 'inject' ? [{
      name: 'Sandbox analytics', enabled: true, type: 'external-script', url: 'https://analytics.test.invalid/script.js',
      location: 'head-end', priority: 10, attributes: { defer: true },
    }] : [];
    const valid = validateRoute(route, policy);
    const draft = store.saveDraft(valid, 'sandbox-seed');
    store.activate(valid.id, draft.versionId, valid, 'sandbox-seed');
  }
}
store.close();
await import('../../src/main.mjs');
