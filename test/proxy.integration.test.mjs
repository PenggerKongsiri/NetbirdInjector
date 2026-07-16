import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { defaultRoute, validateRoute } from '../src/lib/model.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { Store } from '../src/lib/store.mjs';
import { createProxy } from '../src/proxy.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const nearLimitHtml = `<html><head></head><body>${'x'.repeat(3970)}</body></html>`;

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: options.method || 'GET',
      agent: false,
      headers: { host: options.host || 'app.example.com', connection: 'close', ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let response = '';
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('raw request timeout')); }, 1000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.includes('\r\n\r\n')) { clearTimeout(timeout); socket.destroy(); resolve(response); }
    });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
    socket.on('close', () => { if (response && !response.includes('\r\n\r\n')) { clearTimeout(timeout); resolve(response); } });
  });
}

async function fixture({ trustedIngress = false } = {}) {
  const sockets = new Set();
  const upstream = http.createServer((req, res) => {
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: 'upstream-etag' });
      res.end('<!doctype html><html><head><title>T</title></head><body><h1>Hello</h1></body></html>');
      return;
    }
    if (req.url === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync('<html><head></head><body>Compressed</body></html>'));
      return;
    }
    if (req.url === '/bomb') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync(`<html><head></head><body>${'a'.repeat(100_000)}</body></html>`));
      return;
    }
    if (req.url === '/near-limit') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(nearLimitHtml), etag: 'near-limit-etag' });
      res.end(nearLimitHtml);
      return;
    }
    if (req.url === '/bom') {
      const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<html><head></head><body>BOM</body></html>')]);
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': body.length });
      res.end(body);
      return;
    }
    if (req.url === '/legacy') {
      res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
      res.end(Buffer.concat([Buffer.from('<html><head></head><body>'), Buffer.from([0xe9]), Buffer.from('</body></html>')]));
      return;
    }
    if (req.url === '/csp') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" });
      res.end('<html><head></head><body>CSP</body></html>');
      return;
    }
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '11' }); res.end('{"ok":true}'); return;
    }
    if (req.url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: hello\n\n'); return;
    }
    if (req.url === '/download') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="x.html"' }); res.end('<html><body>download</body></html>'); return;
    }
    if (req.url === '/range') {
      res.writeHead(206, { 'content-type': 'text/html', 'content-range': 'bytes 0-4/10' }); res.end('hello'); return;
    }
    if (req.url === '/headers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        netbirdUser: req.headers['x-netbird-user'] || null,
        forwardedFor: req.headers['x-forwarded-for'], forwardedHost: req.headers['x-forwarded-host'],
        forwardedProto: req.headers['x-forwarded-proto'], forwardedPort: req.headers['x-forwarded-port'],
        forwarded: req.headers.forwarded, realIp: req.headers['x-real-ip'], requestId: req.headers['x-request-id'],
        removed: req.headers['x-remove'] || null, host: req.headers.host,
      }));
      return;
    }
    if (req.url === '/upload') {
      let size = 0; req.on('data', (chunk) => { size += chunk.length; }); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ size })); }); return;
    }
    if (req.url === '/slow') {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>slow</body></html>'); }, 300); return;
    }
    if (req.url === '/truncated') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 100 });
      res.write('short');
      setImmediate(() => res.destroy());
      return;
    }
    res.writeHead(404); res.end();
  });
  upstream.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  upstream.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Connection: keep-alive\r\n\r\n');
    socket.on('data', (data) => socket.write(data));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamPort = upstream.address().port;
  const policy = new NetworkPolicy({
    allowedTargetCidrs: ['127.0.0.1/32'],
    trustedIngressCidrs: trustedIngress ? ['127.0.0.1/32'] : ['100.64.0.0/10'],
    allowedPorts: [upstreamPort],
  });
  const route = defaultRoute();
  route.hostname = 'app.example.com'; route.enabled = true; route.mode = 'inject';
  route.upstream.host = '127.0.0.1'; route.upstream.port = upstreamPort; route.upstream.hostHeader = 'internal.test';
  route.response.maxInjectBytes = 4096;
  route.timeouts.responseMs = 100;
  route.injections = [{ name: 'Test analytics', type: 'external-script', enabled: true, url: 'https://analytics.example/script.js', location: 'head-end', priority: 10, attributes: { defer: true } }];
  const validated = validateRoute(route, policy);
  const store = new Store(':memory:');
  const draft = store.saveDraft(validated); store.activate(validated.id, draft.versionId, validated);
  const config = { proxy: { maxHeaderBytes: 16384, maxRequestBytes: 1024, externalProtocol: 'https' } };
  const proxy = createProxy({ store, config, networkPolicy: policy, logger });
  proxy.server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
  const proxyPort = proxy.server.address().port;
  return { upstream, upstreamPort, store, proxy, proxyPort, sockets };
}

function cleanup(fixtureValue) {
  for (const socket of fixtureValue.sockets) socket.destroy();
  fixtureValue.proxy.server.close();
  fixtureValue.upstream.close();
  fixtureValue.store.close();
}

test('proxy safely routes, injects HTML, and passes other traffic unchanged', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const html = await request(f.proxyPort, '/html');
  assert.equal(html.status, 200);
  assert.match(html.body.toString(), /analytics\.example\/script\.js/);
  assert.equal((html.body.toString().match(/nim:route_/g) || []).length, 2);
  assert.equal(html.headers.etag, undefined);

  const json = await request(f.proxyPort, '/json');
  assert.equal(json.body.toString(), '{"ok":true}');
  assert.equal(json.headers['content-length'], '11');
  const sse = await request(f.proxyPort, '/sse');
  assert.equal(sse.body.toString(), 'data: hello\n\n');
  const download = await request(f.proxyPort, '/download');
  assert.doesNotMatch(download.body.toString(), /analytics/);
  const range = await request(f.proxyPort, '/range', { headers: { range: 'bytes=0-4' } });
  assert.equal(range.status, 206); assert.equal(range.body.toString(), 'hello');
  const ignoredRange = await request(f.proxyPort, '/html', { headers: { range: 'bytes=0-4' } });
  assert.doesNotMatch(ignoredRange.body.toString(), /analytics/);
});

test('proxy injects gzip within bounds and skips CSP without weakening it', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const gzip = await request(f.proxyPort, '/gzip');
  assert.match(gunzipSync(gzip.body).toString(), /analytics\.example/);
  const csp = await request(f.proxyPort, '/csp');
  assert.equal(csp.headers['content-security-policy'], "script-src 'self'");
  assert.doesNotMatch(csp.body.toString(), /analytics/);
  const bomb = await request(f.proxyPort, '/bomb');
  assert.doesNotMatch(gunzipSync(bomb.body).toString(), /analytics/);
  const legacy = await request(f.proxyPort, '/legacy');
  assert.equal(legacy.body.includes(Buffer.from([0xe9])), true);
  assert.equal(legacy.body.includes(Buffer.from('analytics')), false);
  const nearLimit = await request(f.proxyPort, '/near-limit');
  assert.equal(nearLimit.body.toString(), nearLimitHtml);
  assert.doesNotMatch(nearLimit.body.toString(), /analytics/);
  assert.equal(nearLimit.headers['content-length'], String(Buffer.byteLength(nearLimitHtml)));
  assert.equal(nearLimit.headers.etag, 'near-limit-etag');
  const bom = await request(f.proxyPort, '/bom');
  assert.deepEqual([...bom.body.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(bom.body.subarray(3).toString(), /analytics/);
});

test('unknown hosts fail closed and spoofed identity headers are stripped', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const unknown = await request(f.proxyPort, '/html', { host: 'unknown.example.com' });
  assert.equal(unknown.status, 421);
  const response = await request(f.proxyPort, '/headers', { headers: {
    'x-netbird-user': 'attacker@example.com', 'x-forwarded-for': '1.2.3.4', 'x-forwarded-proto': 'http',
    'x-forwarded-port': '1234', 'x-real-ip': '5.6.7.8', forwarded: 'for=5.6.7.8', 'x-request-id': 'attacker-id',
    connection: 'x-remove', 'x-remove': 'must-not-reach-upstream',
  } });
  const body = JSON.parse(response.body);
  assert.equal(body.netbirdUser, null);
  assert.equal(body.forwardedFor, '127.0.0.1');
  assert.equal(body.forwardedHost, 'app.example.com');
  assert.equal(body.forwardedProto, 'https');
  assert.equal(body.forwardedPort, '443');
  assert.equal(body.realIp, '127.0.0.1');
  assert.equal(body.forwarded, 'for=127.0.0.1;host="app.example.com";proto=https');
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(body.requestId, 'attacker-id');
  assert.equal(body.removed, null);
  assert.equal(body.host, 'internal.test');
  assert.match(await rawRequest(f.proxyPort, 'GET http://app.example.com/html HTTP/1.1\r\nHost: app.example.com\r\n\r\n'), /^HTTP\/1\.1 400/);
  assert.match(await rawRequest(f.proxyPort, 'CONNECT app.example.com:443 HTTP/1.1\r\nHost: app.example.com\r\n\r\n'), /^HTTP\/1\.1 405/);
  assert.equal((await request(f.proxyPort, '/html', { method: 'TRACE' })).status, 405);
  assert.match(await rawRequest(f.proxyPort, 'POST /upload HTTP/1.1\r\nHost: app.example.com\r\nContent-Length: 2048\r\nExpect: 100-continue\r\n\r\n'), /^HTTP\/1\.1 413/);
  assert.match(await rawRequest(f.proxyPort, 'GET /upgrade HTTP/1.1\r\nHost: app.example.com\r\nConnection: Upgrade\r\nUpgrade: h2c\r\n\r\n'), /^HTTP\/1\.1 400/);
});

test('trusted ingress forwarding metadata is bounded, validated, and rebuilt', async (t) => {
  const f = await fixture({ trustedIngress: true });
  t.after(() => cleanup(f));
  const response = await request(f.proxyPort, '/headers', { headers: {
    'x-netbird-user': 'user@example.com', 'x-forwarded-for': '203.0.113.8, 100.64.0.9',
    'x-forwarded-proto': 'http', 'x-forwarded-port': '8088', 'x-request-id': 'trusted-request-1',
  } });
  const body = JSON.parse(response.body);
  assert.equal(body.netbirdUser, 'user@example.com');
  assert.equal(body.forwardedFor, '203.0.113.8, 100.64.0.9, 127.0.0.1');
  assert.equal(body.forwardedProto, 'http');
  assert.equal(body.forwardedPort, '8088');
  assert.equal(body.realIp, '203.0.113.8');
  assert.equal(body.forwarded, 'for=203.0.113.8;host="app.example.com";proto=http');
  assert.equal(body.requestId, 'trusted-request-1');

  const malformed = await request(f.proxyPort, '/headers', { headers: { 'x-forwarded-for': 'not-an-ip', 'x-forwarded-port': '99999' } });
  const malformedBody = JSON.parse(malformed.body);
  assert.equal(malformedBody.forwardedFor, '127.0.0.1');
  assert.equal(malformedBody.forwardedPort, '443');
});

test('strict HTTP parsing rejects conflicting length framing', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const socket = net.connect(f.proxyPort, '127.0.0.1');
  t.after(() => socket.destroy());
  let response = '';
  socket.setEncoding('utf8'); socket.on('data', (chunk) => { response += chunk; });
  socket.write('POST /upload HTTP/1.1\r\nHost: app.example.com\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('parser rejection timeout')), 1000);
    socket.on('close', () => { clearTimeout(timeout); resolve(); });
  });
  assert.match(response, /^HTTP\/1\.1 400/);
});

test('strict listener rejects ambiguous hosts, duplicate lengths, malformed transfer coding, and control bytes', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const cases = [
    'GET /html HTTP/1.1\r\nHost: app.example.com\r\nHost: other.example.com\r\n\r\n',
    'POST /upload HTTP/1.1\r\nHost: app.example.com\r\nContent-Length: 4\r\nContent-Length: 4\r\n\r\ntest',
    'POST /upload HTTP/1.1\r\nHost: app.example.com\r\nContent-Length: 4\r\nContent-Length: 5\r\n\r\ntestx',
    'POST /upload HTTP/1.1\r\nHost: app.example.com\r\nTransfer-Encoding: chunked, identity\r\n\r\n0\r\n\r\n',
    'POST /upload HTTP/1.1\r\nHost: app.example.com\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\nbad\r\n0\r\n\r\n',
    'GET /html HTTP/1.1\r\nHost: app.example.com\r\nX-Bad: value\u0001more\r\n\r\n',
    'GET //other.example/html HTTP/1.1\r\nHost: app.example.com\r\n\r\n',
  ];
  for (const payload of cases) assert.match(await rawRequest(f.proxyPort, payload), /^HTTP\/1\.1 400/, payload.split('\r\n')[0]);
});

test('oversized uploads and slow upstreams fail safely', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const upload = await request(f.proxyPort, '/upload', { method: 'POST', body: Buffer.alloc(2048), headers: { 'content-length': '2048' } });
  assert.equal(upload.status, 413);
  const slow = await request(f.proxyPort, '/slow');
  assert.equal(slow.status, 502);
  await assert.rejects(request(f.proxyPort, '/truncated'), /aborted|reset|interrupted/i);
});

test('WebSocket upgrade is tunneled without injection', async (t) => {
  const f = await fixture();
  t.after(() => cleanup(f));
  const socket = net.connect(f.proxyPort, '127.0.0.1');
  t.after(() => socket.destroy());
  socket.write('GET /socket HTTP/1.1\r\nHost: app.example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => { received += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upgrade timeout')), 1000);
    const interval = setInterval(() => {
      if (received.includes('\r\n\r\n')) { clearTimeout(timeout); clearInterval(interval); resolve(); }
    }, 5);
  });
  assert.match(received, /^HTTP\/1\.1 101/);
  assert.doesNotMatch(received, /proxy-connection/i);
  received = '';
  socket.write('raw-websocket-bytes');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('echo timeout')), 1000);
    const interval = setInterval(() => {
      if (received.includes('raw-websocket-bytes')) { clearTimeout(timeout); clearInterval(interval); resolve(); }
    }, 5);
  });
  assert.match(received, /raw-websocket-bytes/);
});
