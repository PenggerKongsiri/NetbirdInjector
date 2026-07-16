# Production checklist

All boxes are required before calling a deployment production-ready. Preserve evidence (commands, versions, logs, screenshots, checksums) with the change record.

## Release and platform

- [ ] Git tag, source artifact, and SHA-256 verified from two independent channels.
- [ ] `npm run check` passes on the exact Linux architecture and Node 24 patch release.
- [ ] Support-matrix status is verified, not experimental, for the chosen OS/architecture/deployment method.
- [ ] Installer repeat, update failure rollback, repair, backup, restore, and preserving uninstall pass on a disposable matching VM.
- [ ] 24-hour load/soak and graceful-restart tests pass within memory/latency targets.
- [ ] Independent security review has no unresolved critical/high or reasonable medium finding.

## Host and service

- [ ] Dedicated unprivileged account; no sudo, shell, Docker socket, or extra group membership.
- [ ] Admin listener is `127.0.0.1`/`::1`; access uses SSH tunnel.
- [ ] Data listener is reachable only from intended NetBird Reverse Proxy peers.
- [ ] Systemd sandbox and file ownership match documentation.
- [ ] Firewall denies public access to 8080/9090.
- [ ] Time synchronization, disk monitoring, log retention, and host patching are configured.

## NetBird and network policy

- [ ] Injector has a stable peer identity/group.
- [ ] Source policy permits only reverse-proxy peer/group to injector TCP port.
- [ ] Egress policy permits only injector to named destination groups/ports.
- [ ] Application CIDRs and ports are equally narrow in app configuration.
- [ ] Trusted ingress CIDRs are narrowed where possible.
- [ ] API PAT belongs to a service user, least privilege, read-only intent, separate token file, vault recovery, rotation owner/date.
- [ ] A NetBird API outage test proves active traffic continues.

## Routes and injection

- [ ] Every public hostname is unique and exact; no wildcard/default behavior is expected.
- [ ] HTTPS verification is enabled; SNI/custom CA reviewed; no secret private key in CA field.
- [ ] Host, timeouts, health path/statuses, response ceiling, request ceiling, and exclusions are application-specific.
- [ ] API/download/media/auth/WebSocket/SSE/range/streaming paths are tested.
- [ ] CSP behavior is reviewed; no policy weakening occurs.
- [ ] Every arbitrary snippet has an owner, source, purpose, data-handling review, and removal plan.
- [ ] Preview shows scripts exactly once and correct order at every insertion point.
- [ ] Passthrough and prior-version rollback are tested.

## Operations and recovery

- [ ] Fresh local and encrypted off-host backups verify successfully.
- [ ] NetBird PAT recovery is separate and tested.
- [ ] Restore is tested on an isolated host.
- [ ] Monitoring covers process health, 421/4xx/5xx, latency, memory, disk, upstream failures, and browser-side script errors without logging sensitive content.
- [ ] Rollback owner, exact NetBird dashboard operation, maintenance window, and abort thresholds are written down.
- [ ] Existing Coolify/Traefik middleware and plugin remain intact during parallel migration.
