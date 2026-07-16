# Architecture

Research and decision record date: 2026-07-15.

## Context

NetBird's documented public API exposes peers through `GET /api/peers`, using a server-side personal access token or OAuth bearer token. The reverse-proxy product maps public domains to peer/resource targets and supports HTTP, HTTPS, and path targets. The application described here adds a second, independent HTTP proxy hop; it does not join or modify NetBird's reverse-proxy code.

Primary references:

- [NetBird REST API introduction](https://docs.netbird.io/api/introduction)
- [Peers API](https://docs.netbird.io/api/resources/peers)
- [Reverse Proxy concepts and target configuration](https://docs.netbird.io/manage/reverse-proxy)
- [API authentication](https://docs.netbird.io/api/guides/authentication)
- [Bring Your Own Proxy and documented cluster/token endpoints](https://docs.netbird.io/manage/reverse-proxy/bring-your-own-proxy)
- [Node.js 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Node.js strict HTTP parser and header limits](https://nodejs.org/api/http.html)

## Options evaluated

| Option | Strengths | Costs / risks | Decision |
|---|---|---|---|
| Go binary, SQLite, server-rendered UI | Excellent deployment story, static typing, mature proxy library | Requires external modules/toolchain; larger initial implementation; no Go toolchain in the development workspace | Strong future option, not selected for this implementation |
| Rust binary, SQLite | Strong memory safety and binary distribution | Highest complexity and slower maintenance for a small operator tool | Rejected |
| Node.js 24, built-in modules, SQLite, server-rendered UI | No third-party runtime dependencies; good streaming primitives; same language for minimal UI; built-in test runner | Requires Node 24; `node:sqlite` is currently release-candidate API; dynamic typing | Selected, with the storage API isolated and the limitation tracked |
| Node.js plus React/ORM/proxy packages | Fast UI development | Large supply-chain and frontend build surface for no essential benefit | Rejected |
| Nginx/Traefik plugin | Close to current setup | Couples lifecycle to another proxy, weak route history/UI, contradicts independent-service goal | Rejected |

## Process boundaries

```text
                    loopback/SSH by default; explicit private HTTPS optional
Administrator -----------> [ Admin HTTP(S) server :9090 ]
                                 |
                       validation + SQLite transaction
                                 |
                            immutable snapshot
                                 v
NetBird Reverse Proxy --> [ Data HTTP server :8080 ] --> NetBird IP/DNS upstream
                                 |
                       optional bounded HTML transform

Admin server --> optional NetBird REST API (peer/cluster metadata only)
Data server  -X-> NetBird REST API (no dependency)
```

The admin and data listeners are separate. The admin listener defaults to loopback and an SSH tunnel. A non-loopback bind is accepted only for one explicit private address, native TLS certificate/key, Secure cookies, and private client CIDRs. Wildcard/public binds fail configuration. Application-layer source filtering runs before health, static, login, or authenticated handlers.

## Components

- `src/proxy.mjs`: exact-host data plane, strict forwarding, WebSocket tunnel, bounded transform, health probe.
- `src/lib/injection.mjs`: eligibility assessment, rendering, markers, insertion, compression limits, preview.
- `src/lib/network.mjs`: IPv4/IPv6 CIDR parsing, ingress trust, target/port authorization, dial-time DNS checks.
- `src/lib/store.mjs`: SQLite schema, WAL/FULL durability, drafts, versions, profiles, audit records, transactions.
- `src/admin.mjs` and `src/ui/`: control plane and dependency-free UI.
- `src/netbird.mjs`: optional read-only peer/cluster cache and local CLI status.
- `setup`, `scripts/`: lifecycle, diagnostics, checksummed backups.

## Atomic activation

1. A mutation creates a new immutable `draft` row; the current active version is untouched and any older pending draft becomes superseded.
2. Schema, hostname, CIDR, port, content, URL, and size validation runs.
3. Attached profile items and revisions are copied into the candidate route snapshot.
4. Enabling a candidate requires an upstream HTTP(S) health check with its configured Host, SNI, CA, and expected statuses.
5. One SQLite `BEGIN IMMEDIATE` transaction marks the previous version superseded and the candidate active.
6. The data plane builds a complete new hostname map, then swaps one JavaScript reference. Existing requests keep their old route object; unrelated routes never restart.

A rollback creates a draft from the complete historical snapshot, rechecks the upstream, and activates it with the same transaction.

Enable/disable uses the exact active snapshot rather than rematerializing profiles. Enabling repeats the upstream health gate; the operation refuses to overwrite an unrelated pending draft.

## Injection pipeline

The proxy never parses arbitrary response bodies eagerly. A response is a transform candidate only when all checks pass: route mode, `GET`, HTTP 200, `text/html`, non-download, non-range, not `no-transform`, supported compression, path scope, enabled items, and CSP policy. Other responses stream directly.

Candidate wire bytes and decompressed output are limited by `maxInjectBytes`. If the wire limit is exceeded, transformation switches to passthrough. If decompression, UTF-8 conversion, rendering, or recompression fails, the original wire body is emitted. Cache validators are removed only after a response enters the transform path.

Insertion uses a bounded, case-insensitive HTML boundary scanner rather than a DOM rewrite. It skips comments and raw-text elements so tag-like text inside scripts/styles cannot be mistaken for document structure, and ambiguous or unterminated boundaries fail closed. This intentionally preserves arbitrary HTML bytes and limits behavior. If the requested element is missing, that item is skipped; the system does not invent a document structure.

## Persistence and secrets

SQLite stores routes, historical snapshots, profiles, audit data, and custom public CA material. It does not store NetBird tokens, browser sessions, visitor content, credentials, cookies, Authorization headers, or page bodies. NetBird tokens live in a separately permissioned file. Sessions live in memory and disappear on restart.

Native backups include the configuration (which contains a password hash and token path) and a consistent SQLite copy. The token file is excluded deliberately and must be recovered from a secret vault.

## Deliberate constraints

- HTTP/1.1 data plane only; NetBird may terminate HTTP/2 before this hop.
- No generic `CONNECT`, forward proxy, upstream redirect following, wildcard host, or default upstream.
- No automatic CSP mutation.
- No user-provided duplicate regex: `duplicatePattern` is a literal substring to avoid regular-expression denial of service.
- NetBird service write automation is disabled. Current official documentation specifies cluster/token lifecycle but does not publish a stable service create/update request schema suitable for a security-sensitive client.
- Profile edits do not silently change live traffic. A new route activation snapshots the new profile revision.
