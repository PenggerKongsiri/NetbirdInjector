import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin UI keeps dynamic content in text nodes and CSP-compatible external assets', () => {
  const application = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  const document = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(application, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
  assert.doesNotMatch(document, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(document, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.match(document, /<script[^>]+src="\/app\.js"[^>]*><\/script>/i);
});
