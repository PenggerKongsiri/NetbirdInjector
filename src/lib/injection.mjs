import { brotliCompressSync, brotliDecompressSync, deflateSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { escapeHtml, pathMatches } from './util.mjs';

function pathVariants(path) {
  const values = [path];
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) values.push(decoded);
    if (!decoded.startsWith('//') && !/[\\\x00-\x1f\x7f]/.test(decoded)) {
      const normalized = new URL(decoded, 'http://scope.invalid').pathname;
      if (!values.includes(normalized)) values.push(normalized);
    }
  } catch {
    return null;
  }
  return values;
}

function anyPathMatches(path, patterns) {
  const variants = pathVariants(path);
  return variants ? variants.some((value) => pathMatches(value, patterns)) : false;
}

function attributeText(attributes = {}, nonce = '') {
  const rendered = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === '') continue;
    rendered.push(value === true ? name : `${name}="${escapeHtml(value)}"`);
  }
  if (nonce) rendered.push(`nonce="${escapeHtml(nonce)}"`);
  return rendered.length ? ` ${rendered.join(' ')}` : '';
}

function existingNonce(html) {
  return html.match(/<(?:script|style)\b[^>]*\bnonce\s*=\s*["']([^"']+)["'][^>]*>/i)?.[1] ?? '';
}

export function renderInjection(item, html = '') {
  const nonce = item.nonceBehavior === 'copy-existing' ? existingNonce(html) : '';
  const attributes = attributeText(item.attributes, nonce);
  switch (item.type) {
    case 'external-script': return `<script src="${escapeHtml(item.url)}"${attributes}></script>`;
    case 'inline-script': return `<script${attributes}>${item.content}</script>`;
    case 'external-style': return `<link rel="stylesheet" href="${escapeHtml(item.url)}"${attributes}>`;
    case 'inline-style': return `<style${attributes}>${item.content}</style>`;
    case 'html': return item.content;
    case 'meta': {
      const metaAttributes = attributeText(item.attributes);
      return `<meta${metaAttributes}>`;
    }
    case 'umami': {
      const parts = [];
      if (item.options.analytics) {
        parts.push(`<script defer src="${escapeHtml(item.options.analyticsUrl)}" data-website-id="${escapeHtml(item.options.websiteId)}"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ''}></script>`);
      }
      if (item.options.recorder) {
        parts.push(`<script defer src="${escapeHtml(item.options.recorderUrl)}"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ''}></script>`);
      }
      return parts.join('\n');
    }
    default: throw new Error(`unsupported injection type: ${item.type}`);
  }
}

function eligibleItem(item, { hostname, path, environment }) {
  if (!item.enabled) return false;
  if (item.includeHostnames?.length && !item.includeHostnames.includes(hostname)) return false;
  if (item.includePaths?.length && !anyPathMatches(path, item.includePaths)) return false;
  if (anyPathMatches(path, item.excludePaths)) return false;
  if (item.environments?.length && !item.environments.includes(environment)) return false;
  return true;
}

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes']);

function tagEnd(html, start) {
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

function rawTextEnd(html, lower, name, start) {
  let cursor = start;
  while (cursor < html.length) {
    const index = lower.indexOf(`</${name}`, cursor);
    if (index < 0) return -1;
    const afterName = lower[index + name.length + 2];
    if (afterName === '>' || /\s/.test(afterName ?? '')) return tagEnd(html, index + name.length + 2);
    cursor = index + name.length + 2;
  }
  return -1;
}

function htmlBoundaries(html) {
  const lower = html.toLowerCase();
  const found = { headStart: [], headEnd: [], bodyStart: [], bodyEnd: [] };
  let cursor = 0;
  while (cursor < html.length) {
    const index = html.indexOf('<', cursor);
    if (index < 0) break;
    if (lower.startsWith('<!--', index)) {
      const end = lower.indexOf('-->', index + 4);
      if (end < 0) return null;
      cursor = end + 3;
      continue;
    }
    const match = /^<\s*(\/?)\s*([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(index));
    if (!match) {
      cursor = index + 1;
      continue;
    }
    const end = tagEnd(html, index + match[0].length);
    if (end < 0) return null;
    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    if (name === 'head') found[closing ? 'headEnd' : 'headStart'].push(closing ? index : end + 1);
    if (name === 'body') found[closing ? 'bodyEnd' : 'bodyStart'].push(closing ? index : end + 1);
    if (!closing && RAW_TEXT_ELEMENTS.has(name) && !/\/\s*>$/.test(html.slice(index, end + 1))) {
      const rawEnd = rawTextEnd(html, lower, name, end + 1);
      if (rawEnd < 0) return null;
      cursor = rawEnd + 1;
      continue;
    }
    cursor = end + 1;
  }
  const boundaries = Object.fromEntries(Object.entries(found).map(([name, values]) => [name, values.length === 1 ? values[0] : -1]));
  if (boundaries.headStart < 0 || boundaries.headEnd < boundaries.headStart) boundaries.headStart = boundaries.headEnd = -1;
  if (boundaries.bodyStart < 0 || boundaries.bodyEnd < boundaries.bodyStart) boundaries.bodyStart = boundaries.bodyEnd = -1;
  if (boundaries.headEnd >= 0 && boundaries.bodyStart >= 0 && boundaries.headEnd > boundaries.bodyStart) return null;
  return boundaries;
}

function findInsertion(html, location) {
  const boundaries = htmlBoundaries(html);
  if (!boundaries) return -1;
  const names = { 'head-start': 'headStart', 'head-end': 'headEnd', 'body-start': 'bodyStart', 'body-end': 'bodyEnd' };
  return boundaries[names[location]] ?? -1;
}

function metaPolicyWarnings(html, route) {
  const warnings = [];
  let blocked = false;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (/\bhttp-equiv\s*=\s*["']?content-security-policy\b/i.test(tag)) {
      warnings.push('HTML meta Content-Security-Policy is present; injected content may be blocked');
      if (route.cspMode !== 'preserve') blocked = true;
    }
    const charset = tag.match(/\bcharset\s*=\s*["']?([^\s"'/>]+)/i)?.[1]?.toLowerCase();
    const contentValue = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const legacyCharset = /\bhttp-equiv\s*=\s*["']?content-type\b/i.test(tag)
      ? (contentValue?.slice(1).find((value) => value !== undefined)?.match(/\bcharset\s*=\s*([^\s;"']+)/i)?.[1]?.toLowerCase() ?? '')
      : '';
    const declaredCharset = charset || legacyCharset;
    if (declaredCharset && !['utf-8', 'utf8', 'us-ascii'].includes(declaredCharset)) {
      warnings.push(`HTML declares unsupported character encoding: ${declaredCharset}`);
      blocked = true;
    }
  }
  return { warnings, blocked };
}

function automaticDuplicate(item, html) {
  const indicators = [];
  if (item.url) indicators.push(item.url);
  if (item.type === 'umami') indicators.push(item.options?.analyticsUrl, item.options?.recorderUrl, item.options?.websiteId);
  if (['inline-script', 'inline-style', 'html'].includes(item.type) && item.content?.length >= 8) indicators.push(item.content);
  return indicators.filter(Boolean).some((indicator) => html.includes(indicator));
}

export function injectHtml(html, route, context = {}) {
  const path = context.path ?? '/';
  const hostname = context.hostname ?? route.hostname;
  const environment = route.environment ?? 'production';
  const warnings = [];
  const applied = [];
  const skipped = [];
  let result = String(html);
  const metaPolicy = metaPolicyWarnings(result, route);
  if (metaPolicy.blocked) return { html: result, modified: false, applied, skipped, warnings: metaPolicy.warnings };
  warnings.push(...metaPolicy.warnings);
  const items = [...(route.resolvedProfileItems ?? []), ...(route.injections ?? [])]
    .filter((item) => eligibleItem(item, { hostname, path, environment }))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const location of ['head-start', 'head-end', 'body-start', 'body-end']) {
    const positioned = items.filter((item) => item.location === location);
    if (!positioned.length) continue;
    const snippets = [];
    for (const item of positioned) {
      const marker = `nim:${route.id}:${item.id}`;
      if (result.includes(`<!-- ${marker}:start -->`)) {
        warnings.push(`${item.name}: existing manager marker found`);
        skipped.push({ id: item.id, reason: 'existing-marker' });
        continue;
      }
      if (item.duplicatePattern && result.includes(item.duplicatePattern)) {
        warnings.push(`${item.name}: duplicate detection text found`);
        skipped.push({ id: item.id, reason: 'duplicate-pattern' });
        continue;
      }
      const candidateHtml = snippets.length ? `${result}\n${snippets.join('\n')}` : result;
      if (automaticDuplicate(item, candidateHtml)) {
        warnings.push(`${item.name}: equivalent URL or content already exists`);
        skipped.push({ id: item.id, reason: 'automatic-duplicate' });
        continue;
      }
      const snippet = renderInjection(item, result);
      if (!snippet) {
        skipped.push({ id: item.id, reason: 'empty-render' });
        continue;
      }
      snippets.push(`<!-- ${marker}:start -->\n${snippet}\n<!-- ${marker}:end -->`);
      applied.push(item.id);
    }
    if (!snippets.length) continue;
    const insertion = findInsertion(result, location);
    if (insertion < 0) {
      for (const item of positioned.filter((entry) => applied.includes(entry.id))) {
        applied.splice(applied.indexOf(item.id), 1);
        skipped.push({ id: item.id, reason: 'missing-insertion-point' });
      }
      warnings.push(`${location}: insertion point is missing; content was not injected`);
      continue;
    }
    const block = `\n${snippets.join('\n')}\n`;
    result = `${result.slice(0, insertion)}${block}${result.slice(insertion)}`;
  }

  return { html: result, modified: applied.length > 0, applied, skipped, warnings };
}

export function assessEligibility({ method = 'GET', status = 200, headers = {}, requestHeaders = {}, route, path = '/' }) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const request = Object.fromEntries(Object.entries(requestHeaders).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const reasons = [];
  const warnings = [];
  if (route.mode !== 'inject') reasons.push('route is in passthrough mode');
  if (method !== 'GET') reasons.push('only GET responses are modified');
  if (status !== 200) reasons.push('only 200 responses are modified');
  if (!pathVariants(path)) reasons.push('request path encoding is malformed');
  else if (anyPathMatches(path, route.excludedPaths)) reasons.push('path is excluded by the route');
  const contentType = normalized['content-type'] ?? '';
  if (!/^text\/html(?:\s*;|$)/i.test(contentType)) reasons.push('Content-Type is not text/html');
  const charset = contentType.match(/;\s*charset\s*=\s*["']?([^\s;"']+)/i)?.[1]?.toLowerCase();
  if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) reasons.push(`unsupported character encoding: ${charset}`);
  if (/attachment|\bfilename\s*=/i.test(normalized['content-disposition'] ?? '')) reasons.push('response is a download attachment');
  if (/\bno-transform\b/i.test(normalized['cache-control'] ?? '')) reasons.push('Cache-Control forbids transformation');
  if (normalized['content-range']) reasons.push('response is partial content');
  if (request.range || request['if-range']) reasons.push('request asks for a byte range');
  if (normalized['content-security-policy']) {
    warnings.push('Enforcing Content-Security-Policy is present; injected content may be blocked');
    if (route.cspMode !== 'preserve') reasons.push('route is configured to skip responses with enforcing CSP');
  }
  if (normalized['content-security-policy-report-only']) {
    warnings.push('Content-Security-Policy-Report-Only is present; injection is not blocked by this header but may generate policy reports');
  }
  const encoding = (normalized['content-encoding'] ?? 'identity').toLowerCase();
  if (!['identity', 'gzip', 'deflate', 'br'].includes(encoding)) reasons.push(`unsupported content encoding: ${encoding}`);
  if (![...(route.resolvedProfileItems ?? []), ...(route.injections ?? [])].some((item) => item.enabled)) reasons.push('no enabled injection items');
  return { eligible: reasons.length === 0, reasons, warnings, encoding };
}

export function decodeBody(buffer, encoding, maxBytes) {
  if (buffer.length > maxBytes) throw new Error('compressed response exceeds the configured maximum');
  const options = { maxOutputLength: maxBytes };
  if (encoding === 'gzip') return gunzipSync(buffer, options);
  if (encoding === 'deflate') return inflateSync(buffer, options);
  if (encoding === 'br') return brotliDecompressSync(buffer, options);
  return buffer;
}

export function encodeBody(buffer, encoding) {
  if (encoding === 'gzip') return gzipSync(buffer);
  if (encoding === 'deflate') return deflateSync(buffer);
  if (encoding === 'br') return brotliCompressSync(buffer);
  return buffer;
}

export function previewInjection({ route, html, method = 'GET', status = 200, headers = { 'content-type': 'text/html' }, requestHeaders = {}, path = '/' }) {
  const eligibility = assessEligibility({ method, status, headers, requestHeaders, route, path });
  if (!eligibility.eligible) return { eligibility, original: html, proposed: '', result: html, modified: false, warnings: eligibility.warnings };
  const injection = injectHtml(html, route, { hostname: route.hostname, path });
  if (injection.modified && Buffer.byteLength(injection.html) > route.response.maxInjectBytes) {
    return {
      eligibility,
      original: html,
      proposed: '',
      result: html,
      modified: false,
      applied: [],
      skipped: [...injection.skipped, ...injection.applied.map((id) => ({ id, reason: 'transformed-size-limit' }))],
      warnings: [...eligibility.warnings, ...injection.warnings, 'Resulting HTML exceeds the route response limit; proxy traffic would be preserved without injection'],
    };
  }
  const proposed = injection.applied.map((itemId) => {
    const item = [...(route.resolvedProfileItems ?? []), ...(route.injections ?? [])].find((entry) => entry.id === itemId);
    return item ? renderInjection(item, html) : '';
  }).filter(Boolean).join('\n');
  return {
    eligibility,
    original: html,
    proposed,
    result: injection.html,
    modified: injection.modified,
    applied: injection.applied,
    skipped: injection.skipped,
    warnings: [...eligibility.warnings, ...injection.warnings],
  };
}
