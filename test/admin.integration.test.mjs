import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';
import { createAdmin } from '../src/admin.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { hashPassword, totpCode } from '../src/lib/security.mjs';
import { Store } from '../src/lib/store.mjs';
import { createProxy } from '../src/proxy.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function httpCall(port, path, { method = 'GET', body, cookie, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { connection: 'close' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body: text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

test('admin login, CSRF, draft, health-gated activation, CSP, and export work end to end', async (t) => {
  const upstream = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><head></head><body>ok</body></html>'); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const port = upstream.address().port;
  const networkPolicy = new NetworkPolicy({ allowedTargetCidrs: ['127.0.0.1/32'], trustedIngressCidrs: [], allowedPorts: [port] });
  const store = new Store(':memory:');
  const config = {
    proxy: { maxHeaderBytes: 16384, maxRequestBytes: 1_048_576, externalProtocol: 'https' },
    admin: { username: 'admin', passwordHash: await hashPassword('a sufficiently long admin password'), sessionMinutes: 30, cookieSecure: false },
    netbird: { mode: 'manual' },
  };
  const proxy = createProxy({ store, config, networkPolicy, logger });
  proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
  const netbird = { localStatus: async () => ({ available: false }), peers: async () => { throw new Error('manual mode'); }, clusters: async () => [] };
  const admin = createAdmin({ store, config, networkPolicy, proxy, netbird, logger });
  admin.server.listen(0, '127.0.0.1'); await once(admin.server, 'listening');
  const adminPort = admin.server.address().port;
  t.after(() => { admin.server.closeAllConnections(); proxy.server.closeAllConnections(); upstream.closeAllConnections(); admin.server.close(); proxy.server.close(); upstream.close(); store.close(); });

  const shell = await httpCall(adminPort, '/');
  assert.equal(shell.status, 200);
  assert.match(shell.headers['content-security-policy'], /script-src 'self'/);
  assert.doesNotMatch(shell.headers['content-security-policy'], /unsafe-inline/);
  assert.equal((await httpCall(adminPort, '/api/session')).status, 401);
  assert.equal((await httpCall(adminPort, '/api/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  const login = await httpCall(adminPort, '/api/login', { method: 'POST', body: { username: 'admin', password: 'a sufficiently long admin password' } });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const csrf = login.json().csrf;
  const runtimeStatus = (await httpCall(adminPort, '/api/status', { cookie })).json();
  assert.equal(runtimeStatus.status, 'ok');
  assert.equal(typeof runtimeStatus.runtime.proxy.activeConnections, 'number');
  assert.equal(typeof runtimeStatus.runtime.memory.rss, 'number');
  assert.equal(typeof runtimeStatus.runtime.cpu.user, 'number');
  assert.equal(typeof runtimeStatus.runtime.activeResources, 'object');
  const umamiSnippet = '<script defer src="https://analytics.example/script.js" data-website-id="site-one"></script><script defer src="https://analytics.example/recorder.js" data-website-id="site-one"></script>';
  assert.equal((await httpCall(adminPort, '/api/profiles/umami/parse', { method: 'POST', cookie, body: { snippet: umamiSnippet } })).status, 403);
  const parsedUmami = await httpCall(adminPort, '/api/profiles/umami/parse', { method: 'POST', cookie, csrf, body: { snippet: umamiSnippet } });
  assert.equal(parsedUmami.status, 200);
  assert.deepEqual(parsedUmami.json(), {
    websiteId: 'site-one', analytics: true, recorder: true,
    analyticsUrl: 'https://analytics.example/script.js', recorderUrl: 'https://analytics.example/recorder.js',
  });
  const unsafeUmami = await httpCall(adminPort, '/api/profiles/umami/parse', {
    method: 'POST', cookie, csrf,
    body: { snippet: '<script src="https://analytics.example/script.js" data-website-id="site-one">alert(1)</script>' },
  });
  assert.equal(unsafeUmami.status, 400);
  assert.match(unsafeUmami.json().error, /must not contain inline JavaScript/);
  const template = (await httpCall(adminPort, '/api/routes/template', { cookie })).json();
  template.hostname = 'admin-test.example.com'; template.enabled = true; template.mode = 'inject';
  template.upstream.host = '127.0.0.1'; template.upstream.port = port;
  template.injections = [{ name: 'Test', type: 'inline-style', enabled: true, content: 'body{color:red}', location: 'head-end', priority: 0 }];
  assert.equal((await httpCall(adminPort, '/api/routes/draft', { method: 'POST', cookie, body: { route: template } })).status, 403);
  const draftResponse = await httpCall(adminPort, '/api/routes/draft', { method: 'POST', cookie, csrf, body: { route: template } });
  assert.equal(draftResponse.status, 201);
  const draft = draftResponse.json();
  const activate = await httpCall(adminPort, `/api/routes/${template.id}/activate`, { method: 'POST', cookie, csrf, body: { versionId: draft.versionId } });
  assert.equal(activate.status, 200);
  assert.equal(proxy.routeCount(), 1);
  const disable = await httpCall(adminPort, `/api/routes/${template.id}/enabled`, { method: 'POST', cookie, csrf, body: { enabled: false } });
  assert.equal(disable.status, 200);
  assert.equal(proxy.routeCount(), 0);
  const enable = await httpCall(adminPort, `/api/routes/${template.id}/enabled`, { method: 'POST', cookie, csrf, body: { enabled: true } });
  assert.equal(enable.status, 200);
  assert.equal(proxy.routeCount(), 1);
  const preview = await httpCall(adminPort, '/api/preview', { method: 'POST', cookie, csrf, body: { route: template, html: '<html><head></head><body>x</body></html>', headers: { 'content-type': 'text/html', 'content-security-policy': "style-src 'self'" }, path: '/', method: 'GET', status: 200 } });
  assert.equal(preview.status, 200);
  assert.equal(preview.json().modified, false);
  const exported = await httpCall(adminPort, '/api/export', { cookie });
  assert.equal(exported.json().routes.length, 1);
  assert.equal(exported.body.includes('a sufficiently long admin password'), false);
  const importRoute = structuredClone(template);
  importRoute.id = `route_${randomUUID()}`;
  importRoute.hostname = 'duplicate-import.example.com';
  const duplicateImport = await httpCall(adminPort, '/api/import', {
    method: 'POST', cookie, csrf,
    body: { format: 'netbird-injector-manager-export', version: 1, profiles: [], routes: [importRoute, structuredClone(importRoute)] },
  });
  assert.equal(duplicateImport.status, 400);
  assert.match(duplicateImport.json().error, /duplicate route or profile IDs/);
  assert.equal((await httpCall(adminPort, '/api/routes', { cookie })).json().length, 1);
});

test('administrator account supports TOTP, one-time recovery, credential changes, and session invalidation', async (t) => {
  const store = new Store(':memory:');
  const password = 'a second sufficiently long admin password';
  const config = {
    admin: { username: 'owner', passwordHash: await hashPassword(password), sessionMinutes: 30, cookieSecure: false, listen: '127.0.0.1', port: 9090 },
    netbird: { mode: 'manual' },
  };
  const proxy = { routeCount: () => 0, status: async () => ({ activeConnections: 0 }) };
  const netbird = { localStatus: async () => ({ available: false }), peers: async () => [], clusters: async () => [] };
  const networkPolicy = new NetworkPolicy({ allowedTargetCidrs: ['127.0.0.1/32'], trustedIngressCidrs: [], allowedPorts: [80] });
  const admin = createAdmin({ store, config, networkPolicy, proxy, netbird, logger });
  admin.server.listen(0, '127.0.0.1'); await once(admin.server, 'listening');
  const port = admin.server.address().port;
  t.after(() => { admin.server.closeAllConnections(); admin.server.close(); store.close(); });

  const login = await httpCall(port, '/api/login', { method: 'POST', body: { username: 'owner', password } });
  assert.equal(login.status, 200);
  let cookie = login.headers['set-cookie'][0].split(';')[0];
  let csrf = login.json().csrf;
  assert.equal((await httpCall(port, '/api/account', { cookie })).json().twoFactorEnabled, false);
  assert.equal((await httpCall(port, '/api/account/2fa/setup', { method: 'POST', cookie, body: { currentPassword: password } })).status, 403);
  const setup = await httpCall(port, '/api/account/2fa/setup', { method: 'POST', cookie, csrf, body: { currentPassword: password } });
  assert.equal(setup.status, 200);
  const secret = setup.json().secret;
  assert.match(setup.json().provisioningUri, /^otpauth:\/\/totp\//);
  assert.equal((await httpCall(port, '/api/account/2fa/enable', { method: 'POST', cookie, csrf, body: { code: '000000' } })).status, 400);
  const enabled = await httpCall(port, '/api/account/2fa/enable', { method: 'POST', cookie, csrf, body: { code: totpCode(secret) } });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.json().recoveryCodes.length, 10);
  const recoveryCode = enabled.json().recoveryCodes[0];
  await httpCall(port, '/api/logout', { method: 'POST', cookie, csrf });
  assert.equal((await httpCall(port, '/api/login', { method: 'POST', body: { username: 'owner', password } })).status, 401);
  const recovered = await httpCall(port, '/api/login', { method: 'POST', body: { username: 'owner', password, secondFactor: recoveryCode } });
  assert.equal(recovered.status, 200);
  cookie = recovered.headers['set-cookie'][0].split(';')[0]; csrf = recovered.json().csrf;
  await httpCall(port, '/api/logout', { method: 'POST', cookie, csrf });
  assert.equal((await httpCall(port, '/api/login', { method: 'POST', body: { username: 'owner', password, secondFactor: recoveryCode } })).status, 401);
  const totpLogin = await httpCall(port, '/api/login', { method: 'POST', body: { username: 'owner', password, secondFactor: totpCode(secret) } });
  assert.equal(totpLogin.status, 200);
  cookie = totpLogin.headers['set-cookie'][0].split(';')[0]; csrf = totpLogin.json().csrf;
  const replacementCodes = await httpCall(port, '/api/account/2fa/recovery-codes', { method: 'POST', cookie, csrf, body: { currentPassword: password, code: totpCode(secret) } });
  assert.equal(replacementCodes.status, 200);
  assert.equal(replacementCodes.json().recoveryCodes.length, 10);
  const changed = await httpCall(port, '/api/account/credentials', { method: 'POST', cookie, csrf, body: { currentPassword: password, username: 'new-owner', newPassword: 'an entirely new secure administrator password' } });
  assert.equal(changed.status, 200);
  assert.equal((await httpCall(port, '/api/session', { cookie })).status, 401);
  const changedLogin = await httpCall(port, '/api/login', { method: 'POST', body: { username: 'new-owner', password: 'an entirely new secure administrator password', secondFactor: totpCode(secret) } });
  assert.equal(changedLogin.status, 200);
  cookie = changedLogin.headers['set-cookie'][0].split(';')[0]; csrf = changedLogin.json().csrf;
  const disabled = await httpCall(port, '/api/account/2fa/disable', { method: 'POST', cookie, csrf, body: { currentPassword: 'an entirely new secure administrator password', code: totpCode(secret) } });
  assert.equal(disabled.status, 200);
  const noFactorLogin = await httpCall(port, '/api/login', { method: 'POST', body: { username: 'new-owner', password: 'an entirely new secure administrator password' } });
  assert.equal(noFactorLogin.status, 200);
  assert.ok(store.listAudit().some((event) => event.action === 'account.2fa_enabled'));
  assert.ok(store.listAudit().some((event) => event.action === 'account.credentials_changed'));
});
