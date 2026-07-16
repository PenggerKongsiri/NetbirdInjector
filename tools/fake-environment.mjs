import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin } from '../src/admin.mjs';
import { defaultRoute, validateRoute } from '../src/lib/model.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { hashPassword } from '../src/lib/security.mjs';
import { Store } from '../src/lib/store.mjs';
import { NetBirdClient } from '../src/netbird.mjs';
import { createProxy } from '../src/proxy.mjs';

const FAKE_PASSWORD = 'fake-admin-password-only';
const basePort = Number(process.argv[2] ?? 0);
if (!Number.isInteger(basePort) || basePort < 0 || basePort > 65000) throw new Error('optional base port must be from 1 to 65000');
const directory = mkdtempSync(join(tmpdir(), 'nim-environment-'));
const tokenFile = join(directory, 'netbird.token');
writeFileSync(tokenFile, 'fake-netbird-token-only\n', { mode: 0o600 });
chmodSync(tokenFile, 0o600);
const logger = { debug() {}, info(event, fields) { process.stdout.write(`${event} ${JSON.stringify(fields ?? {})}\n`); }, warn(event, fields) { process.stderr.write(`${event} ${JSON.stringify(fields ?? {})}\n`); }, error(event, fields) { process.stderr.write(`${event} ${JSON.stringify(fields ?? {})}\n`); } };

const upstream = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ fake: true, path: req.url })); return; }
  if (req.url === '/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: fake\n\n'); return; }
  if (req.url === '/download') { res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="fake.pdf"' }); res.end('%PDF-fake'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>Fake upstream</title></head><body><h1>Fake application</h1></body></html>');
});
upstream.on('upgrade', (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); socket.pipe(socket); });
upstream.listen(basePort ? basePort + 2 : 0, '127.0.0.1'); await once(upstream, 'listening');

const fakeApi = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Token fake-netbird-token-only') { res.writeHead(401); res.end(); return; }
  if (req.url === '/api/peers') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([
      { id: 'fake-online', name: 'fake-app-peer', hostname: 'fake-app', ip: '127.0.0.1', dns_label: 'fake-app.test', connected: true, last_seen: new Date().toISOString(), os: 'Fake Linux', version: '0.0.0' },
      { id: 'fake-offline', name: 'fake-offline-peer', hostname: 'offline', ip: '100.64.0.99', connected: false, last_seen: '2026-01-01T00:00:00Z', os: 'Fake Linux', version: '0.0.0' },
    ]));
  } else if (req.url === '/api/reverse-proxies/clusters') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ address: 'fake.proxy.invalid', type: 'account', online: true, features: ['private'] }])); }
  else { res.writeHead(404); res.end(); }
});
fakeApi.listen(basePort ? basePort + 3 : 0, '127.0.0.1'); await once(fakeApi, 'listening');

const upstreamPort = upstream.address().port;
const policy = new NetworkPolicy({ allowedTargetCidrs: ['127.0.0.1/32'], trustedIngressCidrs: [], allowedPorts: [upstreamPort] });
const store = new Store(join(directory, 'state.db'));
const route = defaultRoute();
route.hostname = 'fake-app.test'; route.enabled = true; route.mode = 'inject'; route.upstream.host = '127.0.0.1'; route.upstream.port = upstreamPort;
route.injections = [{ name: 'Fake analytics', type: 'inline-script', enabled: true, content: 'window.fakeAnalytics=true', location: 'head-end', priority: 0 }];
const validRoute = validateRoute(route, policy);
const draft = store.saveDraft(validRoute, 'fixture'); store.activate(validRoute.id, draft.versionId, validRoute, 'fixture');
const config = {
  proxy: { maxHeaderBytes: 16384, maxRequestBytes: 1_048_576, externalProtocol: 'http' },
  admin: { username: 'admin', passwordHash: await hashPassword(FAKE_PASSWORD), sessionMinutes: 30, cookieSecure: false },
  netbird: { mode: 'api' },
};
const netbird = new NetBirdClient({ mode: 'api', apiBaseUrl: `http://127.0.0.1:${fakeApi.address().port}`, tokenFile, cacheSeconds: 5, cliPath: join(directory, 'missing-netbird') }, logger);
const proxy = createProxy({ store, config, networkPolicy: policy, logger }); proxy.server.listen(basePort || 0, '127.0.0.1'); await once(proxy.server, 'listening');
const admin = createAdmin({ store, config, networkPolicy: policy, proxy, netbird, logger }); admin.server.listen(basePort ? basePort + 1 : 0, '127.0.0.1'); await once(admin.server, 'listening');

process.stdout.write(`\nFake environment ready (contains no real credentials):\n`);
process.stdout.write(`Admin UI: http://127.0.0.1:${admin.server.address().port}\n`);
process.stdout.write(`Admin password: ${FAKE_PASSWORD}\n`);
process.stdout.write(`Proxy test: curl -H "Host: fake-app.test" http://127.0.0.1:${proxy.server.address().port}/\n`);
process.stdout.write('Press Ctrl+C to stop.\n');

const shutdown = () => {
  admin.server.closeAllConnections(); proxy.server.closeAllConnections(); upstream.closeAllConnections(); fakeApi.closeAllConnections();
  admin.server.close(); proxy.server.close(); upstream.close(); fakeApi.close(); store.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
