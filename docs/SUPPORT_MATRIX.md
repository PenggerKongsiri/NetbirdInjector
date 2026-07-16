# Support matrix and limitations

Status is intentionally conservative. "Designed" means code/configuration exists; it does not mean production-tested.

## Platforms

| Environment | Status | Evidence / next gate |
|---|---|---|
| Windows x64 development, Node 24.18 | Locally tested | Unit/integration suite in this workspace |
| Linux amd64, Node 24.18 | Locally container-tested; staging experimental | Sandbox and mocked lifecycle pass; matching Ubuntu VM required |
| Linux arm64, Node 24.18 | Build and emulated runtime tested; experimental | OCI build and QEMU runtime pass; physical arm64 and native lifecycle required |
| Ubuntu systemd | Designed; experimental | Full lifecycle VM test required |
| Debian systemd | Designed; experimental | Full lifecycle VM test required |
| Unprivileged Linux container with host network | Locally built; experimental | UID 10001/capability-free sandbox passes; real Linux NetBird host required |
| Non-systemd Linux native | Unsupported | Lifecycle tooling assumes systemd |
| Kubernetes | Unsupported | No manifests, HA coordination, or readiness validation |

## Protocols and upstreams

| Capability | Status |
|---|---|
| HTTP upstream and HTTP/1.1 client traffic | Locally tested |
| HTML, gzip, JSON, SSE, downloads, ranges, redirects/errors, slow upstream | Locally tested subset |
| WebSocket upgrade/tunnel | Locally tested raw tunnel |
| HTTPS upstream with custom CA and correct/wrong SNI | Locally tested with fake test CA/server certificate |
| Public CA HTTPS | Implemented; external integration test pending |
| Brotli/deflate | Unit-tested codec path; full proxy integration pending |
| Large streaming uploads | Limit behavior tested; sustained load pending |
| HTTP/2 from NetBird to injector | Unsupported; HTTP/1.1 listener only |
| HTTP/2 to upstream | Unsupported |
| TCP/UDP/TLS layer-4 NetBird services | Unsupported; project is an HTTP application proxy |

## Deployment combinations

Self-hosted NetBird, NetBird Cloud, Coolify, Traefik, Nginx, Caddy, Apache, direct app ports, routing peers, and separate/same-host peer placement are **architecturally compatible but unverified** until each intended production combination completes the migration checklist. No compatibility claim is made solely because the proxy uses standard HTTP.

## Current functional limitations

- NetBird Reverse Proxy service creation/update/delete is manual; write API is not exposed.
- Peer online state comes from the API; reachability is only tested for a route candidate and port.
- Profiles are snapshotted at route activation. Editing a profile requires new route draft/activation to affect traffic.
- Duplicate detection is a literal substring, not a regular expression.
- Admin authentication is one named local administrator with optional RFC 6238 TOTP and one-time recovery codes. There is no OIDC or multi-user RBAC.
- Login rate limiting is per process and resets on restart.
- Route soft deletion has no UI restore operation; historical data remains available in SQLite/backup.
- No HA coordination. Multiple instances require an external operational model and independent state.
- Authenticated admin status reports bounded runtime/proxy counters; unauthenticated exposure remains limited to health. JSON logs contain no bodies or sensitive headers.
- `node:sqlite` API is release-candidate status in Node 24.18. Storage is isolated to ease replacement, but this is a pre-1.0 risk.
