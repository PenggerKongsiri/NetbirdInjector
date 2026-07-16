let csrf = '';
let routes = [];
let profiles = [];
let currentRoute = null;
let currentDraft = null;
let currentProfile = null;

const $ = (selector) => document.querySelector(selector);
const toast = (message) => {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 3200);
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(options.method || 'GET') && csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(label, action, className = 'ghost') {
  const element = node('button', label, className);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== `view-${name}`; });
  document.querySelectorAll('.tabs button').forEach((entry) => entry.classList.toggle('active', entry.dataset.view === name));
  if (name === 'profiles') loadProfiles();
  if (name === 'audit') loadAudit();
  if (name === 'settings') loadAccount();
}

function routeConfig(route) {
  const config = structuredClone(route.draft?.config || route.active?.config);
  delete config.resolvedProfileItems;
  delete config.resolvedProfiles;
  return config;
}

function renderRoutes() {
  const list = $('#route-list');
  list.replaceChildren();
  if (!routes.length) list.append(node('p', 'No routes yet. Create a disabled draft, test it, and activate it when ready.', 'muted'));
  for (const route of routes) {
    const card = node('article', undefined, 'card');
    const detail = node('div');
    const title = node('h3');
    const state = node('span', route.active ? (route.enabled ? 'live' : 'disabled') : 'draft', `route-state ${route.enabled ? 'live' : 'draft'}`);
    title.append(state, document.createTextNode(route.hostname));
    const active = route.active?.config;
    const draft = route.draft?.config;
    detail.append(title, node('p', active ? `${active.upstream.protocol}://${active.upstream.host}:${active.upstream.port} · ${active.mode}` : 'No active version'));
    if (draft) detail.append(node('p', `Draft v${route.draft.version_no} waiting for validation/activation`));
    const actions = node('div', undefined, 'card-actions');
    actions.append(
      button('Edit', () => openRoute(route)),
      button('Clone', () => cloneRoute(route)),
      button('History', () => showHistory(route)),
      button('Delete', () => deleteRoute(route), 'danger'),
    );
    if (route.active && !route.draft) actions.prepend(button(route.enabled ? 'Disable' : 'Enable', () => setRouteEnabled(route, !route.enabled), route.enabled ? 'secondary' : 'accent'));
    card.append(detail, actions);
    list.append(card);
  }
}

async function loadRoutes() {
  routes = await api('/api/routes');
  renderRoutes();
}

function readLines(selector) {
  return $(selector).value.split('\n').map((value) => value.trim()).filter(Boolean);
}

function editorRoute() {
  const base = currentRoute ? routeConfig(currentRoute) : currentRouteTemplate();
  return {
    ...base,
    id: $('#route-id').value,
    hostname: $('#route-hostname').value,
    environment: $('#route-environment').value,
    enabled: $('#route-enabled').checked,
    mode: $('#route-mode').value,
    upstream: {
      ...base.upstream,
      protocol: $('#upstream-protocol').value,
      host: $('#upstream-host').value,
      port: Number($('#upstream-port').value),
      hostHeader: $('#upstream-host-header').value,
      serverName: $('#upstream-sni').value,
      tlsVerify: $('#tls-verify').checked,
      caPem: $('#custom-ca').value,
    },
    timeouts: {
      connectMs: Number($('#connect-timeout').value), responseMs: Number($('#response-timeout').value), idleMs: Number($('#idle-timeout').value),
    },
    health: {
      ...base.health, enabled: $('#health-enabled').checked, path: $('#health-path').value, method: $('#health-method').value,
      expectedStatuses: $('#health-statuses').value.split(',').map((value) => Number(value.trim())).filter(Number.isFinite),
    },
    response: { ...base.response, maxInjectBytes: Number($('#max-inject-bytes').value) },
    excludedPaths: readLines('#excluded-paths'),
    profileIds: readLines('#profile-ids'),
    cspMode: $('#csp-mode').value,
    injections: JSON.parse($('#injections').value),
    notes: $('#route-notes').value,
  };
}

let templateCache = null;
function currentRouteTemplate() { return structuredClone(templateCache); }

function fillRoute(config, draft = null) {
  currentDraft = draft;
  $('#route-id').value = config.id;
  $('#route-hostname').value = config.hostname;
  $('#route-environment').value = config.environment || 'production';
  $('#route-enabled').checked = config.enabled;
  $('#route-mode').value = config.mode;
  $('#upstream-protocol').value = config.upstream.protocol;
  $('#upstream-host').value = config.upstream.host;
  $('#upstream-port').value = config.upstream.port;
  $('#upstream-host-header').value = config.upstream.hostHeader || '';
  $('#upstream-sni').value = config.upstream.serverName || '';
  $('#tls-verify').checked = config.upstream.tlsVerify !== false;
  $('#custom-ca').value = config.upstream.caPem || '';
  $('#connect-timeout').value = config.timeouts.connectMs;
  $('#response-timeout').value = config.timeouts.responseMs;
  $('#idle-timeout').value = config.timeouts.idleMs;
  $('#health-enabled').checked = config.health.enabled !== false;
  $('#health-path').value = config.health.path || '/';
  $('#health-method').value = config.health.method || 'GET';
  $('#health-statuses').value = (config.health.expectedStatuses || []).join(',');
  $('#max-inject-bytes').value = config.response.maxInjectBytes;
  $('#excluded-paths').value = (config.excludedPaths || []).join('\n');
  $('#profile-ids').value = (config.profileIds || []).join('\n');
  $('#csp-mode').value = config.cspMode || 'skip';
  $('#injections').value = JSON.stringify(config.injections || [], null, 2);
  $('#route-notes').value = config.notes || '';
  $('#test-route').disabled = !draft;
  $('#activate-route').disabled = !draft;
  $('#route-result').textContent = '';
  $('#route-form').hidden = false;
  $('#route-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openRoute(route) {
  currentRoute = route;
  $('#route-editor-title').textContent = route.draft ? `Edit draft · ${route.hostname}` : `Edit route · ${route.hostname}`;
  fillRoute(routeConfig(route), route.draft);
}

async function newRoute() {
  currentRoute = null;
  templateCache = await api('/api/routes/template');
  $('#route-editor-title').textContent = 'New route';
  fillRoute(templateCache);
}

async function saveDraft(event) {
  event.preventDefault();
  try {
    const result = await api('/api/routes/draft', { method: 'POST', body: JSON.stringify({ route: editorRoute() }) });
    currentDraft = { id: result.versionId, version_no: result.versionNo };
    $('#test-route').disabled = false;
    $('#activate-route').disabled = false;
    $('#route-result').textContent = JSON.stringify(result, null, 2);
    toast('Draft saved. Active traffic is unchanged.');
    await loadRoutes();
  } catch (error) { $('#route-result').textContent = error.message; }
}

async function testDraft() {
  try {
    const routeId = $('#route-id').value;
    const result = await api(`/api/routes/${encodeURIComponent(routeId)}/test`, { method: 'POST', body: JSON.stringify({ versionId: currentDraft.id }) });
    $('#route-result').textContent = JSON.stringify(result, null, 2);
    toast('Candidate route passed its health check.');
  } catch (error) { $('#route-result').textContent = error.message; }
}

async function activateDraft() {
  if (!confirm('Activate this tested draft? Existing traffic switches atomically; unrelated routes are unchanged.')) return;
  try {
    const routeId = $('#route-id').value;
    const result = await api(`/api/routes/${encodeURIComponent(routeId)}/activate`, { method: 'POST', body: JSON.stringify({ versionId: currentDraft.id }) });
    $('#route-result').textContent = JSON.stringify(result, null, 2);
    toast('Route activated atomically.');
    currentDraft = null;
    await loadRoutes();
  } catch (error) { $('#route-result').textContent = error.message; }
}

async function cloneRoute(route) {
  const hostname = prompt('Hostname for the disabled clone:');
  if (!hostname) return;
  try {
    await api(`/api/routes/${encodeURIComponent(route.id)}/clone`, { method: 'POST', body: JSON.stringify({ hostname }) });
    toast('Disabled clone draft created.');
    await loadRoutes();
  } catch (error) { toast(error.message); }
}

async function deleteRoute(route) {
  if (!confirm(`Soft-delete ${route.hostname}? Traffic stops immediately; history remains in the database.`)) return;
  try {
    await api(`/api/routes/${encodeURIComponent(route.id)}`, { method: 'DELETE' });
    toast('Route deleted; history retained.');
    await loadRoutes();
  } catch (error) { toast(error.message); }
}

async function setRouteEnabled(route, enabled) {
  if (!confirm(`${enabled ? 'Enable' : 'Disable'} ${route.hostname} using its exact active snapshot?${enabled ? ' The upstream health check must pass.' : ' Traffic will stop immediately after atomic activation.'}`)) return;
  try {
    await api(`/api/routes/${encodeURIComponent(route.id)}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) });
    toast(`Route ${enabled ? 'enabled' : 'disabled'} atomically.`);
    await loadRoutes();
  } catch (error) { toast(error.message); }
}

async function showHistory(route) {
  const history = await api(`/api/routes/${encodeURIComponent(route.id)}/history`);
  const list = $('#history-list');
  list.replaceChildren();
  for (const version of history) {
    const card = node('article', undefined, 'card');
    const detail = node('div');
    detail.append(node('h3', `Version ${version.version_no} · ${version.status}`), node('p', `${version.created_at} · ${version.validation?.ok ? 'health passed' : version.validation?.error || 'not tested'}`));
    const actions = node('div', undefined, 'card-actions');
    if (version.status === 'superseded') actions.append(button('Roll back', async () => {
      if (!confirm(`Health-check and atomically roll back to version ${version.version_no}?`)) return;
      try {
        await api(`/api/routes/${encodeURIComponent(route.id)}/rollback`, { method: 'POST', body: JSON.stringify({ versionId: version.id }) });
        toast(`Rolled back to version ${version.version_no}.`);
        $('#history-panel').hidden = true;
        await loadRoutes();
      } catch (error) { toast(error.message); }
    }, 'accent'));
    card.append(detail, actions);
    list.append(card);
  }
  $('#history-panel').hidden = false;
  $('#history-panel').scrollIntoView({ behavior: 'smooth' });
}

function renderProfiles() {
  const list = $('#profile-list');
  list.replaceChildren();
  if (!profiles.length) list.append(node('p', 'No reusable profiles yet.', 'muted'));
  for (const profile of profiles) {
    const card = node('article', undefined, 'card');
    const detail = node('div');
    detail.append(node('h3', profile.name), node('p', `${profile.kind} · revision ${profile.revision} · ${profile.items.length} item(s) · ID ${profile.id}`));
    const actions = node('div', undefined, 'card-actions');
    actions.append(button('Edit', () => editProfile(profile)), button('Delete', async () => {
      if (!confirm(`Delete profile ${profile.name}? Existing active route snapshots keep their current injected items.`)) return;
      try { await api(`/api/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' }); await loadProfiles(); } catch (error) { toast(error.message); }
    }, 'danger'));
    card.append(detail, actions);
    list.append(card);
  }
}

async function loadProfiles() { profiles = await api('/api/profiles'); renderProfiles(); }

function resetProfileEditor() {
  currentProfile = null;
  $('#profile-form').reset();
  $('#profile-id').value = '';
  $('#profile-items').value = '[]';
  $('#profile-enabled').checked = true;
  $('#profile-editor-title').textContent = 'Create a custom profile';
  $('#save-profile').textContent = 'Create profile';
  $('#cancel-profile-edit').hidden = true;
}

function editProfile(profile) {
  currentProfile = structuredClone(profile);
  $('#profile-id').value = profile.id;
  $('#profile-name').value = profile.name;
  $('#profile-enabled').checked = profile.enabled !== false;
  $('#profile-items').value = JSON.stringify(profile.items, null, 2);
  $('#profile-notes').value = profile.notes || '';
  $('#profile-editor-title').textContent = `Edit ${profile.name}`;
  $('#save-profile').textContent = 'Save new revision';
  $('#cancel-profile-edit').hidden = false;
  $('#profile-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function createUmami(event) {
  event.preventDefault();
  const item = {
    name: `${$('#umami-name').value} scripts`, enabled: true, type: 'umami', location: 'head-end', priority: 0,
    options: { analytics: $('#umami-analytics').checked, recorder: $('#umami-recorder').checked, websiteId: $('#umami-website-id').value, analyticsUrl: $('#umami-url').value, recorderUrl: $('#umami-recorder-url').value },
  };
  try {
    await api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: $('#umami-name').value, kind: 'umami', enabled: true, items: [item], notes: 'Structured Umami integration' }) });
    event.target.reset(); $('#umami-analytics').checked = true; await loadProfiles(); toast('Umami profile created.');
  } catch (error) { toast(error.message); }
}

async function createProfile(event) {
  event.preventDefault();
  try {
    const profile = {
      ...(currentProfile || {}), id: $('#profile-id').value || undefined, name: $('#profile-name').value,
      kind: currentProfile?.kind || 'custom', enabled: $('#profile-enabled').checked,
      items: JSON.parse($('#profile-items').value), notes: $('#profile-notes').value,
    };
    delete profile.revision;
    await api('/api/profiles', { method: 'POST', body: JSON.stringify(profile) });
    const edited = Boolean(currentProfile);
    resetProfileEditor(); await loadProfiles(); toast(edited ? 'Profile revision saved.' : 'Custom profile created.');
  } catch (error) { toast(error.message); }
}

async function loadPeers() {
  const list = $('#peer-list'); list.replaceChildren(node('p', 'Loading…', 'muted'));
  try {
    const { peers } = await api('/api/peers'); list.replaceChildren();
    for (const peer of peers) {
      const card = node('article', undefined, 'card');
      const detail = node('div');
      detail.append(node('h3', `${peer.connected ? '●' : '○'} ${peer.name}`), node('p', `${peer.ip || peer.ipv6} · ${peer.dnsName || 'no DNS label'} · ${peer.os} · last seen ${peer.lastSeen || 'unknown'}`));
      const actions = node('div', undefined, 'card-actions');
      actions.append(node('span', peer.connected ? 'online' : 'offline', `route-state ${peer.connected ? 'live' : ''}`));
      actions.append(button('Use in route', async () => {
        if (!currentRoute && $('#route-form').hidden) await newRoute();
        $('#upstream-host').value = peer.ip || peer.dnsName || peer.ipv6;
        showView('routes');
        $('#route-form').hidden = false;
        $('#route-form').scrollIntoView({ behavior: 'smooth' });
        toast('Peer destination selected. Set its port, save, and test reachability.');
      }, 'secondary'));
      card.append(detail, actions); list.append(card);
    }
  } catch (error) { list.replaceChildren(node('p', error.message, 'error')); }
}

async function preview(event) {
  event.preventDefault();
  try {
    const route = editorRoute();
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if ($('#preview-csp').value) headers['content-security-policy'] = $('#preview-csp').value;
    const result = await api('/api/preview', { method: 'POST', body: JSON.stringify({ route, html: $('#preview-html').value, method: 'GET', status: 200, headers, path: $('#preview-path').value }) });
    $('#preview-result').textContent = JSON.stringify(result, null, 2);
  } catch (error) { $('#preview-result').textContent = error.message; }
}

async function loadAudit() {
  const events = await api('/api/audit'); const list = $('#audit-list'); list.replaceChildren();
  for (const event of events) {
    const card = node('article', undefined, 'card'); const detail = node('div');
    detail.append(node('h3', event.action), node('p', `${event.occurred_at} · ${event.object_type} ${event.object_id} · ${event.summary}`)); card.append(detail); list.append(card);
  }
}

async function loadAccount() {
  try {
    const account = await api('/api/account');
    $('#settings-username').value = account.username;
    $('#account-summary').textContent = `${account.username} · two-factor authentication ${account.twoFactorEnabled ? 'enabled' : 'disabled'}`;
    const access = account.adminAccess;
    const host = access.listen.includes(':') ? `[${access.listen}]` : access.listen;
    $('#admin-access-summary').textContent = `Admin URL: ${access.protocol}://${host}:${access.port} · allowed clients: ${access.allowedCidrs.join(', ')}`;
    $('#two-factor-disabled').hidden = account.twoFactorEnabled;
    $('#two-factor-enabled').hidden = !account.twoFactorEnabled;
    $('#recovery-count').textContent = `${account.recoveryCodesRemaining} unused recovery code(s) remain.`;
  } catch (error) { $('#account-result').textContent = error.message; }
}

function showRecoveryCodes(codes) {
  $('#recovery-codes').textContent = codes.join('\n');
  $('#recovery-output').hidden = false;
  $('#recovery-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function changeCredentials(event) {
  event.preventDefault();
  $('#account-result').textContent = '';
  const newPassword = $('#credentials-new-password').value;
  if (newPassword !== $('#credentials-confirm-password').value) {
    $('#account-result').textContent = 'New passwords do not match.';
    return;
  }
  try {
    await api('/api/account/credentials', { method: 'POST', body: JSON.stringify({
      username: $('#settings-username').value, currentPassword: $('#credentials-current-password').value, newPassword,
    }) });
    location.reload();
  } catch (error) { $('#account-result').textContent = error.message; }
}

async function startTwoFactor(event) {
  event.preventDefault();
  try {
    const setup = await api('/api/account/2fa/setup', { method: 'POST', body: JSON.stringify({ currentPassword: $('#two-factor-start-password').value }) });
    $('#two-factor-start-password').value = '';
    $('#two-factor-secret').textContent = setup.secret;
    $('#two-factor-uri').value = setup.provisioningUri;
    $('#two-factor-enrollment').hidden = false;
    $('#two-factor-confirm-code').focus();
  } catch (error) { $('#account-result').textContent = error.message; }
}

async function enableTwoFactor(event) {
  event.preventDefault();
  try {
    const result = await api('/api/account/2fa/enable', { method: 'POST', body: JSON.stringify({ code: $('#two-factor-confirm-code').value }) });
    $('#two-factor-confirm-code').value = '';
    $('#two-factor-enrollment').hidden = true;
    showRecoveryCodes(result.recoveryCodes);
    await loadAccount();
    toast('Two-factor authentication enabled.');
  } catch (error) { $('#account-result').textContent = error.message; }
}

async function replaceRecoveryCodes(event) {
  event.preventDefault();
  try {
    const result = await api('/api/account/2fa/recovery-codes', { method: 'POST', body: JSON.stringify({ currentPassword: $('#recovery-password').value, code: $('#recovery-code').value }) });
    event.target.reset(); showRecoveryCodes(result.recoveryCodes); await loadAccount(); toast('Previous recovery codes were invalidated.');
  } catch (error) { $('#account-result').textContent = error.message; }
}

async function disableTwoFactor(event) {
  event.preventDefault();
  if (!confirm('Disable two-factor authentication and sign out every administrator session?')) return;
  try {
    await api('/api/account/2fa/disable', { method: 'POST', body: JSON.stringify({ currentPassword: $('#two-factor-disable-password').value, code: $('#two-factor-disable-code').value }) });
    location.reload();
  } catch (error) { $('#account-result').textContent = error.message; }
}

async function bootstrap() {
  try {
    const session = await api('/api/session'); csrf = session.csrf; $('#login').hidden = true; $('#app').hidden = false;
    templateCache = await api('/api/routes/template');
    const status = await api('/api/status'); $('#system-state').textContent = `${status.activeRoutes} active · ${status.netbirdMode} mode`;
    await Promise.all([loadRoutes(), loadProfiles()]);
  } catch { $('#login').hidden = false; $('#app').hidden = true; }
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  try { const result = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value, secondFactor: $('#second-factor').value }) }); csrf = result.csrf; $('#password').value = ''; $('#second-factor').value = ''; await bootstrap(); }
  catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });
document.querySelectorAll('.tabs button').forEach((entry) => entry.addEventListener('click', () => showView(entry.dataset.view)));
$('#new-route').addEventListener('click', newRoute);
$('#close-route').addEventListener('click', () => { $('#route-form').hidden = true; });
$('#route-form').addEventListener('submit', saveDraft);
$('#test-route').addEventListener('click', testDraft);
$('#activate-route').addEventListener('click', activateDraft);
$('#close-history').addEventListener('click', () => { $('#history-panel').hidden = true; });
$('#umami-form').addEventListener('submit', createUmami);
$('#profile-form').addEventListener('submit', createProfile);
$('#cancel-profile-edit').addEventListener('click', resetProfileEditor);
$('#load-peers').addEventListener('click', loadPeers);
$('#preview-form').addEventListener('submit', preview);
$('#load-audit').addEventListener('click', loadAudit);
$('#load-account').addEventListener('click', loadAccount);
$('#credentials-form').addEventListener('submit', changeCredentials);
$('#two-factor-start-form').addEventListener('submit', startTwoFactor);
$('#two-factor-confirm-form').addEventListener('submit', enableTwoFactor);
$('#recovery-form').addEventListener('submit', replaceRecoveryCodes);
$('#two-factor-disable-form').addEventListener('submit', disableTwoFactor);
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 5_242_880) throw new Error('Import file exceeds the 5 MiB limit'); const data = JSON.parse(await file.text()); const result = await api('/api/import', { method: 'POST', body: JSON.stringify(data) }); toast(`Imported ${result.routeDrafts} disabled route draft(s).`); await loadRoutes(); }
  catch (error) { toast(error.message); } finally { event.target.value = ''; }
});
bootstrap();
