import http from 'node:http';

function headers(req, websocket = false) {
  const result = { ...req.headers, 'x-forwarded-for': '203.0.113.10', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443', 'x-netbird-user': 'sandbox-user@example.invalid' };
  delete result.connection; delete result.upgrade;
  if (websocket) { result.connection = 'Upgrade'; result.upgrade = 'websocket'; }
  return result;
}

const server = http.createServer((req, res) => {
  if (req.url === '/__sandbox_health') { res.writeHead(200); res.end('ok'); return; }
  const upstream = http.request({ hostname: 'injector', port: 8080, method: req.method, path: req.url, headers: headers(req), agent: false }, (response) => {
    res.writeHead(response.statusCode, response.statusMessage, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = http.request({ hostname: 'injector', port: 8080, method: 'GET', path: req.url, headers: headers(req, true), agent: false });
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`, ...Object.entries(response.headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((entry) => `${name}: ${entry}`)), '', ''];
    socket.write(lines.join('\r\n'));
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on('response', (response) => { response.resume(); socket.end(`HTTP/1.1 ${response.statusCode} Bad Gateway\r\nConnection: close\r\n\r\n`); });
  upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
  upstream.end();
});
server.listen(8080, '0.0.0.0');
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
