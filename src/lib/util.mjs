import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { domainToASCII } from 'node:url';

export function id(prefix = '') {
  return `${prefix}${randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function json(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function text(res, status, value, headers = {}) {
  const body = Buffer.from(String(value));
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export async function readBody(req, limit = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

export function canonicalHostname(value) {
  if (typeof value !== 'string') throw new Error('hostname must be a string');
  let host = value.trim().toLowerCase();
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close < 0) throw new Error('invalid bracketed hostname');
    const port = host.slice(close + 1);
    if (port && !/^:\d{1,5}$/.test(port)) throw new Error('invalid hostname port');
    host = host.slice(1, close);
  } else {
    const colon = host.lastIndexOf(':');
    if (colon > -1) {
      if (host.indexOf(':') !== colon || !/^\d{1,5}$/.test(host.slice(colon + 1))) throw new Error('invalid hostname port');
      const port = Number(host.slice(colon + 1));
      if (port < 1 || port > 65535) throw new Error('invalid hostname port');
      host = host.slice(0, colon);
    }
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (net.isIP(host)) return host;
  const ascii = domainToASCII(host);
  if (!ascii || ascii.length > 253 || ascii.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('invalid hostname');
  return ascii;
}

export function normalizePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    throw new Error('path must start with one slash');
  }
  const q = value.indexOf('?');
  return q >= 0 ? value.slice(0, q) : value;
}

export function pathMatches(path, patterns = []) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function clone(value) {
  return structuredClone(value);
}

export function boundedInteger(value, name, min, max, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return number;
}
