import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { defaultRoute, validateProfile, validateRoute } from '../src/lib/model.mjs';
import { NetworkPolicy } from '../src/lib/network.mjs';
import { Store } from '../src/lib/store.mjs';

const policy = new NetworkPolicy({ allowedTargetCidrs: ['100.64.0.0/10'], trustedIngressCidrs: [], allowedPorts: [8080] });

function validRoute(hostname = 'app.example.com') {
  const route = defaultRoute();
  route.hostname = hostname;
  route.upstream.host = '100.64.0.5';
  route.enabled = true;
  return validateRoute(route, policy);
}

test('draft activation is atomic and history supports exact rollback snapshots', () => {
  const store = new Store(':memory:');
  const route = validRoute();
  const first = store.saveDraft(route);
  store.recordValidation(first.versionId, { ok: true });
  store.activate(route.id, first.versionId, route);
  route.upstream.port = 8080;
  route.notes = 'second';
  const second = store.saveDraft(route);
  assert.equal(store.listActiveConfigs()[0].notes, '');
  store.activate(route.id, second.versionId, route);
  assert.equal(store.listActiveConfigs()[0].notes, 'second');
  const rollback = store.rollbackDraft(route.id, first.versionId);
  const rollbackVersion = store.getVersion(rollback.versionId);
  store.activate(route.id, rollback.versionId, rollbackVersion.config);
  assert.equal(store.listActiveConfigs()[0].notes, '');
  assert.equal(store.listHistory(route.id).length, 3);
  store.close();
});

test('only the newest draft is activatable and deletion supersedes pending drafts', () => {
  const store = new Store(':memory:');
  const route = validRoute('drafts.example.com');
  const oldDraft = store.saveDraft(route);
  route.notes = 'newest';
  const currentDraft = store.saveDraft(route);
  assert.equal(store.getVersion(oldDraft.versionId).status, 'superseded');
  assert.throws(() => store.activate(route.id, oldDraft.versionId, route), /only a draft/);
  store.activate(route.id, currentDraft.versionId, route);
  route.notes = 'pending deletion';
  const pending = store.saveDraft(route);
  store.deleteRoute(route.id);
  assert.equal(store.getVersion(pending.versionId).status, 'superseded');
  assert.throws(() => store.activate(route.id, pending.versionId, route), /only a draft/);
  store.close();
});

test('profile content is snapshotted into an activated route version', () => {
  const store = new Store(':memory:');
  const profile = validateProfile({ name: 'Analytics', kind: 'custom', enabled: true, items: [{ name: 'A', type: 'inline-script', enabled: true, content: 'v1()', location: 'body-end', priority: 0 }] });
  store.saveProfile(profile);
  const route = validRoute();
  route.profileIds = [profile.id];
  const materialized = store.materializeProfiles(route);
  const draft = store.saveDraft(materialized);
  store.activate(route.id, draft.versionId, materialized);
  profile.items[0].content = 'v2()';
  store.saveProfile(validateProfile(profile));
  assert.equal(store.listActiveConfigs()[0].resolvedProfileItems[0].content, 'v1()');
  store.close();
});

test('hostname conflict is rejected only at activation and deleted routes fail closed', () => {
  const store = new Store(':memory:');
  const one = validRoute();
  const oneDraft = store.saveDraft(one);
  store.activate(one.id, oneDraft.versionId, one);
  const two = validRoute();
  const twoDraft = store.saveDraft(two);
  assert.throws(() => store.activate(two.id, twoDraft.versionId, two), /already active/);
  store.deleteRoute(one.id);
  assert.equal(store.listActiveConfigs().length, 0);
  store.close();
});

test('literal IP upstreams are rejected before any dial when outside CIDR policy', () => {
  const route = defaultRoute();
  route.hostname = 'ssrf.example.com';
  route.upstream.host = '127.0.0.1';
  assert.throws(() => validateRoute(route, policy), /outside the global target CIDR allowlist/);
});

test('custom CA fields reject private key material', () => {
  const route = validRoute();
  route.upstream.protocol = 'https';
  route.upstream.caPem = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----';
  assert.throws(() => validateRoute(route, policy), /never a private key/);
  route.upstream.caPem = '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n-----BEGIN ENCRYPTED PRIVATE KEY-----\nfake\n-----END ENCRYPTED PRIVATE KEY-----';
  assert.throws(() => validateRoute(route, policy), /never a private key/);
});

test('materialized routes reject duplicate IDs and unbounded profile expansion', () => {
  const route = validRoute('bounded.example.com');
  const duplicateId = `item_${randomUUID()}`;
  route.injections = [
    { id: duplicateId, name: 'One', type: 'inline-style', enabled: true, content: 'a{}', location: 'head-end', priority: 0 },
    { id: duplicateId, name: 'Two', type: 'inline-style', enabled: true, content: 'b{}', location: 'head-end', priority: 1 },
  ];
  assert.throws(() => validateRoute(route, policy), /duplicate injection item IDs/);
  route.injections = [];
  route.resolvedProfileItems = Array.from({ length: 201 }, (_, index) => ({
    id: `item_${randomUUID()}`, name: `Item ${index}`, type: 'inline-style', enabled: true, content: 'x{}', location: 'head-end', priority: index,
  }));
  assert.throws(() => validateRoute(route, policy), /at most 200/);
  const unknown = validRoute('unknown-field.example.com');
  unknown.upstream.password = 'must never be stored';
  assert.throws(() => validateRoute(unknown, policy), /unknown field: password/);
});
