import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { clone, id, now } from './util.mjs';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
    this.db = new DatabaseSync(path, { timeout: 5000, allowExtension: false, defensive: true });
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS routes(
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        active_version_id TEXT,
        draft_version_id TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS routes_active_hostname ON routes(hostname) WHERE deleted_at IS NULL AND active_version_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS route_versions(
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
        version_no INTEGER NOT NULL,
        config_json TEXT NOT NULL CHECK(json_valid(config_json)),
        status TEXT NOT NULL CHECK(status IN ('draft','active','superseded')),
        validation_json TEXT CHECK(validation_json IS NULL OR json_valid(validation_json)),
        created_at TEXT NOT NULL,
        activated_at TEXT,
        created_by TEXT NOT NULL,
        UNIQUE(route_id, version_no)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS route_versions_route ON route_versions(route_id, version_no DESC);
      CREATE TABLE IF NOT EXISTS profiles(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        config_json TEXT NOT NULL CHECK(json_valid(config_json)),
        enabled INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS audit_events(
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        summary TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS audit_time ON audit_events(occurred_at DESC);
      CREATE TABLE IF NOT EXISTS admin_account(
        id INTEGER PRIMARY KEY CHECK(id=1),
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK(totp_enabled IN (0,1)),
        recovery_codes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(recovery_codes_json)),
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, datetime('now'));
    `);
  }

  transaction(fn) {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  audit(actor, action, objectType, objectId, summary) {
    this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)').run(id('audit_'), now(), actor, action, objectType, objectId, String(summary).slice(0, 1000));
  }

  ensureAdminAccount(username, passwordHash) {
    const existing = this.db.prepare('SELECT id FROM admin_account WHERE id=1').get();
    if (!existing) this.db.prepare('INSERT INTO admin_account(id,username,password_hash,updated_at) VALUES(1,?,?,?)').run(username, passwordHash, now());
    return this.getAdminAccount();
  }

  getAdminAccount() {
    const row = this.db.prepare('SELECT * FROM admin_account WHERE id=1').get();
    if (!row) return null;
    return {
      username: row.username,
      passwordHash: row.password_hash,
      totpSecret: row.totp_secret,
      totpEnabled: Boolean(row.totp_enabled),
      recoveryCodeHashes: JSON.parse(row.recovery_codes_json),
      updatedAt: row.updated_at,
    };
  }

  updateAdminCredentials(username, passwordHash, actor = 'admin') {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE admin_account SET username=?,password_hash=?,updated_at=? WHERE id=1').run(username, passwordHash, now());
      if (!result.changes) throw new Error('administrator account is not initialized');
      this.audit(actor, 'account.credentials_changed', 'admin_account', 'admin', 'Administrator username or password changed; all sessions invalidated');
      return this.getAdminAccount();
    });
  }

  enableAdminTotp(secret, recoveryCodeHashes, actor = 'admin') {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE admin_account SET totp_secret=?,totp_enabled=1,recovery_codes_json=?,updated_at=? WHERE id=1')
        .run(secret, JSON.stringify(recoveryCodeHashes), now());
      if (!result.changes) throw new Error('administrator account is not initialized');
      this.audit(actor, 'account.2fa_enabled', 'admin_account', 'admin', 'TOTP two-factor authentication enabled');
    });
  }

  disableAdminTotp(actor = 'admin') {
    return this.transaction(() => {
      const result = this.db.prepare("UPDATE admin_account SET totp_secret=NULL,totp_enabled=0,recovery_codes_json='[]',updated_at=? WHERE id=1").run(now());
      if (!result.changes) throw new Error('administrator account is not initialized');
      this.audit(actor, 'account.2fa_disabled', 'admin_account', 'admin', 'TOTP two-factor authentication disabled; all sessions invalidated');
    });
  }

  replaceAdminRecoveryCodes(recoveryCodeHashes, actor = 'admin') {
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE admin_account SET recovery_codes_json=?,updated_at=? WHERE id=1 AND totp_enabled=1')
        .run(JSON.stringify(recoveryCodeHashes), now());
      if (!result.changes) throw new Error('two-factor authentication is not enabled');
      this.audit(actor, 'account.recovery_codes_replaced', 'admin_account', 'admin', 'Two-factor recovery codes replaced');
    });
  }

  consumeAdminRecoveryCode(hash) {
    return this.transaction(() => {
      const account = this.getAdminAccount();
      if (!hash || !account?.totpEnabled) return false;
      const index = account.recoveryCodeHashes.indexOf(hash);
      if (index < 0) return false;
      account.recoveryCodeHashes.splice(index, 1);
      this.db.prepare('UPDATE admin_account SET recovery_codes_json=?,updated_at=? WHERE id=1').run(JSON.stringify(account.recoveryCodeHashes), now());
      this.audit(account.username, 'account.recovery_code_used', 'admin_account', 'admin', 'A one-time recovery code was consumed');
      return true;
    });
  }

  saveDraft(config, actor = 'admin') {
    return this.transaction(() => {
      const timestamp = now();
      const existing = this.db.prepare('SELECT * FROM routes WHERE id=?').get(config.id);
      if (existing?.deleted_at) throw new Error('cannot edit a deleted route');
      if (!existing) {
        this.db.prepare('INSERT INTO routes(id,hostname,enabled,created_at,updated_at) VALUES(?,?,?,?,?)').run(config.id, config.hostname, 0, timestamp, timestamp);
      } else if (existing.draft_version_id) {
        this.db.prepare("UPDATE route_versions SET status='superseded' WHERE id=? AND status='draft'").run(existing.draft_version_id);
      }
      const row = this.db.prepare('SELECT COALESCE(MAX(version_no),0)+1 AS next FROM route_versions WHERE route_id=?').get(config.id);
      const versionId = id('version_');
      this.db.prepare('INSERT INTO route_versions(id,route_id,version_no,config_json,status,created_at,created_by) VALUES(?,?,?,?,?,?,?)')
        .run(versionId, config.id, Number(row.next), JSON.stringify(config), 'draft', timestamp, actor);
      this.db.prepare('UPDATE routes SET hostname=CASE WHEN active_version_id IS NULL THEN ? ELSE hostname END,draft_version_id=?,updated_at=? WHERE id=?')
        .run(config.hostname, versionId, timestamp, config.id);
      this.audit(actor, 'draft.saved', 'route', config.id, `Saved route version ${row.next}`);
      return { routeId: config.id, versionId, versionNo: Number(row.next) };
    });
  }

  recordValidation(versionId, result) {
    this.db.prepare('UPDATE route_versions SET validation_json=? WHERE id=? AND status=\'draft\'').run(JSON.stringify(result), versionId);
  }

  activate(routeId, versionId, config, actor = 'admin') {
    return this.transaction(() => {
      const version = this.db.prepare('SELECT * FROM route_versions WHERE id=? AND route_id=?').get(versionId, routeId);
      if (!version) throw new Error('route version was not found');
      if (version.status !== 'draft') throw new Error('only a draft version can be activated');
      const routeRecord = this.db.prepare('SELECT draft_version_id,deleted_at FROM routes WHERE id=?').get(routeId);
      if (!routeRecord || routeRecord.deleted_at) throw new Error('route was not found');
      if (routeRecord.draft_version_id !== versionId) throw new Error('only the current route draft can be activated');
      if (config.id !== routeId) throw new Error('route configuration ID does not match its record');
      const conflict = this.db.prepare('SELECT id FROM routes WHERE hostname=? AND id<>? AND deleted_at IS NULL AND active_version_id IS NOT NULL').get(config.hostname, routeId);
      if (conflict) throw new Error(`hostname is already active on route ${conflict.id}`);
      const timestamp = now();
      this.db.prepare("UPDATE route_versions SET status='superseded' WHERE route_id=? AND status='active'").run(routeId);
      this.db.prepare("UPDATE route_versions SET status='active', config_json=?, activated_at=? WHERE id=?").run(JSON.stringify(config), timestamp, versionId);
      this.db.prepare('UPDATE routes SET hostname=?,enabled=?,active_version_id=?,draft_version_id=NULL,updated_at=? WHERE id=?')
        .run(config.hostname, config.enabled ? 1 : 0, versionId, timestamp, routeId);
      this.audit(actor, 'version.activated', 'route', routeId, `Activated version ${version.version_no}`);
      return { routeId, versionId, versionNo: Number(version.version_no) };
    });
  }

  rollbackDraft(routeId, sourceVersionId, actor = 'admin') {
    const source = this.db.prepare('SELECT config_json,status FROM route_versions WHERE id=? AND route_id=?').get(sourceVersionId, routeId);
    if (!source) throw new Error('rollback source version was not found');
    if (source.status !== 'superseded') throw new Error('only a superseded route version can be rolled back');
    const config = JSON.parse(source.config_json);
    return this.saveDraft(config, actor);
  }

  deleteRoute(routeId, actor = 'admin') {
    return this.transaction(() => {
      const route = this.db.prepare('SELECT * FROM routes WHERE id=? AND deleted_at IS NULL').get(routeId);
      if (!route) throw new Error('route was not found');
      const timestamp = now();
      this.db.prepare("UPDATE route_versions SET status='superseded' WHERE route_id=? AND status IN ('active','draft')").run(routeId);
      this.db.prepare('UPDATE routes SET enabled=0,active_version_id=NULL,draft_version_id=NULL,deleted_at=?,updated_at=? WHERE id=?').run(timestamp, timestamp, routeId);
      this.audit(actor, 'route.deleted', 'route', routeId, 'Soft-deleted route; history retained');
    });
  }

  getVersion(versionId) {
    const row = this.db.prepare('SELECT * FROM route_versions WHERE id=?').get(versionId);
    return row ? { ...row, config: JSON.parse(row.config_json), validation: row.validation_json ? JSON.parse(row.validation_json) : null } : null;
  }

  getRoute(routeId) {
    const route = this.db.prepare('SELECT * FROM routes WHERE id=? AND deleted_at IS NULL').get(routeId);
    if (!route) return null;
    return this.hydrateRoute(route);
  }

  hydrateRoute(route) {
    const active = route.active_version_id ? this.getVersion(route.active_version_id) : null;
    const draft = route.draft_version_id ? this.getVersion(route.draft_version_id) : null;
    return { ...route, enabled: Boolean(route.enabled), active, draft };
  }

  listRoutes() {
    return this.db.prepare('SELECT * FROM routes WHERE deleted_at IS NULL ORDER BY hostname').all().map((row) => this.hydrateRoute(row));
  }

  listActiveConfigs() {
    return this.db.prepare(`SELECT v.config_json FROM routes r JOIN route_versions v ON v.id=r.active_version_id WHERE r.deleted_at IS NULL AND r.enabled=1 AND v.status='active'`).all().map((row) => JSON.parse(row.config_json));
  }

  listHistory(routeId) {
    return this.db.prepare('SELECT id,route_id,version_no,status,validation_json,created_at,activated_at,created_by FROM route_versions WHERE route_id=? ORDER BY version_no DESC').all(routeId)
      .map((row) => ({ ...row, validation: row.validation_json ? JSON.parse(row.validation_json) : null, validation_json: undefined }));
  }

  saveProfile(profile, actor = 'admin') {
    return this.transaction(() => {
      const timestamp = now();
      const existing = this.db.prepare('SELECT revision FROM profiles WHERE id=?').get(profile.id);
      const revision = existing ? Number(existing.revision) + 1 : 1;
      this.db.prepare(`INSERT INTO profiles(id,name,kind,config_json,enabled,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,config_json=excluded.config_json,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(profile.id, profile.name, profile.kind, JSON.stringify(profile), profile.enabled ? 1 : 0, revision, timestamp, timestamp);
      this.audit(actor, existing ? 'profile.updated' : 'profile.created', 'profile', profile.id, `${profile.name} revision ${revision}`);
      return { ...profile, revision };
    });
  }

  getProfile(profileId) {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id=?').get(profileId);
    return row ? { ...JSON.parse(row.config_json), revision: Number(row.revision) } : null;
  }

  listProfiles() {
    return this.db.prepare('SELECT config_json,revision FROM profiles ORDER BY name').all().map((row) => ({ ...JSON.parse(row.config_json), revision: Number(row.revision) }));
  }

  deleteProfile(profileId, actor = 'admin') {
    return this.transaction(() => {
      const result = this.db.prepare('DELETE FROM profiles WHERE id=?').run(profileId);
      if (!result.changes) throw new Error('profile was not found');
      this.audit(actor, 'profile.deleted', 'profile', profileId, 'Deleted reusable profile');
    });
  }

  materializeProfiles(route) {
    const result = clone(route);
    result.resolvedProfileItems = [];
    result.resolvedProfiles = [];
    for (const profileId of result.profileIds) {
      const profile = this.getProfile(profileId);
      if (!profile) throw new Error(`attached profile was not found: ${profileId}`);
      if (!profile.enabled) continue;
      result.resolvedProfiles.push({ id: profile.id, name: profile.name, revision: profile.revision });
      result.resolvedProfileItems.push(...profile.items);
    }
    return result;
  }

  exportData() {
    return {
      format: 'netbird-injector-manager-export',
      version: 1,
      exportedAt: now(),
      profiles: this.listProfiles().map(({ revision: _revision, ...profile }) => profile),
      routes: this.listRoutes().map((route) => route.active?.config ?? route.draft?.config).filter(Boolean).map((config) => {
        const copy = clone(config);
        delete copy.resolvedProfileItems;
        delete copy.resolvedProfiles;
        if (copy.upstream) copy.upstream.caPem = copy.upstream.caPem || '';
        return copy;
      }),
    };
  }

  listAudit(limit = 100) {
    return this.db.prepare('SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT ?').all(limit);
  }

  close() {
    this.db.close();
  }
}
