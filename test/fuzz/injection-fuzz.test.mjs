import assert from 'node:assert/strict';
import test from 'node:test';
import { injectHtml } from '../../src/lib/injection.mjs';
import { defaultRoute, validateRoute } from '../../src/lib/model.mjs';
import { NetworkPolicy } from '../../src/lib/network.mjs';

test('deterministic malformed-HTML corpus never throws or partially marks items', () => {
  const policy = new NetworkPolicy({ allowedTargetCidrs: ['100.64.0.0/10'], trustedIngressCidrs: [], allowedPorts: [8080] });
  const route = defaultRoute(); route.hostname = 'fuzz.example.com'; route.upstream.host = '100.64.0.1'; route.mode = 'inject';
  route.injections = [{ name: 'Fuzz', type: 'html', enabled: true, content: '<span>safe marker</span>', location: 'body-end', priority: 0 }];
  const validated = validateRoute(route, policy);
  let seed = 0x12345678;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const alphabet = '<>/BODYhead\"\'\0 abcXYZ=-';
  for (let sample = 0; sample < 2000; sample += 1) {
    let html = '';
    const length = random() % 2048;
    for (let index = 0; index < length; index += 1) html += alphabet[random() % alphabet.length];
    const result = injectHtml(html, validated, { path: '/' });
    assert.equal(typeof result.html, 'string');
    const starts = (result.html.match(/:start -->/g) || []).length;
    const ends = (result.html.match(/:end -->/g) || []).length;
    assert.equal(starts, ends);
  }
});
