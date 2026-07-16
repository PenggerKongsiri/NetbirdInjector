# Backup and restore

## Contents and security

```bash
sudo ./setup backup
```

This creates a new mode-0700 directory under `/var/backups/netbird-injector-manager` containing:

- `state.db`: SQLite online backup, including routes, versions, profiles, audit history, the local administrator account, the TOTP seed when enabled, hashed recovery codes, and custom CA material;
- `config.json`: listener/network settings and the administrator password hash;
- `manifest.json`: format metadata and SHA-256 for both files.

It intentionally excludes the NetBird PAT and native admin TLS private key. Keep both in a separate secret vault. A backup is still highly sensitive because it reveals internal topology, injected scripts, password hashes, TOTP seed, hashed recovery codes, and history. Encrypt off-host copies and restrict restore access.

Ordinary backup never creates a missing application database. The narrowly scoped interrupted-first-install recovery in `setup update` requires explicit approval, initializes only the absent standard managed database, and then invokes this same backup format. If an earlier backup manifest exists, empty-state recovery is refused so the operator can verify and restore prior data.

## Verification

```bash
sudo node /opt/netbird-injector-manager/current/scripts/backup.mjs verify \
  /var/backups/netbird-injector-manager/backup-TIMESTAMP/config.json \
  /var/backups/netbird-injector-manager/backup-TIMESTAMP
```

Verification checks the manifest, SHA-256, JSON, and SQLite `quick_check` without activating anything.

## Restore

Restore accepts only a verified directory under the managed backup root:

```bash
sudo ./setup restore /var/backups/netbird-injector-manager/backup-TIMESTAMP
```

The lifecycle program creates a separate pre-restore backup, stops the service, installs the database/configuration, clears obsolete WAL sidecars, starts, and checks health. If health fails it reinstates the pre-restore files. The NetBird token must already exist at the configured path or API mode will report unavailable; proxy routes remain independent.

## Off-host copy example

After creation, archive and encrypt with an organization-approved tool. Do not put an unencrypted backup in source control, ordinary cloud storage, email, or logs. Test restoration quarterly on an isolated host with fake upstreams.
