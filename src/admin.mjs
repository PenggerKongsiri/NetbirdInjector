import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewInjection } from './lib/injection.mjs';
import { defaultRoute, validateProfile, validateRoute } from './lib/model.mjs';
import { addressInCidrs, parseCidr } from './lib/network.mjs';
import {
  ADMIN_SECURITY_HEADERS, generateRecoveryCodes, generateTotpSecret, hashPassword, hashRecoveryCode, LoginLimiter,
  normalizeAdminUsername, SessionManager, totpProvisioningUri, verifyPassword, verifyTotp,
} from './lib/security.mjs';
import { id, json, readJson, safeEqual, text } from './lib/util.mjs';
import { probeRoute } from './proxy.mjs';

const uiDirectory = fileURLToPath(new URL('./ui/', import.meta.url));
const staticTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function withSecurity(headers = {}) {
  return { ...ADMIN_SECURITY_HEADERS, ...headers };
}

function serveFile(res, name) {
  try {
    const body = readFileSync(join(uiDirectory, name));
    res.writeHead(200, withSecurity({ 'content-type': staticTypes[extname(name)] ?? 'application/octet-stream', 'content-length': body.length }));
    res.end(body);
  } catch {
    text(res, 404, 'Not Found\n', withSecurity());
  }
}

function requireAuth(req, res, sessions) {
  const session = sessions.get(req);
  if (!session) {
    json(res, 401, { error: 'authentication required' }, withSecurity());
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  if (req.headers['x-csrf-token'] !== session.csrf) {
    json(res, 403, { error: 'CSRF validation failed' }, withSecurity());
    return false;
  }
  return true;
}

function errorResponse(res, error) {
  const status = error.statusCode ?? (error.message.includes('not found') ? 404 : 400);
  json(res, status, { error: error.message }, withSecurity());
}

export function createAdmin({ store, config, networkPolicy, proxy, netbird, logger }) {
  const sessions = new SessionManager({ minutes: config.admin.sessionMinutes, secure: config.admin.cookieSecure });
  const limiter = new LoginLimiter();
  const startedAt = Date.now();
  const adminAllowedCidrs = (config.admin.allowedCidrs ?? ['127.0.0.0/8', '::1/128']).map(parseCidr);
  store.ensureAdminAccount(normalizeAdminUsername(config.admin.username ?? 'admin'), config.admin.passwordHash);

  const invalidCredentials = (res, key) => {
    limiter.failure(key);
    logger.warn('admin.login_failed', { remoteAddress: key });
    return json(res, 401, { error: 'invalid credentials' }, withSecurity());
  };

  const currentPasswordValid = async (body) => {
    const account = store.getAdminAccount();
    return account && await verifyPassword(body.currentPassword, account.passwordHash);
  };

  const secondFactorValid = (account, value, { recovery = true } = {}) => {
    if (!account?.totpEnabled || !account.totpSecret) return false;
    if (verifyTotp(account.totpSecret, value)) return true;
    return recovery && store.consumeAdminRecoveryCode(hashRecoveryCode(value));
  };

  const handler = async (req, res) => {
    const remoteAddress = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!addressInCidrs(remoteAddress, adminAllowedCidrs)) return json(res, 403, { error: 'admin client address is not allowed' }, withSecurity());
    const url = new URL(req.url, 'http://admin.local');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { status: 'ok' }, withSecurity());
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(res, 'index.html');
    if (req.method === 'GET' && url.pathname === '/app.js') return serveFile(res, 'app.js');
    if (req.method === 'GET' && url.pathname === '/app.css') return serveFile(res, 'app.css');

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const key = String(req.socket.remoteAddress ?? 'unknown');
      if (!limiter.allowed(key)) return json(res, 429, { error: 'too many login attempts; try again later' }, withSecurity({ 'retry-after': '900' }));
      try {
        const body = await readJson(req, 4096);
        const account = store.getAdminAccount();
        let username = '';
        try { username = normalizeAdminUsername(body.username); } catch { /* use a uniform credential failure */ }
        const passwordValid = await verifyPassword(body.password, account?.passwordHash);
        if (!account || !passwordValid || !safeEqual(username, account.username)) return invalidCredentials(res, key);
        if (account.totpEnabled && !secondFactorValid(account, body.secondFactor)) return invalidCredentials(res, key);
        limiter.success(key);
        const session = sessions.create(account.username);
        logger.info('admin.login_succeeded', { remoteAddress: key });
        return json(res, 200, { ok: true, csrf: session.csrf }, withSecurity({ 'set-cookie': sessions.cookie(session) }));
      } catch (error) {
        return errorResponse(res, error);
      }
    }

    const session = requireAuth(req, res, sessions);
    if (!session) return;
    if (!['GET', 'HEAD'].includes(req.method) && !requireCsrf(req, res, session)) return;

    try {
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        sessions.destroy(req);
        return json(res, 200, { ok: true }, withSecurity({ 'set-cookie': sessions.clearCookie() }));
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        const account = store.getAdminAccount();
        return json(res, 200, { authenticated: true, csrf: session.csrf, username: account.username, twoFactorEnabled: account.totpEnabled }, withSecurity());
      }
      if (req.method === 'GET' && url.pathname === '/api/account') {
        const account = store.getAdminAccount();
        return json(res, 200, {
          username: account.username, twoFactorEnabled: account.totpEnabled, recoveryCodesRemaining: account.recoveryCodeHashes.length,
          adminAccess: {
            protocol: config.admin.tlsCertFile ? 'https' : 'http', listen: config.admin.listen, port: config.admin.port,
            remoteEnabled: Boolean(config.admin.allowRemote), allowedCidrs: config.admin.allowedCidrs ?? ['127.0.0.0/8', '::1/128'],
          },
        }, withSecurity());
      }
      if (req.method === 'POST' && url.pathname === '/api/account/credentials') {
        const body = await readJson(req, 4096);
        if (!await currentPasswordValid(body)) return json(res, 401, { error: 'current password is incorrect' }, withSecurity());
        const account = store.getAdminAccount();
        const username = body.username === undefined || body.username === '' ? account.username : normalizeAdminUsername(body.username);
        const passwordHash = body.newPassword ? await hashPassword(body.newPassword) : account.passwordHash;
        if (username === account.username && passwordHash === account.passwordHash) throw new Error('enter a new username or password');
        store.updateAdminCredentials(username, passwordHash, account.username);
        sessions.destroyAll();
        return json(res, 200, { ok: true, reauthenticate: true }, withSecurity({ 'set-cookie': sessions.clearCookie() }));
      }
      if (req.method === 'POST' && url.pathname === '/api/account/2fa/setup') {
        const body = await readJson(req, 4096);
        if (!await currentPasswordValid(body)) return json(res, 401, { error: 'current password is incorrect' }, withSecurity());
        const account = store.getAdminAccount();
        if (account.totpEnabled) throw new Error('two-factor authentication is already enabled');
        const secret = generateTotpSecret();
        session.pendingTotp = { secret, expiresAt: Date.now() + 10 * 60_000 };
        return json(res, 200, { secret, provisioningUri: totpProvisioningUri(account.username, secret), expiresInSeconds: 600 }, withSecurity());
      }
      if (req.method === 'POST' && url.pathname === '/api/account/2fa/enable') {
        const body = await readJson(req, 4096);
        const pending = session.pendingTotp;
        if (!pending || pending.expiresAt <= Date.now()) throw new Error('two-factor setup expired; start again');
        if (!verifyTotp(pending.secret, body.code)) throw new Error('authenticator code is invalid');
        const recoveryCodes = generateRecoveryCodes();
        store.enableAdminTotp(pending.secret, recoveryCodes.map(hashRecoveryCode), session.username);
        delete session.pendingTotp;
        sessions.destroyAllExcept(session.id);
        return json(res, 200, { ok: true, recoveryCodes }, withSecurity());
      }
      if (req.method === 'POST' && url.pathname === '/api/account/2fa/recovery-codes') {
        const body = await readJson(req, 4096);
        if (!await currentPasswordValid(body)) return json(res, 401, { error: 'current password is incorrect' }, withSecurity());
        const account = store.getAdminAccount();
        if (!secondFactorValid(account, body.code, { recovery: false })) throw new Error('authenticator code is invalid');
        const recoveryCodes = generateRecoveryCodes();
        store.replaceAdminRecoveryCodes(recoveryCodes.map(hashRecoveryCode), session.username);
        sessions.destroyAllExcept(session.id);
        return json(res, 200, { ok: true, recoveryCodes }, withSecurity());
      }
      if (req.method === 'POST' && url.pathname === '/api/account/2fa/disable') {
        const body = await readJson(req, 4096);
        if (!await currentPasswordValid(body)) return json(res, 401, { error: 'current password is incorrect' }, withSecurity());
        const account = store.getAdminAccount();
        if (!secondFactorValid(account, body.code)) throw new Error('authenticator or recovery code is invalid');
        store.disableAdminTotp(session.username);
        sessions.destroyAll();
        return json(res, 200, { ok: true, reauthenticate: true }, withSecurity({ 'set-cookie': sessions.clearCookie() }));
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const [localPeer, proxyRuntime] = await Promise.all([netbird.localStatus(), proxy.status()]);
        const activeResources = process.getActiveResourcesInfo().reduce((counts, resource) => {
          counts[resource] = (counts[resource] ?? 0) + 1;
          return counts;
        }, {});
        return json(res, 200, {
          status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), activeRoutes: proxy.routeCount(),
          netbirdMode: config.netbird.mode, netbirdWriteEnabled: false, localPeer,
          runtime: { proxy: proxyRuntime, memory: process.memoryUsage(), cpu: process.cpuUsage(), activeResources },
        }, withSecurity());
      }
      if (req.method === 'GET' && url.pathname === '/api/routes/template') return json(res, 200, defaultRoute(), withSecurity());
      if (req.method === 'GET' && url.pathname === '/api/routes') return json(res, 200, store.listRoutes(), withSecurity());
      if (req.method === 'POST' && url.pathname === '/api/routes/draft') {
        const body = await readJson(req, 1_048_576);
        const route = validateRoute(body.route ?? body, networkPolicy);
        return json(res, 201, store.saveDraft(route), withSecurity());
      }
      const historyMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/history$/);
      if (req.method === 'GET' && historyMatch) return json(res, 200, store.listHistory(historyMatch[1]), withSecurity());
      const testMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/test$/);
      if (req.method === 'POST' && testMatch) {
        const body = await readJson(req, 64_000);
        const version = store.getVersion(body.versionId);
        if (!version || version.route_id !== testMatch[1] || version.status !== 'draft') throw new Error('route draft was not found');
        const route = validateRoute(store.materializeProfiles(version.config), networkPolicy);
        const result = await probeRoute(route, networkPolicy);
        store.recordValidation(version.id, result);
        return json(res, result.ok ? 200 : 409, result, withSecurity());
      }
      const activateMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/activate$/);
      if (req.method === 'POST' && activateMatch) {
        const body = await readJson(req, 64_000);
        const version = store.getVersion(body.versionId);
        if (!version || version.route_id !== activateMatch[1] || version.status !== 'draft') throw new Error('route draft was not found');
        const route = validateRoute(store.materializeProfiles(version.config), networkPolicy);
        let validation = { ok: true, skipped: true, checkedAt: new Date().toISOString(), reason: 'route is disabled' };
        if (route.enabled) validation = await probeRoute(route, networkPolicy);
        store.recordValidation(version.id, validation);
        if (!validation.ok) {
          const error = new Error(`candidate health check failed: ${validation.error ?? `HTTP ${validation.status}`}`);
          error.statusCode = 409;
          throw error;
        }
        const result = store.activate(route.id, version.id, route);
        proxy.reload();
        return json(res, 200, { ...result, validation }, withSecurity());
      }
      const rollbackMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/rollback$/);
      if (req.method === 'POST' && rollbackMatch) {
        const body = await readJson(req, 64_000);
        const draft = store.rollbackDraft(rollbackMatch[1], body.versionId);
        const version = store.getVersion(draft.versionId);
        const route = validateRoute(version.config, networkPolicy);
        const validation = route.enabled ? await probeRoute(route, networkPolicy) : { ok: true, skipped: true, checkedAt: new Date().toISOString() };
        store.recordValidation(version.id, validation);
        if (!validation.ok) {
          const error = new Error(`rollback health check failed: ${validation.error ?? `HTTP ${validation.status}`}`);
          error.statusCode = 409;
          throw error;
        }
        const result = store.activate(route.id, version.id, route);
        proxy.reload();
        return json(res, 200, { ...result, validation }, withSecurity());
      }
      const cloneMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/clone$/);
      if (req.method === 'POST' && cloneMatch) {
        const body = await readJson(req, 64_000);
        const source = store.getRoute(cloneMatch[1]);
        if (!source) throw new Error('source route was not found');
        const route = structuredClone(source.active?.config ?? source.draft?.config);
        route.id = id('route_');
        route.hostname = body.hostname;
        route.enabled = false;
        delete route.resolvedProfileItems;
        delete route.resolvedProfiles;
        return json(res, 201, store.saveDraft(validateRoute(route, networkPolicy)), withSecurity());
      }
      const enabledMatch = url.pathname.match(/^\/api\/routes\/([^/]+)\/enabled$/);
      if (req.method === 'POST' && enabledMatch) {
        const body = await readJson(req, 4096);
        if (typeof body.enabled !== 'boolean') throw new Error('enabled must be true or false');
        const source = store.getRoute(enabledMatch[1]);
        if (!source?.active) throw new Error('active route was not found');
        if (source.draft) {
          const error = new Error('route has a pending draft; activate or replace it before changing enabled state');
          error.statusCode = 409;
          throw error;
        }
        const route = validateRoute({ ...source.active.config, enabled: body.enabled }, networkPolicy);
        let validation = { ok: true, skipped: true, checkedAt: new Date().toISOString(), reason: 'route is disabled' };
        if (route.enabled) validation = await probeRoute(route, networkPolicy);
        if (!validation.ok) {
          const error = new Error(`candidate health check failed: ${validation.error ?? `HTTP ${validation.status}`}`);
          error.statusCode = 409;
          throw error;
        }
        const fresh = store.getRoute(enabledMatch[1]);
        if (!fresh?.active || fresh.active.id !== source.active.id || fresh.draft) {
          const error = new Error('route changed while enabled-state validation was running; retry against the latest version');
          error.statusCode = 409;
          throw error;
        }
        const draft = store.saveDraft(route);
        store.recordValidation(draft.versionId, validation);
        const result = store.activate(route.id, draft.versionId, route);
        proxy.reload();
        return json(res, 200, { ...result, enabled: route.enabled, validation }, withSecurity());
      }
      const deleteMatch = url.pathname.match(/^\/api\/routes\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteMatch) {
        store.deleteRoute(deleteMatch[1]);
        proxy.reload();
        return json(res, 200, { ok: true }, withSecurity());
      }
      if (req.method === 'POST' && url.pathname === '/api/preview') {
        const body = await readJson(req, 3_145_728);
        let route = validateRoute(body.route, networkPolicy);
        route = validateRoute(store.materializeProfiles(route), networkPolicy);
        const html = typeof body.html === 'string' ? body.html : '';
        if (Buffer.byteLength(html) > route.response.maxInjectBytes) throw new Error('preview HTML exceeds the route response limit');
        return json(res, 200, previewInjection({ route, html, method: body.method, status: body.status, headers: body.headers, path: body.path }), withSecurity());
      }
      if (req.method === 'GET' && url.pathname === '/api/profiles') return json(res, 200, store.listProfiles(), withSecurity());
      if (req.method === 'POST' && url.pathname === '/api/profiles') {
        const body = await readJson(req, 1_048_576);
        return json(res, 201, store.saveProfile(validateProfile(body.profile ?? body)), withSecurity());
      }
      const profileDelete = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
      if (req.method === 'DELETE' && profileDelete) {
        store.deleteProfile(profileDelete[1]);
        return json(res, 200, { ok: true }, withSecurity());
      }
      if (req.method === 'GET' && url.pathname === '/api/peers') return json(res, 200, { peers: await netbird.peers() }, withSecurity());
      if (req.method === 'GET' && url.pathname === '/api/netbird/clusters') return json(res, 200, { clusters: await netbird.clusters() }, withSecurity());
      if (req.method === 'GET' && url.pathname === '/api/export') {
        return json(res, 200, store.exportData(), withSecurity({ 'content-disposition': `attachment; filename="nim-export-${new Date().toISOString().slice(0, 10)}.json"` }));
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const body = await readJson(req, 5_242_880);
        if (body.format !== 'netbird-injector-manager-export' || body.version !== 1) throw new Error('unsupported import format');
        if (!Array.isArray(body.routes) || body.routes.length > 1000 || !Array.isArray(body.profiles) || body.profiles.length > 1000) throw new Error('import collection limits exceeded');
        const profiles = body.profiles.map(validateProfile);
        const routes = body.routes.map((route) => validateRoute({ ...route, enabled: false }, networkPolicy));
        if (new Set(routes.map((route) => route.id)).size !== routes.length || new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
          throw new Error('import contains duplicate route or profile IDs');
        }
        if (new Set(profiles.map((profile) => profile.name)).size !== profiles.length) throw new Error('import contains duplicate profile names');
        const existingRoutes = new Set(store.listRoutes().map((route) => route.id));
        const existingProfiles = new Set(store.listProfiles().map((profile) => profile.id));
        if (routes.some((route) => existingRoutes.has(route.id)) || profiles.some((profile) => existingProfiles.has(profile.id))) {
          const error = new Error('import IDs conflict with existing objects; no active routes were changed');
          error.statusCode = 409;
          throw error;
        }
        const drafts = store.transaction(() => {
          for (const profile of profiles) store.saveProfile(profile, 'import');
          return routes.map((route) => store.saveDraft(route, 'import'));
        });
        return json(res, 201, { profiles: profiles.length, routeDrafts: drafts.length, activeChanges: 0 }, withSecurity());
      }
      if (req.method === 'GET' && url.pathname === '/api/audit') return json(res, 200, store.listAudit(), withSecurity());
      return json(res, 404, { error: 'not found' }, withSecurity());
    } catch (error) {
      logger.warn('admin.request_failed', { method: req.method, operation: url.pathname.replace(/[0-9a-f-]{20,}/g, ':id'), reason: error.message });
      return errorResponse(res, error);
    }
  };

  const serverOptions = {
    maxHeaderSize: 16_384, insecureHTTPParser: false, joinDuplicateHeaders: false,
    requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000,
  };
  const listener = (req, res) => handler(req, res).catch((error) => {
    logger.error('admin.unhandled_error', { reason: error.message });
    if (!res.headersSent) json(res, 500, { error: 'internal error' }, withSecurity());
    else res.destroy();
  });
  const server = config.admin.tlsCertFile
    ? https.createServer({ ...serverOptions, cert: readFileSync(config.admin.tlsCertFile), key: readFileSync(config.admin.tlsKeyFile), minVersion: 'TLSv1.2' }, listener)
    : http.createServer(serverOptions, listener);
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return { server };
}
