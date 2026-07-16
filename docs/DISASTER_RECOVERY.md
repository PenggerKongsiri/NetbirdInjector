# Disaster recovery

## Recovery objectives

Set RPO/RTO explicitly for the deployment. A reasonable starting target is an encrypted backup after every route/profile change and daily, with a tested four-hour RTO. This is a planning example, not a measured guarantee.

## Loss of injector process or host

1. Immediately redirect affected NetBird Reverse Proxy services to their previously recorded direct targets if the old path is known-good.
2. Do not delete the failed peer, route, or old middleware; preserve evidence.
3. Provision an isolated matching host and NetBird peer.
4. Verify release checksum and Node version; install without pointing public traffic at it.
5. Restore the latest verified backup and the separate NetBird PAT from the vault.
6. Recreate narrow NetBird policies for the new injector peer.
7. Test with the migration test domain, then move one production domain and monitor.

## Corrupt state database

Stop the service, preserve the database and WAL/SHM files read-only for investigation, verify backups, and use `./setup restore`. Never run ad-hoc SQLite repair on the only copy. If no backup exists, configuration exports can create disabled drafts on a clean installation but do not contain audit/version history.

## Compromised administrator or injected script

1. Switch affected routes to a known historical passthrough version or direct NetBird target.
2. Revoke the administrator access path and rotate the admin password.
3. Revoke/rotate the NetBird PAT even though it is read-only intent.
4. Preserve database, audit events, host/systemd logs, browser evidence, and external analytics/widget records.
5. Identify every route/profile version containing the snippet and its browser-accessible data.
6. Follow organizational incident response and notification requirements.

## Failed update

The lifecycle program automatically reinstates the previous release symlink when the new process misses health. If both fail, stop, verify the pre-update backup, restore it, and start the previous release explicitly. Do not continue retrying an unknown database migration.

## Recovery validation

After any recovery, verify ordinary pages, auth, APIs, uploads, downloads, redirects, WebSockets, SSE, CSP, every injection exactly once, route history, backup, and API-outage independence before returning all domains.
