import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig } from '../src/config.mjs';
import { canonicalHostname } from '../src/lib/util.mjs';

test('configuration rejects remote admin, invalid CIDRs, invalid ports, and prototype keys', () => {
  assert.throws(() => validateConfig({ admin: { listen: '0.0.0.0' } }), /allowRemote/);
  assert.throws(() => validateConfig({ admin: { listen: '0.0.0.0', allowRemote: true, cookieSecure: true, tlsCertFile: 'cert.pem', tlsKeyFile: 'key.pem', allowedCidrs: ['10.0.0.0/8'] } }), /explicit private IP/);
  assert.throws(() => validateConfig({ admin: { listen: '192.168.1.104', allowRemote: true, cookieSecure: true, allowedCidrs: ['192.168.1.0/24'] } }), /requires native TLS/);
  assert.throws(() => validateConfig({ admin: { listen: '8.8.8.8', allowRemote: true, cookieSecure: true, tlsCertFile: 'cert.pem', tlsKeyFile: 'key.pem', allowedCidrs: ['10.0.0.0/8'] } }), /private IP/);
  assert.throws(() => validateConfig({ admin: { listen: '192.168.1.104', allowRemote: true, cookieSecure: true, tlsCertFile: 'cert.pem', tlsKeyFile: 'key.pem', allowedCidrs: ['0.0.0.0/0'] } }), /only loopback/);
  assert.throws(() => validateConfig({ admin: { listen: '192.168.1.104', allowRemote: true, cookieSecure: true, tlsCertFile: 'cert.pem', tlsKeyFile: 'key.pem', allowedCidrs: ['192.168.2.0/24'] } }), /must include/);
  const remote = validateConfig({ admin: { listen: '192.168.1.104', allowRemote: true, cookieSecure: true, tlsCertFile: 'cert.pem', tlsKeyFile: 'key.pem', allowedCidrs: ['192.168.1.0/24'] } });
  assert.equal(remote.admin.listen, '192.168.1.104');
  assert.equal(remote.admin.username, 'admin');
  assert.throws(() => validateConfig({ network: { allowedTargetCidrs: ['bad/8'] } }), /invalid CIDR/);
  assert.throws(() => validateConfig({ network: { allowedPorts: [0] } }), /allowed ports/);
  assert.throws(() => validateConfig(JSON.parse('{"__proto__":{"polluted":true}}')), /unsafe configuration key/);
  assert.throws(() => validateConfig(JSON.parse('{"admin":{"extra":{"constructor":{"polluted":true}}}}')), /unsafe configuration key/);
  assert.throws(() => validateConfig({ admin: { allowRemote: 'false' } }), /true or false/);
  assert.throws(() => validateConfig({ admin: { listen: 'localhost' } }), /literal IPv4 or IPv6/);
  assert.throws(() => validateConfig({ netbird: { writeEnabled: true } }), /must remain false/);
  assert.throws(() => validateConfig({ proxy: { typoedSetting: true } }), /unknown configuration key/);
  assert.throws(() => validateConfig({ netbird: { mode: 'api', apiBaseUrl: 'https://user:pass@api.example/api?token=x', tokenFile: 'token' } }), /credentials, a query, or a fragment/);
  assert.equal({}.polluted, undefined);
});

test('host canonicalization handles case, trailing dots, IDNs, and rejects malformed ports', () => {
  assert.equal(canonicalHostname('APP.Example.COM.:443'), 'app.example.com');
  assert.equal(canonicalHostname('täst.example'), 'xn--tst-qla.example');
  assert.throws(() => canonicalHostname('example.com:abc'));
  assert.throws(() => canonicalHostname('bad_host.example'));
});
