# Testing

All automated tests use fake peers, a fake NetBird HTTP API, fake upstream applications, and public test-only certificates. No real account, token, domain, or production service is required.

```bash
npm run check
npm run check:source-archive
npm run test:coverage
npm run browser:test
npm run lifecycle:test
npm run sandbox:reset
npm run sandbox:test
npm run soak:short
npm run sandbox:destroy
```

`npm run check` includes syntax, example-configuration validation, current-tree and pushed-Git-history secret/generated-file/machine-path scanning, and all Node unit/integration tests. CI fetches full Git history for this check. `npm run check:source-archive` is the explicit no-`.git` variant used only by immutable source archives; it retains every applicable check and test but cannot inspect history that the archive does not contain. The lifecycle suite proves that archive and checkout bootstraps select the intended command and that the full history audit still fails closed without Git metadata. The browser smoke launches the local fake environment and pinned Chromium; it covers invalid/valid login, dashboard/route rendering, fake peer discovery, mobile viewport, keyboard focus, and logout. Administrative API integration tests cover throttling, CSRF, stored-content escaping, route/profile transactions, preview, import/export, enable/disable, and exact rollback.

The Docker lifecycle test uses a normal Debian/Node container and a mocked `systemctl`. It validates install/update/rollback/preservation logic and file permissions. It syntax-checks both installer scripts, verifies their help paths, rejects traversal in the remote source-archive allowlist, verifies restrictive Node archive modes are safely normalized, starts the service with Node available only at `/usr/local/bin/node`, builds/re-extracts the release under `umask 077` while enforcing deterministic runtime modes, proves an existing NetBird client causes no NetBird command or service/enrollment action, and proves that unknown bootstrap options and non-HTTPS self-hosted management URLs fail before installation. Release unit tests also reject wrong executable, ordinary-file, and directory modes plus symbolic links; a static systemd test prevents regression to a hardcoded `/usr/bin/node`. The lifecycle test does not execute the remote GitHub download or the bootstrap's real apt, Node download, missing-client NetBird repository/enrollment, actual systemd, boot, or reboot paths. See [SANDBOX.md](SANDBOX.md) for container functional and soak commands.

Sandbox evidence reads only the latest 2,000 Compose log lines with a fixed child-process buffer, so higher-throughput and long-running soaks cannot exhaust the reporter by capturing an unbounded log history. The report states the requested tail size; its log counters describe that bounded evidence window.

The suite covers strict schema/configuration and CIDR policy, literal-IP SSRF regression, route transactions/current-draft/history/rollback/profile snapshots, bounded profile expansion, eligibility and malformed HTML boundary handling, duplicate markers/configured snippets, compression/decompression/transformed-output ceilings, UTF-8 BOM and invalid-encoding preservation, CSP/report-only behavior, JSON/SSE/download/range passthrough, upload ceiling, slow upstream, WebSocket-only upgrades, forwarding-header spoofing, exact-host failure, password/session/cookie/rate-limit behavior, admin login/CSRF/draft/activation/exact-snapshot enable/disable/export/import rejection, custom API base paths and fake NetBird metadata/cache outage, custom CA/SNI, syntax checks, and backup corruption detection.

Start the interactive fake environment:

```bash
npm run test:environment
```

It prints a fake username/password and two random loopback ports. Use the UI, Account Settings, peer selector, preview, history, and route actions. Its database/token are temporary and deleted on Ctrl+C.

## Still-manual test categories

The production checklist still tracks the complete bootstrap plus actual systemd/reboot on a matching Ubuntu VM, public-CA HTTPS, physical arm64, current real NetBird versions, real Coolify/Traefik/application combinations, long-running production streams, and the 24-hour staging soak. Those are not claimed by local automation.
