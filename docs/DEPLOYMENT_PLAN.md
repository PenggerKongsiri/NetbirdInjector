# Proposed production deployment plan

This is a confirmation boundary, not an instruction already executed. Do not run it until every remaining gate in `PRODUCTION_CHECKLIST.md` is complete and the operator supplies the placeholders below. No SSH, DNS, NetBird, Coolify, Traefik, or production changes have been made by this project work.

## Required decisions and credentials

- `<INJECTOR_HOST>` and its supported Linux architecture/OS.
- `<RELEASE_VERSION>`, artifact URL/source, and independently verified `<SHA256>`.
- Injector NetBird peer/group and the NetBird Reverse Proxy source group.
- Test domain `<TEST_DOMAIN>` and later first production domain `<DOMAIN>`.
- Each destination `<DESTINATION_IP_OR_DNS>`, `<PORT>`, `http|https`, upstream Host, TLS SNI, CA, expected health path/statuses, exclusions, size limit, and timeout values.
- Exact injection/profile items, owners, public URLs/content, website IDs, scopes, priorities, CSP decision, duplicate text, and rollback version.
- Optional NetBird `<API_BASE_URL>` and read-only-intent service-user PAT stored in the organization's secret vault. Write access is not used.
- Monitoring window, owner, abort thresholds, old NetBird target peer/port, and rollback approver.

## Ports and policies

- TCP 8080: NetBird Reverse Proxy peers -> injector only. Never public internet.
- TCP 9090: host loopback only; no firewall/NetBird exposure.
- TCP 22: administrators according to existing SSH policy, for the loopback tunnel.
- Destination TCP ports: injector -> exact application peer/resource only.
- Outbound TCP 443: optional NetBird API and public script validation/operations as organizational policy requires. Browser script fetching does not originate from this service.

## Files changed on the injector host

Native install creates/changes only:

- `/opt/netbird-injector-manager/releases/<timestamp>/...`
- `/opt/netbird-injector-manager/current`
- `/etc/netbird-injector-manager/config.json`
- optional `/etc/netbird-injector-manager/netbird.token`
- `/var/lib/netbird-injector-manager/state.db` plus SQLite WAL/SHM while running
- `/var/backups/netbird-injector-manager/...`
- `/etc/systemd/system/netbird-injector-manager.service`
- system account/group `netbird-injector`
- systemd enablement state for `netbird-injector-manager.service`

It does not edit NetBird files, Docker, Coolify, Traefik, DNS, application files, or the old injection middleware/plugin.

## Exact host commands after approval

On a trusted workstation, verify and copy the already reviewed artifact:

```bash
printf '%s  %s\n' '<SHA256>' 'netbird-injector-manager-<RELEASE_VERSION>.tar.gz' | sha256sum -c -
scp netbird-injector-manager-<RELEASE_VERSION>.tar.gz <ADMIN>@<INJECTOR_HOST>:/tmp/
```

On `<INJECTOR_HOST>`:

```bash
ssh <ADMIN>@<INJECTOR_HOST>
mkdir -p "$HOME/netbird-injector-manager-<RELEASE_VERSION>"
tar -C "$HOME/netbird-injector-manager-<RELEASE_VERSION>" --strip-components=1 -xzf /tmp/netbird-injector-manager-<RELEASE_VERSION>.tar.gz
cd "$HOME/netbird-injector-manager-<RELEASE_VERSION>"
node scripts/release.mjs verify .
npm run check:runtime
sudo ./setup detect
sudo ./setup install
sudo ./setup doctor
sudo ./packaging/post-install-verify.sh
sudo ./setup backup
```

If API mode is approved, create the token file without placing the token in shell history:

```bash
sudo install -o root -g netbird-injector -m 0640 /dev/null /etc/netbird-injector-manager/netbird.token
sudoedit /etc/netbird-injector-manager/netbird.token
sudo ./setup reconfigure
sudo ./setup doctor
```

Open the private UI:

```bash
ssh -L 9090:127.0.0.1:9090 <ADMIN>@<INJECTOR_HOST>
```

In the UI, create `<TEST_DOMAIN>` as a disabled route, attach profiles, preview representative HTML, save, test, and activate.

## NetBird dashboard changes after approval

The application intentionally has no NetBird write automation. An authorized operator will:

1. Create/narrow policies for proxy-source -> injector:8080 and injector -> destination:`<PORT>`.
2. Create a new Reverse Proxy HTTP service for `<TEST_DOMAIN>` targeting the injector peer port 8080 with public Host preserved.
3. Leave all existing domain services and the old middleware/plugin unchanged.
4. Execute every test-domain check in `MIGRATION_FROM_TRAEFIK_PLUGIN.md`.
5. After approval, change one `<DOMAIN>` service target from `<OLD_PEER>:<OLD_PORT>` to injector:8080 and monitor.

DNS is changed only if the chosen NetBird test-domain workflow requires it and only by a separately authorized operator. No DNS action is assumed here.

## Traffic rollback

At any abort threshold, an authorized NetBird operator changes only the affected service target back to `<OLD_PEER>:<OLD_PORT>`. The old middleware/plugin was never removed. Then preserve evidence and optionally activate the route's prior tested passthrough version in the UI.

No database deletion or uninstall is part of incident rollback.

## Code update rollback

```bash
cd "$HOME/netbird-injector-manager-<NEW_VERSION>"
sudo ./setup update
sudo ./setup status
```

`setup update` creates a backup and automatically restores the old release symlink if health fails. Manual code rollback is also health-gated:

```bash
sudo /opt/netbird-injector-manager/current/setup rollback
```

For state rollback after a separately diagnosed data problem:

```bash
sudo ./setup restore /var/backups/netbird-injector-manager/<VERIFIED_BACKUP_DIRECTORY>
sudo ./setup doctor
```

## Backup confirmation

```bash
sudo ./setup backup
sudo node /opt/netbird-injector-manager/current/scripts/backup.mjs verify \
  /var/backups/netbird-injector-manager/<BACKUP>/config.json \
  /var/backups/netbird-injector-manager/<BACKUP>
```

Copy the backup with approved encryption to off-host storage and separately verify PAT recovery from the vault.
