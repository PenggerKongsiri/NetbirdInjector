import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createAdmin } from '../src/admin.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { hashPassword } from '../src/lib/security.mjs';
import { Store } from '../src/lib/store.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const proxy = { routeCount: () => 0, status: async () => ({ activeConnections: 0 }) };
const netbird = { localStatus: async () => ({ available: false }), peers: async () => [], clusters: async () => [] };
const networkPolicy = new NetworkPolicy({ allowedTargetCidrs: ['127.0.0.1/32'], trustedIngressCidrs: [], allowedPorts: [80] });

function call(client, port, path, { method = 'GET', body, ca } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { connection: 'close' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    const req = client.request({ hostname: '127.0.0.1', port, path, method, headers, ...(ca ? { ca, minVersion: 'TLSv1.2' } : {}), agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, encrypted: Boolean(res.socket.encrypted), body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('native admin TLS and private client CIDR enforcement work end to end', async (t) => {
  const password = 'a long password for the HTTPS admin test';
  const store = new Store(':memory:');
  const config = {
    admin: {
      username: 'admin', passwordHash: await hashPassword(password), sessionMinutes: 30, cookieSecure: true,
      allowedCidrs: ['127.0.0.0/8'], tlsCertFile: fileURLToPath(new URL('./fixtures/tls/server.pem', import.meta.url)),
      tlsKeyFile: fileURLToPath(new URL('./fixtures/tls/server-key.pem', import.meta.url)), listen: '127.0.0.1', port: 9090,
    },
    netbird: { mode: 'manual' },
  };
  const admin = createAdmin({ store, config, networkPolicy, proxy, netbird, logger });
  admin.server.listen(0, '127.0.0.1'); await once(admin.server, 'listening');
  const port = admin.server.address().port;
  t.after(() => { admin.server.closeAllConnections(); admin.server.close(); store.close(); });
  await assert.rejects(call(https, port, '/healthz'), /certificate|issuer|self-signed/i);
  const ca = readFileSync(fileURLToPath(new URL('./fixtures/tls/ca.pem', import.meta.url)));
  const health = await call(https, port, '/healthz', { ca });
  assert.equal(health.status, 200);
  assert.equal(health.encrypted, true);
  const login = await call(https, port, '/api/login', { method: 'POST', ca, body: { username: 'admin', password } });
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /; Secure/);

  const deniedStore = new Store(':memory:');
  const denied = createAdmin({
    store: deniedStore,
    config: { admin: { ...config.admin, cookieSecure: false, tlsCertFile: '', tlsKeyFile: '', allowedCidrs: ['10.0.0.0/8'] }, netbird: config.netbird },
    networkPolicy, proxy, netbird, logger,
  });
  denied.server.listen(0, '127.0.0.1'); await once(denied.server, 'listening');
  const deniedPort = denied.server.address().port;
  t.after(() => { denied.server.closeAllConnections(); denied.server.close(); deniedStore.close(); });
  const response = await call(http, deniedPort, '/healthz');
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(response.body).error, 'admin client address is not allowed');
});
