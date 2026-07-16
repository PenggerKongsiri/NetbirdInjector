import net from 'node:net';
import { URL } from 'node:url';
import { boundedInteger, canonicalHostname, clone, id } from './util.mjs';

const ITEM_TYPES = new Set(['external-script', 'inline-script', 'external-style', 'inline-style', 'html', 'meta', 'umami']);
const LOCATIONS = new Set(['head-start', 'head-end', 'body-start', 'body-end']);
const ATTRIBUTES = new Set(['defer', 'async', 'integrity', 'crossorigin', 'referrerpolicy', 'type', 'media', 'name', 'content', 'property', 'http-equiv', 'charset']);
const MAX_ROUTE_ITEMS = 200;
const MAX_INJECTION_CONFIG_BYTES = 2_097_152;
const INJECTION_KEYS = new Set(['id', 'name', 'enabled', 'type', 'location', 'priority', 'url', 'content', 'attributes', 'nonceBehavior', 'includeHostnames', 'includePaths', 'excludePaths', 'environments', 'duplicatePattern', 'notes', 'options']);
const UMAMI_KEYS = new Set(['analytics', 'recorder', 'websiteId', 'analyticsUrl', 'recorderUrl']);
const ROUTE_KEYS = new Set(['id', 'hostname', 'environment', 'enabled', 'mode', 'upstream', 'timeouts', 'health', 'response', 'excludedPaths', 'cspMode', 'profileIds', 'injections', 'notes', 'resolvedProfileItems', 'resolvedProfiles']);
const UPSTREAM_KEYS = new Set(['protocol', 'host', 'port', 'hostHeader', 'serverName', 'tlsVerify', 'caPem']);
const TIMEOUT_KEYS = new Set(['connectMs', 'responseMs', 'idleMs']);
const HEALTH_KEYS = new Set(['enabled', 'path', 'method', 'expectedStatuses']);
const RESPONSE_KEYS = new Set(['maxInjectBytes']);
const PROFILE_KEYS = new Set(['id', 'name', 'kind', 'enabled', 'items', 'notes', 'revision']);

function rejectUnknownKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${name} contains an unknown field: ${key}`);
  }
}

export function defaultRoute() {
  return {
    id: id('route_'),
    hostname: 'app.example.invalid',
    environment: 'production',
    enabled: false,
    mode: 'passthrough',
    upstream: {
      protocol: 'http', host: '100.64.0.10', port: 8080, hostHeader: '', serverName: '', tlsVerify: true, caPem: '',
    },
    timeouts: { connectMs: 5000, responseMs: 30000, idleMs: 60000 },
    health: { enabled: true, path: '/', method: 'GET', expectedStatuses: [200, 204, 301, 302, 401, 403] },
    response: { maxInjectBytes: 2_097_152 },
    excludedPaths: ['/api/*', '/downloads/*'],
    cspMode: 'skip',
    profileIds: [],
    injections: [],
    notes: '',
  };
}

function requiredString(value, name, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required and must be at most ${max} characters`);
  return value.trim();
}

function stringList(value, name, maxItems = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || item.length > 1024)) {
    throw new Error(`${name} must be a list of at most ${maxItems} strings`);
  }
  return [...new Set(value)];
}

function pathList(value, name, maxItems = 100) {
  return stringList(value, name, maxItems).map((pattern) => {
    const wildcard = pattern.endsWith('*');
    const path = wildcard ? pattern.slice(0, -1) : pattern;
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('*') || /[\\#\x00-\x1f\x7f]/.test(path)) throw new Error(`${name} contains an invalid path pattern`);
    try {
      const decoded = decodeURIComponent(path);
      if (decoded.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(decoded)) throw new Error('unsafe decoded path');
    } catch { throw new Error(`${name} contains an invalid path pattern`); }
    return pattern;
  });
}

function requestPath(value, name) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048 || /[\\#\x00-\x1f\x7f]/.test(value)) throw new Error(`${name} is invalid`);
  try { decodeURI(value); } catch { throw new Error(`${name} is invalid`); }
  return value;
}

function validateItemCollection(items, name, maximum = MAX_ROUTE_ITEMS) {
  if (items.length > maximum) throw new Error(`${name} may contain at most ${maximum} injection items`);
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error(`${name} contains duplicate injection item IDs`);
  if (Buffer.byteLength(JSON.stringify(items)) > MAX_INJECTION_CONFIG_BYTES) throw new Error(`${name} injection configuration exceeds 2 MiB`);
}

export function validateInjection(input, { assignId = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('injection item must be an object');
  rejectUnknownKeys(input, INJECTION_KEYS, 'injection item');
  const item = clone(input);
  item.id = item.id || (assignId ? id('item_') : '');
  if (!/^item_[0-9a-f-]{36}$/.test(item.id)) throw new Error('injection item id is invalid');
  item.name = requiredString(item.name, 'injection name', 200);
  item.enabled = item.enabled !== false;
  if (!ITEM_TYPES.has(item.type)) throw new Error(`unsupported injection type: ${item.type}`);
  if (!LOCATIONS.has(item.location)) throw new Error(`unsupported insertion location: ${item.location}`);
  item.priority = boundedInteger(item.priority, 'injection priority', -100000, 100000, 0);
  item.url = typeof item.url === 'string' ? item.url.trim() : '';
  item.content = typeof item.content === 'string' ? item.content : '';
  if (item.content.length > 524_288) throw new Error('injection content exceeds 512 KiB');
  if (item.url) {
    const parsed = new URL(item.url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('injection URL must use HTTP or HTTPS');
    if (parsed.username || parsed.password) throw new Error('injection URL must not include credentials');
  }
  if ((item.type === 'external-script' || item.type === 'external-style') && !item.url) throw new Error(`${item.type} requires a URL`);
  if ((item.type === 'inline-script' || item.type === 'inline-style' || item.type === 'html') && !item.content) throw new Error(`${item.type} requires content`);
  item.attributes = item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes) ? clone(item.attributes) : {};
  for (const [name, value] of Object.entries(item.attributes)) {
    if (!ATTRIBUTES.has(name) && !/^data-[a-z0-9_.:-]{1,64}$/.test(name)) throw new Error(`script attribute is not allowed: ${name}`);
    if (typeof value !== 'string' && typeof value !== 'boolean') throw new Error(`script attribute ${name} must be a string or boolean`);
    if (String(value).length > 2048) throw new Error(`script attribute ${name} is too long`);
  }
  item.nonceBehavior = item.nonceBehavior === 'copy-existing' ? 'copy-existing' : 'none';
  item.includeHostnames = stringList(item.includeHostnames, 'included hostnames', 50).map(canonicalHostname);
  item.includePaths = pathList(item.includePaths, 'included paths');
  item.excludePaths = pathList(item.excludePaths, 'excluded paths');
  item.environments = stringList(item.environments, 'item environments', 20).map((value) => value.toLowerCase());
  item.duplicatePattern = typeof item.duplicatePattern === 'string' ? item.duplicatePattern.slice(0, 512) : '';
  item.notes = typeof item.notes === 'string' ? item.notes.slice(0, 4096) : '';
  if (item.type === 'umami') {
    const options = item.options && typeof item.options === 'object' ? clone(item.options) : {};
    rejectUnknownKeys(options, UMAMI_KEYS, 'Umami options');
    options.analytics = options.analytics !== false;
    options.recorder = options.recorder === true;
    options.websiteId = typeof options.websiteId === 'string' ? options.websiteId.trim().slice(0, 200) : '';
    options.analyticsUrl = typeof options.analyticsUrl === 'string' ? options.analyticsUrl.trim() : item.url;
    options.recorderUrl = typeof options.recorderUrl === 'string' ? options.recorderUrl.trim() : '';
    if (options.analytics && (!options.websiteId || !options.analyticsUrl)) throw new Error('Umami analytics requires a website ID and analytics URL');
    if (options.recorder && !options.recorderUrl) throw new Error('Umami recorder requires a recorder URL');
    for (const url of [options.analyticsUrl, options.recorderUrl].filter(Boolean)) {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Umami URLs must be credential-free HTTP(S) URLs');
    }
    item.options = options;
  } else if (item.options !== undefined) throw new Error('options are only valid for Umami injection items');
  return item;
}

export function validateRoute(input, policy) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('route must be an object');
  rejectUnknownKeys(input, ROUTE_KEYS, 'route');
  const route = clone(input);
  route.id = route.id || id('route_');
  if (!/^route_[0-9a-f-]{36}$/.test(route.id)) throw new Error('route id is invalid');
  route.hostname = canonicalHostname(requiredString(route.hostname, 'public hostname', 253));
  route.environment = route.environment === undefined ? 'production' : String(route.environment).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(route.environment)) throw new Error('route environment is invalid');
  if (net.isIP(route.hostname)) throw new Error('public hostname must be a DNS hostname, not an IP address');
  route.enabled = route.enabled === true;
  if (!['passthrough', 'inject'].includes(route.mode)) throw new Error('route mode must be passthrough or inject');
  route.upstream = route.upstream && typeof route.upstream === 'object' ? clone(route.upstream) : {};
  rejectUnknownKeys(route.upstream, UPSTREAM_KEYS, 'route upstream');
  if (!['http', 'https'].includes(route.upstream.protocol)) throw new Error('upstream protocol must be http or https');
  route.upstream.host = requiredString(route.upstream.host, 'upstream host', 253).toLowerCase();
  if (/%|[/@\\\s\x00-\x1f\x7f]/.test(route.upstream.host)) throw new Error('upstream host is invalid');
  if (!net.isIP(route.upstream.host)) route.upstream.host = canonicalHostname(route.upstream.host);
  route.upstream.port = boundedInteger(route.upstream.port, 'upstream port', 1, 65535);
  policy?.assertPort(route.upstream.port);
  if (policy && net.isIP(route.upstream.host)) policy.assertAddress(route.upstream.host);
  route.upstream.hostHeader = typeof route.upstream.hostHeader === 'string' ? route.upstream.hostHeader.trim() : '';
  if (route.upstream.hostHeader) {
    try {
      const authority = new URL(`http://${route.upstream.hostHeader}`);
      if (authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash) throw new Error('invalid');
      route.upstream.hostHeader = authority.host;
    } catch { throw new Error('upstream Host header is invalid'); }
  }
  route.upstream.serverName = typeof route.upstream.serverName === 'string' ? route.upstream.serverName.trim() : '';
  if (route.upstream.serverName) {
    if (route.upstream.serverName.includes(':') || net.isIP(route.upstream.serverName)) throw new Error('TLS server name must be a DNS hostname without a port');
    route.upstream.serverName = canonicalHostname(route.upstream.serverName);
  }
  route.upstream.tlsVerify = route.upstream.tlsVerify !== false;
  route.upstream.caPem = typeof route.upstream.caPem === 'string' ? route.upstream.caPem : '';
  if (route.upstream.caPem.length > 262_144) throw new Error('custom CA bundle exceeds 256 KiB');
  if (route.upstream.caPem && (!route.upstream.caPem.includes('-----BEGIN CERTIFICATE-----') || /-----BEGIN [^-\r\n]*PRIVATE KEY-----/.test(route.upstream.caPem))) {
    throw new Error('custom CA must contain certificates only, never a private key');
  }
  if (route.upstream.protocol === 'http' && route.upstream.caPem) throw new Error('custom CA is only valid for HTTPS upstreams');
  route.timeouts = route.timeouts && typeof route.timeouts === 'object' ? clone(route.timeouts) : {};
  rejectUnknownKeys(route.timeouts, TIMEOUT_KEYS, 'route timeouts');
  route.timeouts.connectMs = boundedInteger(route.timeouts.connectMs, 'connect timeout', 100, 120000, 5000);
  route.timeouts.responseMs = boundedInteger(route.timeouts.responseMs, 'response timeout', 100, 600000, 30000);
  route.timeouts.idleMs = boundedInteger(route.timeouts.idleMs, 'idle timeout', 1000, 3_600_000, 60000);
  route.health = route.health && typeof route.health === 'object' ? clone(route.health) : {};
  rejectUnknownKeys(route.health, HEALTH_KEYS, 'route health settings');
  route.health.enabled = route.health.enabled !== false;
  route.health.path = route.health.path === undefined ? '/' : requestPath(route.health.path, 'health-check path');
  route.health.method = ['GET', 'HEAD'].includes(route.health.method) ? route.health.method : 'GET';
  route.health.expectedStatuses = Array.isArray(route.health.expectedStatuses) ? route.health.expectedStatuses.map(Number) : [200, 204, 301, 302, 401, 403];
  if (!route.health.expectedStatuses.length || route.health.expectedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) throw new Error('health expected statuses are invalid');
  route.response = route.response && typeof route.response === 'object' ? clone(route.response) : {};
  rejectUnknownKeys(route.response, RESPONSE_KEYS, 'route response settings');
  route.response.maxInjectBytes = boundedInteger(route.response.maxInjectBytes, 'maximum injection body size', 1024, 16_777_216, 2_097_152);
  route.excludedPaths = pathList(route.excludedPaths, 'route excluded paths');
  route.cspMode = route.cspMode === 'preserve' ? 'preserve' : 'skip';
  route.profileIds = stringList(route.profileIds, 'profile IDs', 50);
  if (route.profileIds.some((profileId) => !/^profile_[0-9a-f-]{36}$/.test(profileId))) throw new Error('profile ID is invalid');
  route.injections = Array.isArray(route.injections) ? route.injections.map((item) => validateInjection(item)) : [];
  const hasResolvedItems = Object.hasOwn(route, 'resolvedProfileItems');
  if (hasResolvedItems && !Array.isArray(route.resolvedProfileItems)) throw new Error('resolved profile items must be a list');
  if (hasResolvedItems) route.resolvedProfileItems = route.resolvedProfileItems.map((item) => validateInjection(item));
  const hasResolvedProfiles = Object.hasOwn(route, 'resolvedProfiles');
  if (hasResolvedProfiles) {
    if (!Array.isArray(route.resolvedProfiles) || route.resolvedProfiles.length > 50) throw new Error('resolved profiles must be a bounded list');
    route.resolvedProfiles = route.resolvedProfiles.map((profile) => {
      if (profile && typeof profile === 'object' && !Array.isArray(profile)) rejectUnknownKeys(profile, new Set(['id', 'name', 'revision']), 'resolved profile');
      if (!profile || typeof profile !== 'object' || !/^profile_[0-9a-f-]{36}$/.test(profile.id) || typeof profile.name !== 'string' || profile.name.length > 200 || !Number.isInteger(profile.revision) || profile.revision < 1) {
        throw new Error('resolved profile metadata is invalid');
      }
      return { id: profile.id, name: profile.name, revision: profile.revision };
    });
  }
  validateItemCollection([...(route.resolvedProfileItems ?? []), ...route.injections], 'a materialized route');
  route.notes = typeof route.notes === 'string' ? route.notes.slice(0, 8192) : '';
  return route;
}

export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('profile must be an object');
  rejectUnknownKeys(input, PROFILE_KEYS, 'profile');
  const profile = clone(input);
  delete profile.revision;
  profile.id = profile.id || id('profile_');
  if (!/^profile_[0-9a-f-]{36}$/.test(profile.id)) throw new Error('profile id is invalid');
  profile.name = requiredString(profile.name, 'profile name', 200);
  profile.kind = profile.kind === 'umami' ? 'umami' : 'custom';
  profile.enabled = profile.enabled !== false;
  profile.items = Array.isArray(profile.items) ? profile.items.map((item) => validateInjection(item)) : [];
  validateItemCollection(profile.items, 'a profile');
  profile.notes = typeof profile.notes === 'string' ? profile.notes.slice(0, 8192) : '';
  return profile;
}
