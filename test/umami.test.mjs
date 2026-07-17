import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInjection } from '../src/lib/injection.mjs';
import { validateInjection } from '../src/lib/model.mjs';
import { parseUmamiSnippet } from '../src/lib/umami.mjs';

const websiteId = '63202f5f-067c-44e3-9e41-c60ea2654350';

test('Umami snippet parser extracts analytics and recorder without executing markup', () => {
  const parsed = parseUmamiSnippet(`
    <script defer src="https://analytics.fufy.cc/script.js" data-website-id="${websiteId}"></script>
    <script data-website-id='${websiteId}' src='https://analytics.fufy.cc/recorder.js' defer></script>
  `);
  assert.deepEqual(parsed, {
    websiteId,
    analytics: true,
    recorder: true,
    analyticsUrl: 'https://analytics.fufy.cc/script.js',
    recorderUrl: 'https://analytics.fufy.cc/recorder.js',
  });
});

test('Umami snippet parser supports one renamed tracker or recorder script', () => {
  assert.deepEqual(parseUmamiSnippet(`<script defer src="https://stats.example/x.js?site=one" data-website-id="site_one"></script>`), {
    websiteId: 'site_one', analytics: true, recorder: false,
    analyticsUrl: 'https://stats.example/x.js?site=one', recorderUrl: '',
  });
  assert.deepEqual(parseUmamiSnippet(`<script defer src="https://stats.example/recorder.js" data-website-id="site_one"></script>`), {
    websiteId: 'site_one', analytics: false, recorder: true,
    analyticsUrl: '', recorderUrl: 'https://stats.example/recorder.js',
  });
});

test('Umami snippet parser rejects ambiguous or active content', () => {
  const invalid = [
    '',
    '<img src="https://stats.example/pixel">',
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}">alert(1)</script>`,
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}" onload="alert(1)"></script>`,
    `<script src=https://stats.example/script.js data-website-id="${websiteId}"></script>`,
    `<script src="https://user:secret@stats.example/script.js" data-website-id="${websiteId}"></script>`,
    `<script src="https://stats.example/script.js"></script>`,
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}" data-website-id="other"></script>`,
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}"></script><script src="https://stats.example/other.js" data-website-id="${websiteId}"></script>`,
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}"></script><script src="https://stats.example/recorder.js" data-website-id="other"></script>`,
    `<script src="https://stats.example/script.js" data-website-id="${websiteId}"></script><script src="https://stats.example/recorder.js" data-website-id="${websiteId}"></script><script src="https://stats.example/third.js" data-website-id="${websiteId}"></script>`,
  ];
  for (const snippet of invalid) assert.throws(() => parseUmamiSnippet(snippet), /Umami snippet/);
  assert.throws(() => parseUmamiSnippet('x'.repeat(32_769)), /exceeds 32 KiB/);
});

test('structured Umami rendering includes website ID on analytics and recorder scripts', () => {
  const item = validateInjection({
    name: 'Umami', type: 'umami', enabled: true, location: 'head-end', priority: 0,
    options: {
      analytics: true, recorder: true, websiteId,
      analyticsUrl: 'https://analytics.fufy.cc/script.js',
      recorderUrl: 'https://analytics.fufy.cc/recorder.js',
    },
  });
  const rendered = renderInjection(item);
  assert.equal((rendered.match(/data-website-id=/g) || []).length, 2);
  assert.match(rendered, /script\.js/);
  assert.match(rendered, /recorder\.js/);
  assert.throws(() => validateInjection({
    name: 'Recorder', type: 'umami', enabled: true, location: 'head-end', priority: 0,
    options: { analytics: false, recorder: true, recorderUrl: 'https://analytics.example/recorder.js' },
  }), /require a website ID/);
});
