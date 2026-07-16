import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { assessEligibility, decodeBody, encodeBody, injectHtml } from './lib/injection.mjs';
import { canonicalHostname } from './lib/util.mjs';

const FIXED_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function connectionHeaders(headers) {
  return new Set(String(headers.connection ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean));
}

function forwardedChain(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length > 32 || entries.some((entry) => !net.isIP(entry.replace(/^\[|\]$/g, '')))) return [];
  return entries.map((entry) => entry.replace(/^\[|\]$/g, ''));
}

function forwardedForValue(address) {
  return net.isIP(address) === 6 ? `"[${address}]"` : address;
}

function sanitizeRequestHeaders(req, route, networkPolicy, externalProtocol, { websocket = false } = {}) {
  const headers = {};
  const nominated = connectionHeaders(req.headers);
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (FIXED_HOP_HEADERS.has(lower) || nominated.has(lower) || value === undefined) continue;
    headers[lower] = value;
  }
  const remote = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const trusted = networkPolicy.isTrustedIngress(remote);
  const incomingChain = trusted ? forwardedChain(req.headers['x-forwarded-for']) : [];
  const clientAddress = incomingChain[0] ?? remote;
  headers['x-forwarded-for'] = [...incomingChain, remote].join(', ');
  headers['x-forwarded-host'] = route.hostname;
  const incomingProtocol = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  const protocol = trusted && ['http', 'https'].includes(incomingProtocol) ? incomingProtocol : externalProtocol;
  const incomingPort = String(req.headers['x-forwarded-port'] ?? '');
  const port = trusted && /^\d{1,5}$/.test(incomingPort) && Number(incomingPort) >= 1 && Number(incomingPort) <= 65535
    ? incomingPort
    : protocol === 'https' ? '443' : '80';
  const incomingRequestId = String(req.headers['x-request-id'] ?? '');
  headers['x-forwarded-proto'] = protocol;
  headers['x-forwarded-port'] = port;
  headers['x-real-ip'] = clientAddress;
  headers.forwarded = `for=${forwardedForValue(clientAddress)};host="${route.hostname}";proto=${protocol}`;
  headers['x-request-id'] = trusted && /^[A-Za-z0-9._:-]{1,128}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
  headers.host = route.upstream.hostHeader || route.hostname;
  delete headers.expect;
  if (!trusted) {
    delete headers['x-netbird-user'];
    delete headers['x-netbird-groups'];
  }
  if (websocket) {
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
  }
  return headers;
}

function sanitizeResponseHeaders(headers, { transformed = false } = {}) {
  const output = {};
  const nominated = connectionHeaders(headers);
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (FIXED_HOP_HEADERS.has(lower) || nominated.has(lower) || value === undefined) continue;
    output[lower] = value;
  }
  if (transformed) {
    delete output['content-length'];
    delete output.etag;
    delete output['last-modified'];
    delete output['content-md5'];
    delete output.digest;
    output['cache-control'] = output['cache-control'] ? `${output['cache-control']}, no-cache` : 'no-cache';
  }
  return output;
}

function websocketResponseHead(response) {
  if (response.statusCode !== 101 || String(response.headers.upgrade ?? '').toLowerCase() !== 'websocket' || !connectionHeaders(response.headers).has('upgrade')) throw new Error('upstream returned an invalid WebSocket upgrade');
  const headers = sanitizeResponseHeaders(response.headers);
  delete headers['content-length'];
  headers.connection = 'Upgrade';
  headers.upgrade = 'websocket';
  const lines = [`HTTP/1.1 101 ${response.statusMessage || 'Switching Protocols'}`];
  for (const [name, value] of Object.entries(headers)) {
    for (const entry of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${entry}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function requestOptions(req, route, networkPolicy, externalProtocol, extra = {}) {
  const isTls = route.upstream.protocol === 'https';
  networkPolicy.assertPort(route.upstream.port);
  if (net.isIP(route.upstream.host)) networkPolicy.assertAddress(route.upstream.host);
  const options = {
    protocol: `${route.upstream.protocol}:`,
    hostname: route.upstream.host,
    port: route.upstream.port,
    method: req.method,
    path: req.url,
    headers: sanitizeRequestHeaders(req, route, networkPolicy, externalProtocol, extra),
    lookup: networkPolicy.lookup(),
    autoSelectFamily: false,
    maxHeaderSize: 16_384,
    insecureHTTPParser: false,
    agent: false,
  };
  if (isTls) {
    options.rejectUnauthorized = route.upstream.tlsVerify;
    const hostHeaderName = route.upstream.hostHeader ? new URL(`http://${route.upstream.hostHeader}`).hostname.replace(/^\[|\]$/g, '') : route.hostname;
    options.servername = route.upstream.serverName || (net.isIP(route.upstream.host) ? hostHeaderName : route.upstream.host);
    if (route.upstream.caPem) options.ca = route.upstream.caPem;
    options.minVersion = 'TLSv1.2';
  }
  return options;
}

function armTimeouts(upstreamRequest, route, onTimeout) {
  const responseTimer = setTimeout(() => onTimeout('upstream response timeout'), route.timeouts.responseMs);
  responseTimer.unref();
  upstreamRequest.once('response', () => clearTimeout(responseTimer));
  upstreamRequest.once('upgrade', () => clearTimeout(responseTimer));
  upstreamRequest.once('error', () => clearTimeout(responseTimer));
  upstreamRequest.once('socket', (socket) => {
    const connectTimer = setTimeout(() => onTimeout('upstream connect timeout'), route.timeouts.connectMs);
    connectTimer.unref();
    const clear = () => clearTimeout(connectTimer);
    if (socket.connecting) {
      socket.once(route.upstream.protocol === 'https' ? 'secureConnect' : 'connect', clear);
      socket.once('error', clear);
    } else clear();
    socket.setTimeout(route.timeouts.idleMs, () => onTimeout('upstream idle timeout'));
  });
}

class LimitedRequestBody extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.size = 0;
  }
  _transform(chunk, _encoding, callback) {
    this.size += chunk.length;
    if (this.size > this.limit) {
      const error = new Error('request body is too large');
      error.code = 'NIM_BODY_LIMIT';
      callback(error);
      return;
    }
    callback(null, chunk);
  }
}

class InjectionTransform extends Transform {
  constructor({ route, encoding, path, logger, onDecision, onInjection }) {
    super();
    this.route = route;
    this.encoding = encoding;
    this.path = path;
    this.logger = logger;
    this.onDecision = onDecision;
    this.onInjection = onInjection;
    this.decided = false;
    this.chunks = [];
    this.size = 0;
    this.passthrough = false;
  }
  decide(transformed, error = false) {
    if (this.decided) return;
    this.decided = true;
    this.onDecision(transformed);
    this.onInjection({ transformed, error });
  }
  _transform(chunk, _encoding, callback) {
    if (this.passthrough) return callback(null, chunk);
    this.size += chunk.length;
    if (this.size > this.route.response.maxInjectBytes) {
      this.passthrough = true;
      const buffered = Buffer.concat([...this.chunks, chunk]);
      this.chunks = [];
      this.logger.warn('proxy.injection_skipped', { routeId: this.route.id, reason: 'compressed-or-wire-size-limit' });
      this.decide(false);
      callback(null, buffered);
      return;
    }
    this.chunks.push(chunk);
    callback();
  }
  _flush(callback) {
    if (this.passthrough) return callback();
    const original = Buffer.concat(this.chunks);
    try {
      const decoded = decodeBody(original, this.encoding, this.route.response.maxInjectBytes);
      const hasUtf8Bom = decoded.length >= 3 && decoded[0] === 0xef && decoded[1] === 0xbb && decoded[2] === 0xbf;
      const html = new TextDecoder('utf-8', { fatal: true }).decode(hasUtf8Bom ? decoded.subarray(3) : decoded);
      const injection = injectHtml(html, this.route, { hostname: this.route.hostname, path: this.path });
      if (!injection.modified) {
        this.decide(false);
        this.push(original);
      } else {
        const transformedBody = Buffer.from(injection.html);
        const transformed = hasUtf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), transformedBody]) : transformedBody;
        if (transformed.length > this.route.response.maxInjectBytes) throw new Error('transformed response exceeds the configured maximum');
        const encoded = encodeBody(transformed, this.encoding);
        if (encoded.length > this.route.response.maxInjectBytes) throw new Error('encoded transformed response exceeds the configured maximum');
        this.decide(true);
        this.push(encoded);
        this.logger.debug('proxy.injection_applied', { routeId: this.route.id, itemCount: injection.applied.length });
      }
    } catch (error) {
      this.logger.warn('proxy.injection_skipped', { routeId: this.route.id, reason: error.message });
      this.decide(false, true);
      this.push(original);
    }
    callback();
  }
}

function validRequestTarget(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !/^https?:\/\//i.test(url);
}

function requestHostname(req) {
  const hosts = req.headersDistinct?.host;
  if (!Array.isArray(hosts) || hosts.length !== 1) throw new Error('exactly one Host header is required');
  return canonicalHostname(hosts[0]);
}

export function createProxy({ store, config, networkPolicy, logger }) {
  let routes = new Map();
  const counters = {
    requests: 0, activeRequests: 0, upstreamErrors: 0, interruptedResponses: 0,
    injectionApplied: 0, injectionSkipped: 0, injectionErrors: 0,
    websocketsOpened: 0, activeWebSockets: 0,
  };
  const reload = () => {
    const next = new Map();
    for (const route of store.listActiveConfigs()) next.set(route.hostname, Object.freeze(route));
    routes = next;
    logger.info('proxy.routes_loaded', { count: routes.size });
  };
  reload();

  const handler = (req, res, { sendContinue = false } = {}) => {
    counters.requests += 1;
    counters.activeRequests += 1;
    let requestFinished = false;
    const finishRequest = () => {
      if (requestFinished) return;
      requestFinished = true;
      counters.activeRequests -= 1;
    };
    res.once('finish', finishRequest);
    res.once('close', finishRequest);
    let hostname;
    try {
      hostname = requestHostname(req);
      if (!validRequestTarget(req.url)) throw new Error('absolute-form and invalid request targets are rejected');
      if (req.headers['transfer-encoding'] && req.headers['content-length']) throw new Error('Content-Length with Transfer-Encoding is rejected');
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain', connection: 'close' });
      res.end('Bad Request\n');
      return;
    }
    const route = routes.get(hostname);
    if (!route) {
      res.writeHead(421, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('Misdirected Request\n');
      return;
    }
    if (!ALLOWED_METHODS.has(req.method)) {
      res.writeHead(405, { allow: 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS' });
      res.end();
      return;
    }
    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined && (!/^\d+$/.test(String(declaredLength)) || BigInt(declaredLength) > BigInt(config.proxy.maxRequestBytes))) {
      res.writeHead(413, { connection: 'close' });
      res.end('Request Entity Too Large\n');
      return;
    }

    const client = route.upstream.protocol === 'https' ? https : http;
    let upstreamRequest;
    try {
      networkPolicy.assertPort(route.upstream.port);
      upstreamRequest = client.request(requestOptions(req, route, networkPolicy, config.proxy.externalProtocol), (upstreamResponse) => {
        let responseInterrupted = false;
        const interruptResponse = () => {
          if (responseInterrupted || upstreamResponse.complete) return;
          responseInterrupted = true;
          counters.interruptedResponses += 1;
          logger.warn('proxy.upstream_response_interrupted', { routeId: route.id });
          if (!res.destroyed) res.destroy(new Error('upstream response was interrupted'));
        };
        upstreamResponse.once('aborted', interruptResponse);
        upstreamResponse.once('error', interruptResponse);
        const path = req.url.split('?')[0];
        const eligibility = assessEligibility({ method: req.method, status: upstreamResponse.statusCode, headers: upstreamResponse.headers, requestHeaders: req.headers, route, path });
        if (!eligibility.eligible) {
          counters.injectionSkipped += 1;
          res.writeHead(upstreamResponse.statusCode, upstreamResponse.statusMessage, sanitizeResponseHeaders(upstreamResponse.headers));
          upstreamResponse.pipe(res);
          return;
        }
        const transform = new InjectionTransform({
          route, encoding: eligibility.encoding, path, logger,
          onDecision: (transformed) => {
            if (!res.headersSent) res.writeHead(upstreamResponse.statusCode, upstreamResponse.statusMessage, sanitizeResponseHeaders(upstreamResponse.headers, { transformed }));
          },
          onInjection: ({ transformed, error }) => {
            if (transformed) counters.injectionApplied += 1;
            else counters.injectionSkipped += 1;
            if (error) counters.injectionErrors += 1;
          },
        });
        upstreamResponse.pipe(transform).pipe(res);
      });
    } catch (error) {
      logger.warn('proxy.request_rejected', { routeId: route.id, reason: error.message });
      res.writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('Bad Gateway\n');
      return;
    }
    let completed = false;
    const fail = (reason, error) => {
      if (completed) return;
      completed = true;
      upstreamRequest.destroy(error instanceof Error ? error : new Error(reason));
      logger.warn('proxy.upstream_error', { routeId: route.id, reason });
      counters.upstreamErrors += 1;
      if (!res.headersSent) {
        res.writeHead(reason === 'request body is too large' ? 413 : 502, { 'content-type': 'text/plain', 'cache-control': 'no-store', connection: 'close' });
        res.end(reason === 'request body is too large' ? 'Request Entity Too Large\n' : 'Bad Gateway\n');
      } else res.destroy();
    };
    armTimeouts(upstreamRequest, route, (reason) => fail(reason));
    upstreamRequest.on('error', (error) => fail(error.code === 'NIM_BODY_LIMIT' ? 'request body is too large' : 'upstream connection failed', error));
    upstreamRequest.on('close', () => { completed = true; });
    const limiter = new LimitedRequestBody(config.proxy.maxRequestBytes);
    limiter.on('error', (error) => fail('request body is too large', error));
    if (sendContinue) res.writeContinue();
    req.pipe(limiter).pipe(upstreamRequest);
    req.on('aborted', () => {
      completed = true;
      upstreamRequest.destroy(new Error('downstream request aborted'));
    });
  };

  const server = http.createServer({
    maxHeaderSize: config.proxy.maxHeaderBytes,
    insecureHTTPParser: false,
    joinDuplicateHeaders: false,
    requestTimeout: 0,
    headersTimeout: 15_000,
    keepAliveTimeout: 5_000,
    connectionsCheckingInterval: 5_000,
  }, handler);

  server.on('checkContinue', (req, res) => handler(req, res, { sendContinue: true }));

  server.on('upgrade', (req, socket, head) => {
    let hostname;
    try {
      hostname = requestHostname(req);
      if (!validRequestTarget(req.url)) throw new Error('invalid request target');
      if (req.method !== 'GET' || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || !connectionHeaders(req.headers).has('upgrade')) throw new Error('only WebSocket upgrades are supported');
      if (req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined) throw new Error('upgrade requests must not contain a request body');
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const route = routes.get(hostname);
    if (!route) {
      socket.end('HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const client = route.upstream.protocol === 'https' ? https : http;
    let upstreamRequest;
    try {
      upstreamRequest = client.request(requestOptions(req, route, networkPolicy, config.proxy.externalProtocol, { websocket: true }));
    } catch {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      return;
    }
    armTimeouts(upstreamRequest, route, () => upstreamRequest.destroy(new Error('websocket upstream timeout')));
    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      try { socket.write(websocketResponseHead(upstreamResponse)); }
      catch {
        upstreamSocket.destroy();
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        return;
      }
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      counters.websocketsOpened += 1;
      counters.activeWebSockets += 1;
      let websocketClosed = false;
      const closeWebSocket = () => {
        if (websocketClosed) return;
        websocketClosed = true;
        counters.activeWebSockets -= 1;
      };
      socket.once('close', closeWebSocket);
      upstreamSocket.once('close', closeWebSocket);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstreamRequest.on('response', (response) => {
      response.resume();
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    upstreamRequest.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
    upstreamRequest.end();
  });

  server.on('connect', (_req, socket) => {
    socket.end('HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS\r\nConnection: close\r\n\r\n');
  });

  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  const status = () => new Promise((resolve) => {
    server.getConnections((error, activeConnections) => resolve({
      ...counters,
      activeConnections: error ? null : activeConnections,
    }));
  });
  return { server, reload, routeCount: () => routes.size, status };
}

export function probeRoute(route, networkPolicy) {
  return new Promise((resolve) => {
    const applicationHealth = route.health.enabled !== false;
    const fakeRequest = {
      method: applicationHealth ? route.health.method : 'HEAD',
      url: applicationHealth ? route.health.path : '/',
      headers: { host: route.hostname },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const client = route.upstream.protocol === 'https' ? https : http;
    const startedAt = Date.now();
    let request;
    try {
      networkPolicy.assertPort(route.upstream.port);
      const options = requestOptions(fakeRequest, route, networkPolicy, 'https');
      options.headers = { host: route.upstream.hostHeader || route.hostname, 'user-agent': 'netbird-injector-manager-health/1' };
      request = client.request(options, (response) => {
        const ok = applicationHealth ? route.health.expectedStatuses.includes(response.statusCode) : response.statusCode >= 100 && response.statusCode <= 599;
        response.resume();
        response.once('end', () => resolve({ ok, mode: applicationHealth ? 'application-health' : 'connectivity', status: response.statusCode, durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString(), error: ok ? null : 'unexpected status' }));
      });
    } catch (error) {
      resolve({ ok: false, durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString(), error: error.message });
      return;
    }
    const timer = setTimeout(() => request.destroy(new Error('health check timed out')), route.timeouts.connectMs + route.timeouts.responseMs);
    timer.unref();
    request.on('close', () => clearTimeout(timer));
    request.on('error', (error) => resolve({ ok: false, durationMs: Date.now() - startedAt, checkedAt: new Date().toISOString(), error: error.message }));
    request.end();
  });
}
