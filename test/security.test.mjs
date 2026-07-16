import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateRecoveryCodes, generateTotpSecret, hashPassword, hashRecoveryCode, LoginLimiter, normalizeAdminUsername,
  SessionManager, totpCode, totpProvisioningUri, verifyPassword, verifyTotp,
} from '../src/lib/security.mjs';

test('passwords use salted scrypt hashes', async () => {
  const hash = await hashPassword('this is a long test password');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('this is a long test password', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword('anything', hash.replace('scrypt$32768$', 'scrypt$1073741824$')), false);
  assert.equal(await verifyPassword('anything', `${hash}$unexpected`), false);
  assert.equal(await verifyPassword('anything', 'scrypt$32768$8$1$short$short'), false);
});

test('sessions expire and use strict HTTP-only cookies', () => {
  const sessions = new SessionManager({ minutes: 30, secure: true });
  const session = sessions.create();
  assert.match(sessions.cookie(session), /HttpOnly; SameSite=Strict/);
  assert.match(sessions.cookie(session), /Secure/);
  const req = { headers: { cookie: `nim_session=${session.id}` } };
  assert.equal(sessions.get(req).csrf, session.csrf);
  assert.equal(sessions.get({ headers: { cookie: `nim_session=${session.id}; nim_session=${session.id}` } }), null);
  sessions.destroy(req);
  assert.equal(sessions.get(req), null);
});

test('login limiter blocks repeated failures', () => {
  const limiter = new LoginLimiter({ attempts: 2, windowMs: 1000, blockMs: 1000 });
  limiter.failure('ip');
  assert.equal(limiter.allowed('ip'), true);
  limiter.failure('ip');
  assert.equal(limiter.allowed('ip'), false);
  limiter.success('ip');
  assert.equal(limiter.allowed('ip'), true);
});

test('administrator usernames, TOTP, and one-time recovery material are bounded', () => {
  assert.equal(normalizeAdminUsername(' Admin.User '), 'admin.user');
  assert.throws(() => normalizeAdminUsername('x'), /3 to 64/);
  assert.throws(() => normalizeAdminUsername('admin@example.com'), /3 to 64/);
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(rfcSecret, 59_000), '287082');
  assert.equal(verifyTotp(rfcSecret, '287082', 59_000), true);
  assert.equal(verifyTotp(rfcSecret, '287082', 119_000), false);
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.match(totpProvisioningUri('admin.user', secret), /^otpauth:\/\/totp\//);
  assert.equal(new URL(totpProvisioningUri('admin.user', secret)).searchParams.get('secret'), secret);
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(codes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)));
  assert.ok(codes.every((code) => /^[A-Za-z0-9_-]{43}$/.test(hashRecoveryCode(code))));
  assert.equal(hashRecoveryCode('invalid'), '');
});
