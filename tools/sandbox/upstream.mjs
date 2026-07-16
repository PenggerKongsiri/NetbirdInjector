import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { gzipSync } from 'node:zlib';

const html = '<!doctype html><html><head><title>Sandbox</title></head><body><h1>Sandbox application</h1></body></html>';
const media = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

function handler(req, res) {
  const url = new URL(req.url, 'http://upstream.test');
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: 'sandbox-etag' }); res.end(html); return; }
  if (url.pathname === '/uppercase') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<HTML><HEAD><TITLE>Upper</TITLE></HEAD><BODY>Upper</BODY></HTML>'); return; }
  if (url.pathname === '/misleading') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head><script>const fake="</head>";</script><style>.x:after{content:"</head>"}</style></head><body>safe</body></html>'); return; }
  if (url.pathname === '/malformed') { res.writeHead(200, { 'content-type': 'text/html', etag: 'malformed-etag' }); res.end('<html><body><!-- unterminated'); return; }
  if (url.pathname === '/excluded/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  if (url.pathname === '/json' || url.pathname === '/api/status') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (url.pathname === '/xml') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<ok>true</ok>'); return; }
  if (url.pathname === '/image') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(media); return; }
  if (url.pathname === '/pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.4\n%sandbox'); return; }
  if (url.pathname === '/audio') { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(media); return; }
  if (url.pathname === '/video') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(media); return; }
  if (url.pathname === '/binary') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(media); return; }
  if (url.pathname === '/attachment') { res.writeHead(200, { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="page.html"' }); res.end(html); return; }
  if (url.pathname === '/redirect') { res.writeHead(302, { location: 'http://internal.test.invalid/target' }); res.end(); return; }
  if (url.pathname === '/cookie') { res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/; HttpOnly', 'b=2; Path=/; SameSite=Lax'] }); res.end(JSON.stringify({ cookie: req.headers.cookie ?? '' })); return; }
  if (url.pathname === '/headers') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(req.headers)); return; }
  if (url.pathname === '/gzip') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(gzipSync(html)); return; }
  if (url.pathname === '/bad-gzip') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end('not-gzip'); return; }
  if (url.pathname === '/bomb') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(gzipSync(`<html><head></head><body>${'a'.repeat(100_000)}</body></html>`)); return; }
  if (url.pathname === '/exact-limit') { const body = `<html><head></head><body>${'x'.repeat(4057)}</body></html>`; res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body), etag: 'exact-limit' }); res.end(body); return; }
  if (url.pathname === '/above-limit') { const body = `<html><head></head><body>${'x'.repeat(4058)}</body></html>`; res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body), etag: 'above-limit' }); res.end(body); return; }
  if (url.pathname === '/range') {
    const body = Buffer.from('0123456789');
    if (req.headers.range === 'bytes=2-5') { res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': 'bytes 2-5/10', 'content-length': 4 }); res.end(body.subarray(2, 6)); }
    else { res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': body.length }); res.end(body); }
    return;
  }
  if (url.pathname === '/large') { const body = Buffer.alloc(1_048_576, 0x5a); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }); res.end(body); return; }
  if (url.pathname === '/chunked') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.write('chunk-1'); setTimeout(() => res.end('-chunk-2'), 10); return; }
  if (url.pathname === '/sse') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.end('data: sandbox\n\n'); return; }
  if (url.pathname === '/stream') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); const timer = setInterval(() => res.write('stream\n'), 100); req.on('close', () => clearInterval(timer)); return; }
  if (url.pathname === '/slow') { setTimeout(() => { if (!res.destroyed) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); } }, 2500); return; }
  if (url.pathname === '/failed') { res.writeHead(503, { 'content-type': 'text/plain' }); res.end('unavailable'); return; }
  if (url.pathname === '/interrupted') { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 100 }); res.write('short'); setImmediate(() => res.destroy()); return; }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ method: req.method, path: req.url, bytes: Buffer.concat(chunks).length })); });
}

const httpServer = http.createServer(handler);
const httpsServer = https.createServer({
  key: readFileSync(new URL('../../test/fixtures/tls/server-key.pem', import.meta.url)),
  cert: readFileSync(new URL('../../test/fixtures/tls/server.pem', import.meta.url)), minVersion: 'TLSv1.2',
}, handler);
for (const server of [httpServer, httpsServer]) server.on('upgrade', (_req, socket) => { socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); socket.pipe(socket); });
httpServer.listen(8081, '0.0.0.0');
httpsServer.listen(8443, '0.0.0.0');
const shutdown = () => { httpServer.closeAllConnections(); httpsServer.closeAllConnections(); httpServer.close(); httpsServer.close(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
