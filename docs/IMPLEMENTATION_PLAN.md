# Implementation plan and review record

## Completed local milestones

1. Researched current official NetBird peers, authentication, reverse-proxy, cluster, and backend-forwarding documentation.
2. Compared Go, Rust, Node, and proxy-plugin designs; selected a dependency-light Node 24 architecture.
3. Implemented strict validation, CIDR policy, SQLite current-draft/version store, bounded injection engine, data proxy, admin API/UI, read-only NetBird client, lifecycle tooling, and documentation.
4. Added unit, integration, malformed-input corpus, compression, WebSocket, timeout, forwarding-header, route-history, authentication, custom-CA, and SNI tests.
5. Added pinned least-privilege CI, non-publishing release-validation artifacts, checksums/manifests, hardened systemd service, an unprivileged container, isolated sandbox, reproducible browser smoke, and mocked Linux lifecycle tests.

## Remaining validation gates

1. Run the committed CI on Linux amd64 and native arm64 and preserve the logs.
2. Run an independent security review and HTTP request-smuggling differential tests against the actual upstream proxies used in production.
3. Run 24-hour load/soak tests with HTML near the configured buffer ceiling and long-lived WebSocket/SSE traffic.
4. Exercise install/update rollback/repeated install/backup/restore/uninstall on disposable Ubuntu and Debian VMs.
5. Validate the peer response against the intended Cloud or self-hosted NetBird version with a least-privilege fake/test PAT.
6. Perform the test-domain and single-domain migration without touching the existing middleware/plugin.
