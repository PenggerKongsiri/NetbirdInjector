import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';

if (process.env.NODE_TEST_CONTEXT) process.exit(0);

function request(path, { host = 'html.test.invalid', method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    const req = http.request({ hostname: 'fake-public-proxy', port: 8080, path, method, headers: { host, connection: 'close', ...(payload ? { 'content-length': payload.length } : {}), ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

function admin(path, { method = 'GET', body, cookie, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { connection: 'close', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const req = http.request({ hostname: 'injector', port: 9090, path, method, headers, agent: false }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

async function websocket() {
  const socket = net.connect(8080, 'fake-public-proxy');
  let received = '';
  socket.setEncoding('utf8'); socket.on('data', (chunk) => { received += chunk; });
  socket.write('GET /socket HTTP/1.1\r\nHost: websocket.test.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('WebSocket upgrade timeout')), 2000); const interval = setInterval(() => { if (received.includes('\r\n\r\n')) { clearTimeout(timeout); clearInterval(interval); resolve(); } }, 10); });
  assert.match(received, /^HTTP\/1\.1 101/);
  received = ''; socket.write('sandbox-websocket');
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('WebSocket echo timeout')), 2000); const interval = setInterval(() => { if (received.includes('sandbox-websocket')) { clearTimeout(timeout); clearInterval(interval); resolve(); } }, 10); });
  socket.destroy();
}

const afterRestart = process.argv.includes('--after-restart');
const html = await request('/html');
assert.equal(html.status, 200); assert.match(html.body.toString(), /analytics\.test\.invalid/); assert.equal((html.body.toString().match(/nim:route_/g) ?? []).length, 2); assert.equal(html.headers.etag, undefined);
for (const path of ['/uppercase', '/misleading']) assert.match((await request(path)).body.toString(), /analytics\.test\.invalid/);
const malformed = await request('/malformed'); assert.doesNotMatch(malformed.body.toString(), /analytics/); assert.equal(malformed.headers.etag, 'malformed-etag');
assert.doesNotMatch((await request('/excluded/page')).body.toString(), /analytics/);
assert.equal((await request('/json', { host: 'api.test.invalid' })).body.toString(), '{"ok":true}');
assert.equal((await request('/xml')).body.toString(), '<ok>true</ok>');
for (const path of ['/image', '/pdf', '/audio', '/video', '/binary', '/attachment']) assert.doesNotMatch((await request(path, { host: 'files.test.invalid' })).body.toString(), /analytics/);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) { const response = await request('/echo?x=1', { host: 'api.test.invalid', method, body: 'payload' }); assert.equal(JSON.parse(response.body).method, method); }
const redirect = await request('/redirect'); assert.equal(redirect.status, 302); assert.equal(redirect.headers.location, 'http://internal.test.invalid/target');
const cookie = await request('/cookie', { host: 'api.test.invalid', headers: { cookie: 'client=value' } }); assert.equal(JSON.parse(cookie.body).cookie, 'client=value'); assert.equal(cookie.headers['set-cookie'].length, 2);
const forwarded = JSON.parse((await request('/headers', { host: 'api.test.invalid' })).body); assert.equal(forwarded['x-real-ip'], '203.0.113.10'); assert.equal(forwarded['x-forwarded-proto'], 'https'); assert.equal(forwarded['x-netbird-user'], 'sandbox-user@example.invalid');
const range = await request('/range', { host: 'files.test.invalid', headers: { range: 'bytes=2-5' } }); assert.equal(range.status, 206); assert.equal(range.body.toString(), '2345');
assert.equal((await request('/large', { host: 'files.test.invalid' })).body.length, 1_048_576);
assert.equal((await request('/chunked', { host: 'files.test.invalid' })).body.toString(), 'chunk-1-chunk-2');
assert.equal((await request('/sse', { host: 'sse.test.invalid' })).body.toString(), 'data: sandbox\n\n');
const gzip = await request('/gzip'); assert.match(gunzipSync(gzip.body).toString(), /analytics\.test\.invalid/);
assert.equal((await request('/bad-gzip')).body.toString(), 'not-gzip');
assert.doesNotMatch(gunzipSync((await request('/bomb')).body).toString(), /analytics/);
for (const path of ['/exact-limit', '/above-limit']) { const response = await request(path); assert.doesNotMatch(response.body.toString(), /analytics/); assert.ok(response.headers.etag); assert.equal(Number(response.headers['content-length']), response.body.length); }
assert.match((await request('/html', { host: 'secure.test.invalid' })).body.toString(), /analytics\.test\.invalid/);
assert.equal((await request('/html', { host: 'unknown.test.invalid' })).status, 421);
assert.equal((await request('/slow')).status, 502); assert.equal((await request('/failed')).status, 503);
await websocket();

if (!afterRestart) {
  const login = await admin('/api/login', { method: 'POST', body: { username: 'admin', password: 'sandbox-admin-password-only' } });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers['set-cookie'][0].split(';')[0];
  const csrf = login.json().csrf;
  assert.equal((await admin('/api/peers', { cookie: cookieHeader })).json().peers.length, 2);
  const routes = (await admin('/api/routes', { cookie: cookieHeader })).json();
  const route = routes.find((entry) => entry.hostname === 'html.test.invalid');
  const candidate = structuredClone(route.active.config); delete candidate.resolvedProfileItems; delete candidate.resolvedProfiles; candidate.notes = 'sandbox route reload';
  const draft = (await admin('/api/routes/draft', { method: 'POST', cookie: cookieHeader, csrf, body: { route: candidate } })).json();
  assert.equal((await admin(`/api/routes/${route.id}/activate`, { method: 'POST', cookie: cookieHeader, csrf, body: { versionId: draft.versionId } })).status, 200);
  await fetch('http://fake-netbird-api:8082/control/mode?value=unavailable', { method: 'POST' });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.notEqual((await admin('/api/peers', { cookie: cookieHeader })).status, 200);
  assert.match((await request('/html')).body.toString(), /analytics\.test\.invalid/);
  await fetch('http://fake-netbird-api:8082/control/mode?value=normal', { method: 'POST' });
}

process.stdout.write(`sandbox integration PASS${afterRestart ? ' after restart' : ''}\n`);
