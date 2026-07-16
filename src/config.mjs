import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { boundedInteger, clone } from './lib/util.mjs';
import { addressInCidrs, NetworkPolicy, parseCidr } from './lib/network.mjs';
import { normalizeAdminUsername, PASSWORD_HASH_PATTERN } from './lib/security.mjs';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PRIVATE_ADMIN_CIDRS = ['10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7'].map(parseCidr);

export const DEFAULT_CONFIG = Object.freeze({
  proxy: { listen: '0.0.0.0', port: 8080, externalProtocol: 'https', maxHeaderBytes: 16384, maxRequestBytes: 52_428_800 },
  admin: {
    listen: '127.0.0.1', port: 9090, username: 'admin', passwordHash: '', allowRemote: false, cookieSecure: false,
    sessionMinutes: 30, allowedCidrs: ['127.0.0.0/8', '::1/128'], tlsCertFile: '', tlsKeyFile: '',
  },
  storage: { database: './data/state.db' },
  network: {
    allowedTargetCidrs: ['100.64.0.0/10'],
    allowedPorts: [80, 443, 3000, 8000, 8080, 8443],
    trustedIngressCidrs: ['100.64.0.0/10'],
  },
  netbird: {
    mode: 'manual', apiBaseUrl: 'https://api.netbird.io', tokenFile: '', allowInsecureApi: false, writeEnabled: false,
    cacheSeconds: 60, cliPath: '/usr/bin/netbird', caFile: '',
  },
  logging: { level: 'info' },
});

function assertSafeKeys(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeKeys(entry);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) throw new Error(`unsafe configuration key: ${key}`);
    assertSafeKeys(entry);
  }
}

function merge(target, source) {
  assertSafeKeys(source);
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!Object.hasOwn(target, key)) throw new Error(`unknown configuration key: ${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) merge(target[key], value);
    else target[key] = clone(value);
  }
  return target;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`);
  return value;
}

function listenAddress(value, name) {
  const address = String(value ?? '').trim().replace(/^\[|\]$/g, '');
  if (!net.isIP(address)) throw new Error(`${name} must be a literal IPv4 or IPv6 address`);
  return address;
}

function pathString(value, name, { empty = true } = {}) {
  if (typeof value !== 'string' || (!empty && !value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function cidrWithin(child, parents) {
  return parents.some((parent) => child.family === parent.family && child.prefix >= parent.prefix
    && ((child.network >> parent.shift) << parent.shift) === parent.network);
}

export function validateConfig(input, baseDirectory = process.cwd()) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) throw new Error('configuration must be a JSON object');
  const config = merge(clone(DEFAULT_CONFIG), input);
  config.proxy.listen = listenAddress(config.proxy.listen, 'proxy listen address');
  config.admin.listen = listenAddress(config.admin.listen, 'admin listen address');
  config.proxy.port = boundedInteger(config.proxy.port, 'proxy port', 1, 65535, 8080);
  config.admin.port = boundedInteger(config.admin.port, 'admin port', 1, 65535, 9090);
  config.proxy.maxHeaderBytes = boundedInteger(config.proxy.maxHeaderBytes, 'maximum header bytes', 4096, 65536, 16384);
  config.proxy.maxRequestBytes = boundedInteger(config.proxy.maxRequestBytes, 'maximum request bytes', 1024, 1_073_741_824, 52_428_800);
  config.admin.sessionMinutes = boundedInteger(config.admin.sessionMinutes, 'session minutes', 5, 1440, 30);
  config.admin.allowRemote = boolean(config.admin.allowRemote, 'admin.allowRemote');
  config.admin.cookieSecure = boolean(config.admin.cookieSecure, 'admin.cookieSecure');
  config.admin.username = normalizeAdminUsername(config.admin.username);
  if (!Array.isArray(config.admin.allowedCidrs) || !config.admin.allowedCidrs.length || config.admin.allowedCidrs.length > 64) {
    throw new Error('admin.allowedCidrs must contain 1 to 64 private client CIDRs');
  }
  const adminAllowedCidrs = config.admin.allowedCidrs.map(parseCidr);
  if (adminAllowedCidrs.some((cidr) => !cidrWithin(cidr, PRIVATE_ADMIN_CIDRS))) {
    throw new Error('admin.allowedCidrs may contain only loopback, RFC1918, NetBird CGNAT, or IPv6 ULA networks');
  }
  config.admin.tlsCertFile = pathString(config.admin.tlsCertFile, 'admin TLS certificate file');
  config.admin.tlsKeyFile = pathString(config.admin.tlsKeyFile, 'admin TLS private-key file');
  if (Boolean(config.admin.tlsCertFile) !== Boolean(config.admin.tlsKeyFile)) throw new Error('admin TLS certificate and private-key files must be configured together');
  if (config.admin.tlsCertFile && !config.admin.cookieSecure) throw new Error('admin.cookieSecure must be true when native admin TLS is configured');
  config.netbird.allowInsecureApi = boolean(config.netbird.allowInsecureApi, 'netbird.allowInsecureApi');
  config.netbird.writeEnabled = boolean(config.netbird.writeEnabled, 'netbird.writeEnabled');
  if (config.netbird.writeEnabled) throw new Error('NetBird write integration is not implemented; netbird.writeEnabled must remain false');
  const adminAddress = config.admin.listen;
  const loopback = adminAddress === '::1' || (net.isIP(adminAddress) === 4 && adminAddress.startsWith('127.'));
  if (!loopback && !config.admin.allowRemote) throw new Error('non-loopback admin binding requires admin.allowRemote=true');
  if (!loopback && ['0.0.0.0', '::'].includes(adminAddress)) throw new Error('remote admin must bind one explicit private IP, not a wildcard address');
  if (!loopback && !addressInCidrs(adminAddress, PRIVATE_ADMIN_CIDRS.filter((cidr) => !['127.0.0.0/8', '::1/128'].includes(cidr.source)))) {
    throw new Error('remote admin listen address must be a private IP in an RFC1918, NetBird CGNAT, or IPv6 ULA network');
  }
  if (!loopback && !config.admin.cookieSecure) throw new Error('non-loopback admin binding requires admin.cookieSecure=true');
  if (!loopback && (!config.admin.tlsCertFile || !config.admin.tlsKeyFile)) throw new Error('non-loopback admin binding requires native TLS certificate and private-key files');
  if (!addressInCidrs(adminAddress, adminAllowedCidrs)) throw new Error('admin.allowedCidrs must include the configured admin listen address');
  if (!['http', 'https'].includes(config.proxy.externalProtocol)) throw new Error('external protocol must be http or https');
  if (!['manual', 'api'].includes(config.netbird.mode)) throw new Error('NetBird mode must be manual or api');
  config.netbird.cacheSeconds = boundedInteger(config.netbird.cacheSeconds, 'NetBird cache seconds', 1, 3600, 60);
  config.netbird.cliPath = pathString(config.netbird.cliPath, 'NetBird CLI path', { empty: false });
  config.netbird.tokenFile = pathString(config.netbird.tokenFile, 'NetBird token file');
  config.netbird.caFile = pathString(config.netbird.caFile, 'NetBird API CA file');
  if (config.netbird.mode === 'api') {
    const api = new URL(config.netbird.apiBaseUrl);
    if (api.protocol !== 'https:' && !(config.netbird.allowInsecureApi && api.protocol === 'http:')) throw new Error('NetBird API must use HTTPS unless allowInsecureApi is explicitly enabled');
    if (api.username || api.password || api.search || api.hash) throw new Error('NetBird API base URL must not contain credentials, a query, or a fragment');
    if (!config.netbird.tokenFile) throw new Error('NetBird API mode requires tokenFile');
    config.netbird.apiBaseUrl = api.toString();
  }
  if (!Array.isArray(config.network.allowedTargetCidrs) || !config.network.allowedTargetCidrs.length) throw new Error('at least one target CIDR must be allowed');
  if (!Array.isArray(config.network.allowedPorts) || !config.network.allowedPorts.length) throw new Error('at least one upstream port must be allowed');
  if (!Array.isArray(config.network.trustedIngressCidrs)) throw new Error('trusted ingress CIDRs must be a list');
  new NetworkPolicy(config.network);
  if (typeof config.storage.database !== 'string' || !config.storage.database) throw new Error('storage database path is invalid');
  if (!LOG_LEVELS.has(config.logging.level)) throw new Error('logging level must be debug, info, warn, or error');
  config.storage.database = config.storage.database === ':memory:' ? ':memory:' : resolve(baseDirectory, config.storage.database);
  if (config.netbird.tokenFile) config.netbird.tokenFile = resolve(baseDirectory, config.netbird.tokenFile);
  if (config.netbird.caFile) config.netbird.caFile = resolve(baseDirectory, config.netbird.caFile);
  if (config.admin.tlsCertFile) config.admin.tlsCertFile = resolve(baseDirectory, config.admin.tlsCertFile);
  if (config.admin.tlsKeyFile) config.admin.tlsKeyFile = resolve(baseDirectory, config.admin.tlsKeyFile);
  return config;
}

export function loadConfig(path = process.env.NIM_CONFIG ?? './config/config.json') {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`configuration file not found: ${absolute}`);
  const parsed = JSON.parse(readFileSync(absolute, 'utf8'));
  const config = validateConfig(parsed, dirname(absolute));
  if (!config.admin.passwordHash) throw new Error('admin.passwordHash must be configured; run scripts/hash-password.mjs');
  if (!PASSWORD_HASH_PATTERN.test(config.admin.passwordHash)) throw new Error('admin.passwordHash is invalid; run scripts/hash-password.mjs and replace the example placeholder');
  return { config, path: absolute };
}

export function ensureStateDirectory(config) {
  if (config.storage.database === ':memory:') return;
  const directory = dirname(config.storage.database);
  mkdirSync(directory, { recursive: true, mode: 0o750 });
  try { chmodSync(directory, 0o750); } catch { /* permissions may be managed externally */ }
}
