import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NetBirdClient } from '../src/netbird.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('fake NetBird API supplies bounded peer/cluster metadata and cached outages do not affect data', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nim-netbird-'));
  const tokenFile = join(directory, 'token');
  writeFileSync(tokenFile, 'fake-test-token\n', { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    assert.equal(req.headers.authorization, 'Token fake-test-token');
    if (req.url === '/management/api/peers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'peer1', name: 'app-peer', hostname: 'app', ip: '100.64.0.9', dns_label: 'app.example.netbird', connected: true, last_seen: '2026-07-15T00:00:00Z', os: 'Linux', version: '0.71.0', accessible_peers_count: 2, secret_field: 'must-not-leak' }]));
      return;
    }
    if (req.url === '/management/api/reverse-proxies/clusters') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ address: 'proxy.example.com', type: 'account', online: true, features: ['private'], token: 'must-not-leak' }]));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { if (server.listening) server.close(); rmSync(directory, { recursive: true, force: true }); });
  const client = new NetBirdClient({ mode: 'api', apiBaseUrl: `http://127.0.0.1:${server.address().port}/management`, tokenFile, cacheSeconds: 60, cliPath: join(directory, 'missing-netbird') }, logger);
  const peers = await client.peers();
  assert.deepEqual(Object.keys(peers[0]).sort(), ['accessiblePeersCount', 'connected', 'dnsName', 'hostname', 'id', 'ip', 'ipv6', 'lastSeen', 'name', 'os', 'version'].sort());
  assert.equal(JSON.stringify(peers).includes('must-not-leak'), false);
  const clusters = await client.clusters();
  assert.equal(JSON.stringify(clusters).includes('must-not-leak'), false);
  const before = requests;
  server.close(); await once(server, 'close');
  assert.equal((await client.peers())[0].id, 'peer1');
  assert.equal(requests, before);
  assert.equal((await client.localStatus()).available, false);
});
