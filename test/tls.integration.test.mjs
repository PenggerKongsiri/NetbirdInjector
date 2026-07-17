import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import test from 'node:test';
import { defaultRoute, validateRoute } from '../src/lib/model.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { probeRoute } from '../src/proxy.mjs';

const ca = readFileSync(new URL('./fixtures/tls/ca.pem', import.meta.url), 'utf8');
const cert = readFileSync(new URL('./fixtures/tls/server.pem', import.meta.url), 'utf8');
const key = readFileSync(new URL('./fixtures/tls/server-key.pem', import.meta.url), 'utf8');

test('HTTPS health checks enforce custom CA and SNI', async (t) => {
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (_req, res) => { res.writeHead(200); res.end('ok'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const policy = new NetworkPolicy({ allowedTargetCidrs: ['127.0.0.1/32'], trustedIngressCidrs: [], allowedPorts: [port] });
  const route = defaultRoute();
  route.hostname = 'tls-route.example.com'; route.enabled = true;
  route.upstream.protocol = 'https'; route.upstream.host = '127.0.0.1'; route.upstream.port = port;
  route.upstream.serverName = 'upstream.test'; route.upstream.caPem = ca; route.health.expectedStatuses = [200];
  const validated = validateRoute(route, policy);
  assert.equal((await probeRoute(validated, policy)).ok, true);
  validated.upstream.serverName = 'wrong.test';
  const wrongSni = await probeRoute(validated, policy);
  assert.equal(wrongSni.ok, false);
  assert.match(wrongSni.error, /name|altname|certificate/i);
  validated.upstream.serverName = 'upstream.test'; validated.upstream.caPem = '';
  const unknownCa = await probeRoute(validated, policy);
  assert.equal(unknownCa.ok, false);
  assert.match(unknownCa.error, /certificate|issuer|self-signed/i);
  validated.upstream.serverName = 'wrong.test'; validated.upstream.tlsVerify = false;
  const explicitlyUnverified = await probeRoute(validated, policy);
  assert.equal(explicitlyUnverified.ok, true);
  assert.equal(explicitlyUnverified.status, 200);
});
