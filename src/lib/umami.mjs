const MAX_SNIPPET_BYTES = 32_768;
const MAX_SCRIPT_TAGS = 2;
const SUPPORTED_ATTRIBUTES = new Set(['src', 'defer', 'data-website-id']);

function fail(message) {
  throw new Error(`Umami snippet ${message}`);
}

function tagEnd(source, start) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

function parseAttributes(tag) {
  const open = /^<\s*script\b/i.exec(tag);
  if (!open) fail('must contain only external <script> tags');
  let cursor = open[0].length;
  const attributes = {};
  while (cursor < tag.length - 1) {
    while (/\s/.test(tag[cursor] ?? '')) cursor += 1;
    if (tag[cursor] === '>') break;
    if (tag.startsWith('/>', cursor)) fail('must use a closing </script> tag');
    const nameMatch = /^[a-z_:][a-z0-9_.:-]*/i.exec(tag.slice(cursor));
    if (!nameMatch) fail('contains malformed script attributes');
    const name = nameMatch[0].toLowerCase();
    cursor += nameMatch[0].length;
    if (Object.hasOwn(attributes, name)) fail(`contains a duplicate ${name} attribute`);
    if (!SUPPORTED_ATTRIBUTES.has(name)) fail(`uses unsupported script attribute: ${name}`);
    while (/\s/.test(tag[cursor] ?? '')) cursor += 1;
    let value = true;
    if (tag[cursor] === '=') {
      cursor += 1;
      while (/\s/.test(tag[cursor] ?? '')) cursor += 1;
      const quote = tag[cursor];
      if (quote !== '"' && quote !== "'") fail(`requires a quoted value for ${name}`);
      cursor += 1;
      const end = tag.indexOf(quote, cursor);
      if (end < 0) fail(`contains an unterminated ${name} value`);
      value = tag.slice(cursor, end);
      cursor = end + 1;
    } else if (name !== 'defer') fail(`requires a value for ${name}`);
    attributes[name] = value;
  }
  return attributes;
}

function readScripts(snippet) {
  const scripts = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    while (/\s/.test(snippet[cursor] ?? '')) cursor += 1;
    if (cursor >= snippet.length) break;
    if (!/^<\s*script\b/i.test(snippet.slice(cursor))) fail('must contain only external <script> tags');
    const startEnd = tagEnd(snippet, cursor);
    if (startEnd < 0) fail('contains an unterminated opening tag');
    const closeMatch = /<\s*\/\s*script\s*>/i.exec(snippet.slice(startEnd + 1));
    if (!closeMatch) fail('contains an unterminated script tag');
    const closeStart = startEnd + 1 + closeMatch.index;
    if (snippet.slice(startEnd + 1, closeStart).trim()) fail('must not contain inline JavaScript');
    scripts.push(parseAttributes(snippet.slice(cursor, startEnd + 1)));
    if (scripts.length > MAX_SCRIPT_TAGS) fail(`may contain at most ${MAX_SCRIPT_TAGS} script tags`);
    cursor = closeStart + closeMatch[0].length;
  }
  return scripts;
}

function externalUrl(value) {
  if (typeof value !== 'string' || !value) fail('requires src on every script tag');
  let parsed;
  try { parsed = new URL(value); } catch { fail('contains an invalid script URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail('URLs must be credential-free HTTP(S) URLs');
  }
  return parsed.href;
}

export function parseUmamiSnippet(input) {
  if (typeof input !== 'string' || !input.trim()) fail('is required');
  if (Buffer.byteLength(input) > MAX_SNIPPET_BYTES) fail('exceeds 32 KiB');
  const scripts = readScripts(input.trim());
  if (!scripts.length) fail('requires at least one script tag');

  let websiteId = '';
  let analyticsUrl = '';
  let recorderUrl = '';
  for (const attributes of scripts) {
    const currentWebsiteId = attributes['data-website-id'];
    if (typeof currentWebsiteId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(currentWebsiteId)) {
      fail('requires a valid data-website-id on every script tag');
    }
    if (websiteId && websiteId !== currentWebsiteId) fail('uses different website IDs');
    websiteId = currentWebsiteId;
    const url = externalUrl(attributes.src);
    const isRecorder = /(?:^|\/)recorder\.js$/i.test(new URL(url).pathname);
    if (isRecorder) {
      if (recorderUrl) fail('contains more than one recorder script');
      recorderUrl = url;
    } else {
      if (analyticsUrl) fail('contains more than one analytics script');
      analyticsUrl = url;
    }
  }

  return {
    websiteId,
    analytics: Boolean(analyticsUrl),
    recorder: Boolean(recorderUrl),
    analyticsUrl,
    recorderUrl,
  };
}
