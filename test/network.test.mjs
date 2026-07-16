import assert from 'node:assert/strict';
import dns from 'node:dns';
import test from 'node:test';
import { addressInCidrs, NetworkPolicy, parseCidr } from '../src/lib/network.mjs';

test('CIDR matching supports IPv4 and compressed IPv6', () => {
  assert.equal(addressInCidrs('100.64.1.2', [parseCidr('100.64.0.0/10')]), true);
  assert.equal(addressInCidrs('192.168.1.2', [parseCidr('100.64.0.0/10')]), false);
  assert.equal(addressInCidrs('fd12::abcd', [parseCidr('fd00::/8')]), true);
  assert.equal(addressInCidrs('fe80::1', [parseCidr('fd00::/8')]), false);
});

test('network policy rejects unauthorized ports and addresses', () => {
  const policy = new NetworkPolicy({ allowedTargetCidrs: ['100.64.0.0/10'], trustedIngressCidrs: ['100.64.0.0/10'], allowedPorts: [443] });
  assert.doesNotThrow(() => policy.assertPort(443));
  assert.throws(() => policy.assertPort(22), /allowlist/);
  assert.doesNotThrow(() => policy.assertAddress('100.64.20.30'));
  assert.throws(() => policy.assertAddress('127.0.0.1'), /outside/);
  for (const address of ['::1', '169.254.169.254', '169.254.1.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', 'fe80::1', 'fd00::1']) {
    assert.throws(() => policy.assertAddress(address), /outside/, address);
  }
  assert.equal(policy.isTrustedIngress('::ffff:100.64.20.30'), true);
  assert.doesNotThrow(() => policy.assertAddress('::ffff:100.64.20.30'));
  assert.throws(() => new NetworkPolicy({ allowedTargetCidrs: ['10.0.0.0/8'], allowedPorts: [0] }), /allowed ports/);
});

test('dial-time DNS policy rejects mixed allowed and disallowed answers', async (t) => {
  const original = dns.lookup;
  t.after(() => { dns.lookup = original; });
  dns.lookup = (_hostname, _options, callback) => callback(null, [
    { address: '100.64.10.1', family: 4 },
    { address: '169.254.169.254', family: 4 },
  ]);
  const policy = new NetworkPolicy({ allowedTargetCidrs: ['100.64.0.0/10'], allowedPorts: [443] });
  await assert.rejects(new Promise((resolve, reject) => policy.lookup()('changing.example', {}, (error, address) => error ? reject(error) : resolve(address))), /outside the global target CIDR allowlist/);
});

test('invalid CIDRs fail configuration immediately', () => {
  assert.throws(() => parseCidr('10.0.0.0/99'));
  assert.throws(() => parseCidr('not-an-ip/24'));
  assert.throws(() => parseCidr('10.0.0.0/8/extra'));
  assert.throws(() => parseCidr('fe80::1%eth0/64'));
});
