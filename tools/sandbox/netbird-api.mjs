import http from 'node:http';

let mode = 'normal';
const peers = [
  { id: 'peer-online', name: 'sandbox-app', hostname: 'fake-upstream', ip: '172.20.0.10', ipv6: '', dns_label: 'fake-upstream.sandbox.invalid', connected: true, last_seen: '2026-07-16T00:00:00Z', os: 'Linux', version: '0.0.0-test', accessible_peers_count: 1, unknown: 'ignored' },
  { id: 'peer-offline', name: 'offline-peer', ip: '100.64.0.99', connected: false, os: 'Linux' },
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fake-netbird-api');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/control/mode' && req.method === 'POST') { mode = url.searchParams.get('value') || 'normal'; res.writeHead(204); res.end(); return; }
  if (req.headers.authorization !== 'Token fake-netbird-token-only') { res.writeHead(401); res.end(); return; }
  if (mode === 'unavailable') { res.writeHead(503); res.end(); return; }
  if (mode === 'unauthorized') { res.writeHead(403); res.end(); return; }
  if (mode === 'rate-limit') { res.writeHead(429, { 'retry-after': '1' }); res.end(); return; }
  if (mode === 'timeout') { setTimeout(() => { if (!res.destroyed) res.end('late'); }, 15_000); return; }
  if (mode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{bad json'); return; }
  if (mode === 'incompatible') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"peers":[]}'); return; }
  if (url.pathname === '/api/peers') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(peers)); return; }
  if (url.pathname === '/api/reverse-proxies/clusters') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify([{ address: 'sandbox.proxy.invalid', type: 'account', online: true, features: ['private'], unknown: 'ignored' }])); return; }
  res.writeHead(404); res.end();
});
server.listen(8082, '0.0.0.0');
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
