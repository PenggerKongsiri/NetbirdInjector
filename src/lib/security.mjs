import { createHash, createHmac, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { safeEqual, token } from './util.mjs';

const scrypt = promisify(scryptCallback);
export const PASSWORD_HASH_PATTERN = /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
export const ADMIN_USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function normalizeAdminUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (username.length < 3 || username.length > 64 || !ADMIN_USERNAME_PATTERN.test(username)) throw new Error('administrator username must be 3 to 64 lowercase letters, numbers, dots, underscores, or hyphens');
  return username;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 1024) {
    throw new Error('administrator password must contain 14 to 1024 characters');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    if (!PASSWORD_HASH_PATTERN.test(String(encoded))) return false;
    const [kind, n, r, p, saltText, hashText] = String(encoded).split('$');
    if (kind !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1') return false;
    const expected = Buffer.from(hashText, 'base64url');
    const derived = await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return safeEqual(Buffer.from(derived).toString('base64url'), hashText);
  } catch {
    return false;
  }
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const input = String(text ?? '').toUpperCase().replace(/=+$/g, '');
  if (!input || /[^A-Z2-7]/.test(input)) throw new Error('invalid TOTP secret');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of input) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret, timeMs = Date.now()) {
  const counter = BigInt(Math.floor(Number(timeMs) / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

export function verifyTotp(secret, code, timeMs = Date.now()) {
  const candidate = String(code ?? '').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  try {
    return [-30_000, 0, 30_000].some((offset) => safeEqual(totpCode(secret, Number(timeMs) + offset), candidate));
  } catch {
    return false;
  }
}

export function totpProvisioningUri(username, secret) {
  const issuer = 'NetBird Injector Manager';
  const label = `${issuer}:${normalizeAdminUsername(username)}`;
  const parameters = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(label)}?${parameters}`;
}

function normalizeRecoveryCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function generateRecoveryCodes(count = 10) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('recovery code count is invalid');
  return Array.from({ length: count }, () => base32Encode(randomBytes(10)).match(/.{1,4}/g).join('-'));
}

export function hashRecoveryCode(code) {
  const normalized = normalizeRecoveryCode(code);
  if (!/^[A-Z2-7]{16}$/.test(normalized)) return '';
  return createHash('sha256').update(normalized).digest('base64url');
}

export class SessionManager {
  constructor({ minutes = 30, secure = false } = {}) {
    this.ttl = minutes * 60_000;
    this.secure = secure;
    this.sessions = new Map();
  }

  create(username = 'admin') {
    const sessionId = token();
    const session = { id: sessionId, csrf: token(), username, expiresAt: Date.now() + this.ttl };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(req) {
    const cookies = parseCookies(req.headers.cookie);
    const session = this.sessions.get(cookies.nim_session);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(session.id);
      return null;
    }
    session.expiresAt = Date.now() + this.ttl;
    return session;
  }

  destroy(req) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.nim_session) this.sessions.delete(cookies.nim_session);
  }

  destroyAll() {
    this.sessions.clear();
  }

  destroyAllExcept(sessionId) {
    for (const id of this.sessions.keys()) if (id !== sessionId) this.sessions.delete(id);
  }

  cookie(session) {
    return `nim_session=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.ttl / 1000)}${this.secure ? '; Secure' : ''}`;
  }

  clearCookie() {
    return `nim_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.secure ? '; Secure' : ''}`;
  }
}

function parseCookies(header = '') {
  const result = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index > 0) {
      const name = pair.slice(0, index).trim();
      result[name] = Object.hasOwn(result, name) ? null : pair.slice(index + 1).trim();
    }
  }
  return result;
}

export class LoginLimiter {
  constructor({ attempts = 5, windowMs = 15 * 60_000, blockMs = 15 * 60_000 } = {}) {
    this.attempts = attempts;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
    this.entries = new Map();
  }

  allowed(key) {
    const entry = this.entries.get(key);
    return !entry || !entry.blockedUntil || entry.blockedUntil <= Date.now();
  }

  failure(key) {
    const now = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.startedAt + this.windowMs < now) entry = { startedAt: now, count: 0 };
    entry.count += 1;
    if (entry.count >= this.attempts) entry.blockedUntil = now + this.blockMs;
    this.entries.set(key, entry);
  }

  success(key) {
    this.entries.delete(key);
  }
}

export const ADMIN_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
});
