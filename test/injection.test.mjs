import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import { assessEligibility, decodeBody, encodeBody, injectHtml, previewInjection } from '../src/lib/injection.mjs';
import { defaultRoute, validateRoute } from '../src/lib/model.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';

const policy = new NetworkPolicy({ allowedTargetCidrs: ['100.64.0.0/10'], trustedIngressCidrs: [], allowedPorts: [8080] });

function routeWith(items, overrides = {}) {
  const route = defaultRoute();
  route.hostname = 'app.example.com';
  route.enabled = true;
  route.mode = 'inject';
  route.upstream.host = '100.64.0.10';
  route.injections = items;
  Object.assign(route, overrides);
  return validateRoute(route, policy);
}

test('injects ordered items and stable markers exactly once', () => {
  const route = routeWith([
    { name: 'Second', enabled: true, type: 'inline-script', content: 'second()', location: 'body-end', priority: 20 },
    { name: 'First', enabled: true, type: 'inline-script', content: 'first()', location: 'body-end', priority: 10 },
  ]);
  const first = injectHtml('<HTML><HEAD></HEAD><BODY><p>Hello</p></BODY></HTML>', route, { path: '/' });
  assert.equal(first.modified, true);
  assert.ok(first.html.indexOf('first()') < first.html.indexOf('second()'));
  assert.equal((first.html.match(/nim:route_/g) || []).length, 4);
  const second = injectHtml(first.html, route, { path: '/' });
  assert.equal(second.modified, false);
  assert.deepEqual(second.skipped.map((entry) => entry.reason), ['existing-marker', 'existing-marker']);
});

test('general injection types, locations, and hostname/path scopes compose deterministically', () => {
  const route = routeWith([
    { name: 'Head CSS', type: 'external-style', enabled: true, url: 'https://assets.example/site.css', location: 'head-start', priority: 0, attributes: { integrity: 'sha256-fake', crossorigin: 'anonymous' } },
    { name: 'Meta', type: 'meta', enabled: true, location: 'head-start', priority: 1, attributes: { name: 'verification', content: 'fake-value' } },
    { name: 'Inline CSS', type: 'inline-style', enabled: true, content: 'body{color:red}', location: 'head-end', priority: 2 },
    { name: 'External JS', type: 'external-script', enabled: true, url: 'https://assets.example/app.js', location: 'head-end', priority: 3, attributes: { defer: true } },
    { name: 'Body HTML', type: 'html', enabled: true, content: '<aside>notice</aside>', location: 'body-start', priority: 4, includeHostnames: ['app.example.com'], includePaths: ['/allowed/*'] },
    { name: 'Inline JS', type: 'inline-script', enabled: true, content: 'bootNow()', location: 'body-end', priority: 5, excludePaths: ['/allowed/private/*'] },
  ]);
  const result = injectHtml('<html><head></head><body><main>page</main></body></html>', route, { hostname: 'app.example.com', path: '/allowed/page' });
  assert.equal(result.modified, true);
  assert.match(result.html, /<head>\s*<!-- nim:[^]*site\.css[^]*verification/);
  assert.ok(result.html.indexOf('body{color:red}') < result.html.indexOf('app.js'));
  assert.match(result.html, /<body>\s*<!-- nim:[^]*<aside>notice<\/aside>/);
  assert.ok(result.html.indexOf('bootNow()') < result.html.indexOf('</body>'));
  assert.equal(result.applied.length, 6);

  const excluded = injectHtml('<html><head></head><body></body></html>', route, { hostname: 'other.example.com', path: '/allowed/private/one' });
  assert.doesNotMatch(excluded.html, /<aside>notice<\/aside>|bootNow\(\)/);
  assert.equal(excluded.applied.length, 4);
});

test('missing insertion points preserve the original HTML', () => {
  const route = routeWith([{ name: 'Head script', type: 'inline-script', enabled: true, content: 'ok()', location: 'head-end', priority: 0 }]);
  const html = '<main>fragment only</main>';
  const result = injectHtml(html, route, { path: '/' });
  assert.equal(result.html, html);
  assert.equal(result.modified, false);
  assert.match(result.warnings[0], /missing/);
});

test('document boundaries ignore fake tags inside comments and raw-text elements', () => {
  const route = routeWith([
    { name: 'Head start', type: 'inline-style', enabled: true, content: 'a{}', location: 'head-start', priority: 0 },
    { name: 'Head end', type: 'inline-script', enabled: true, content: 'ok()', location: 'head-end', priority: 1 },
  ]);
  const html = '<!-- <head>fake</head> --><html><head><script>const fake = "</head>";</script></head><body></body></html>';
  const result = injectHtml(html, route, { path: '/' });
  assert.equal(result.modified, true);
  assert.match(result.html, /<head>\s*<!-- nim:/);
  assert.match(result.html, /<\/script>\s*<!-- nim:[^]*ok\(\)[^]*<\/head>/);
  assert.match(result.html, /^<!-- <head>fake<\/head> -->/);
});

test('ambiguous or unterminated HTML boundaries fail closed', () => {
  const route = routeWith([{ name: 'Body', type: 'inline-style', enabled: true, content: 'a{}', location: 'body-end', priority: 0 }]);
  for (const html of ['<html><body>one<body>two</body></html>', '<html><body><!-- never closed </body></html>']) {
    const result = injectHtml(html, route, { path: '/' });
    assert.equal(result.modified, false);
    assert.equal(result.html, html);
  }
});

test('literal duplicate detection is deterministic and does not execute regex', () => {
  const route = routeWith([{ name: 'Analytics', type: 'external-script', enabled: true, url: 'https://a.example/script.js', location: 'head-end', priority: 0, duplicatePattern: 'data-existing="[not-regex]"' }]);
  const result = injectHtml('<html><head><meta data-existing="[not-regex]"></head><body></body></html>', route, { path: '/' });
  assert.equal(result.modified, false);
  assert.equal(result.skipped[0].reason, 'duplicate-pattern');
});

test('automatic duplicate detection skips equivalent script URLs and inline content', () => {
  const route = routeWith([
    { name: 'Existing URL', type: 'external-script', enabled: true, url: 'https://a.example/existing.js', location: 'head-end', priority: 0 },
    { name: 'Existing inline', type: 'inline-script', enabled: true, content: 'alreadyThere()', location: 'head-end', priority: 1 },
  ]);
  const result = injectHtml('<html><head><script src="https://a.example/existing.js"></script><script>alreadyThere()</script></head><body></body></html>', route, { path: '/' });
  assert.equal(result.modified, false);
  assert.deepEqual(result.skipped.map((entry) => entry.reason), ['automatic-duplicate', 'automatic-duplicate']);
});

test('automatic duplicate detection also deduplicates configured items at one insertion point', () => {
  const route = routeWith([
    { name: 'First copy', type: 'external-script', enabled: true, url: 'https://a.example/same.js', location: 'head-end', priority: 0 },
    { name: 'Second copy', type: 'external-script', enabled: true, url: 'https://a.example/same.js', location: 'head-end', priority: 1 },
  ]);
  const result = injectHtml('<html><head></head><body></body></html>', route, { path: '/' });
  assert.equal((result.html.match(/same\.js/g) || []).length, 1);
  assert.equal(result.skipped[0].reason, 'automatic-duplicate');
});

test('meta CSP and unsupported meta charset preserve original HTML', () => {
  const route = routeWith([{ name: 'A', type: 'inline-style', enabled: true, content: 'x{}', location: 'head-end', priority: 0 }]);
  for (const html of [
    '<html><head><meta http-equiv="Content-Security-Policy" content="default-src self"></head><body></body></html>',
    '<html><head><meta charset="iso-8859-1"></head><body></body></html>',
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body></body></html>',
  ]) {
    const result = injectHtml(html, route, { path: '/' });
    assert.equal(result.modified, false);
    assert.equal(result.html, html);
  }
});

test('preview preserves the original when injected output would exceed the route limit', () => {
  const route = routeWith([{ name: 'Large', type: 'inline-script', enabled: true, content: 'x'.repeat(300), location: 'head-end', priority: 0 }], { response: { maxInjectBytes: 1024 } });
  const html = `<html><head></head><body>${'a'.repeat(800)}</body></html>`;
  const result = previewInjection({ route, html, path: '/' });
  assert.equal(result.modified, false);
  assert.equal(result.result, html);
  assert.match(result.warnings.at(-1), /exceeds the route response limit/);
});

test('enforcing CSP skips by default while report-only CSP warns without blocking', () => {
  const route = routeWith([{ name: 'Inline', type: 'inline-script', enabled: true, content: 'ok()', location: 'head-end', priority: 0 }]);
  const headers = { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" };
  assert.equal(assessEligibility({ route, headers, method: 'GET', status: 200, path: '/' }).eligible, false);
  route.cspMode = 'preserve';
  const result = previewInjection({ route, headers, html: '<html><head></head><body></body></html>', path: '/' });
  assert.equal(result.modified, true);
  assert.match(result.warnings[0], /may be blocked/);
  route.cspMode = 'skip';
  const reportOnly = assessEligibility({ route, headers: { 'content-type': 'text/html', 'content-security-policy-report-only': "script-src 'none'" }, method: 'GET', status: 200, path: '/' });
  assert.equal(reportOnly.eligible, true);
  assert.match(reportOnly.warnings[0], /may generate policy reports/);
  const both = assessEligibility({ route, headers: { ...headers, 'content-security-policy-report-only': "script-src 'none'" }, method: 'GET', status: 200, path: '/' });
  assert.equal(both.eligible, false);
  assert.equal(both.warnings.length, 2);
});

test('compressed response helpers enforce decompressed size limit', () => {
  const source = Buffer.from('a'.repeat(100_000));
  const compressed = gzipSync(source);
  assert.throws(() => decodeBody(compressed, 'gzip', 4096));
  const roundTrip = decodeBody(encodeBody(Buffer.from('hello'), 'gzip'), 'gzip', 4096);
  assert.equal(roundTrip.toString(), 'hello');
  assert.equal(gunzipSync(encodeBody(Buffer.from('world'), 'gzip')).toString(), 'world');
});

test('binary, JSON, range, SSE, download, errors, and excluded paths are not eligible', () => {
  const route = routeWith([{ name: 'A', type: 'inline-style', enabled: true, content: 'x{}', location: 'head-end', priority: 0 }]);
  const cases = [
    { headers: { 'content-type': 'application/json' } },
    { headers: { 'content-type': 'image/png' } },
    { headers: { 'content-type': 'application/pdf' } },
    { headers: { 'content-type': 'audio/mpeg' } },
    { headers: { 'content-type': 'video/mp4' } },
    { headers: { 'content-type': 'text/event-stream' } },
    { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename=x.html' } },
    { headers: { 'content-type': 'text/html', 'content-range': 'bytes 0-5/10' } },
    { headers: { 'content-type': 'text/html; charset=iso-8859-1' } },
    { headers: { 'content-type': 'text/html' }, requestHeaders: { range: 'bytes=0-10' } },
    { headers: { 'content-type': 'text/html' }, status: 302 },
    { headers: { 'content-type': 'text/html' }, method: 'POST' },
    { headers: { 'content-type': 'text/html' }, path: '/api/users' },
    { headers: { 'content-type': 'text/html' }, path: '/%61pi/users' },
    { headers: { 'content-type': 'text/html' }, path: '/bad%zz' },
  ];
  for (const value of cases) assert.equal(assessEligibility({ route, method: 'GET', status: 200, path: '/', ...value }).eligible, false);
});

test('Umami supports analytics, recorder, both, and recorder-only profiles', () => {
  const route = routeWith([{ name: 'Recorder', type: 'umami', enabled: true, location: 'head-end', priority: 0, options: { analytics: false, recorder: true, websiteId: 'website-one', recorderUrl: 'https://analytics.example/recorder.js' } }]);
  const result = injectHtml('<html><head></head><body></body></html>', route, { path: '/' });
  assert.match(result.html, /recorder\.js/);
  assert.match(result.html, /data-website-id="website-one"/);
});
