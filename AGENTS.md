# Durable coding-agent instructions

This is a security-sensitive reverse proxy. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, and `docs/SUPPORT_MATRIX.md` before changing code.

Non-negotiable invariants:

1. Unknown or ambiguous Host values fail closed. Never add wildcard or default forwarding implicitly.
2. Every upstream dial remains constrained by global port and CIDR allowlists after DNS resolution. Never follow upstream redirects server-side.
3. NetBird API availability and credentials never enter the data-plane dependency path or browser.
4. Do not log request/response bodies, injected content, credentials, Authorization, Cookie, NetBird token, or complete sensitive query strings.
5. Non-HTML, streaming, range, download, WebSocket, SSE, oversized, malformed, and unsafe responses preserve original traffic whenever possible.
6. Do not weaken CSP automatically. Any future CSP feature needs a separate threat model, explicit control, preview, and tests.
7. Route activation and rollback remain validation/health-gated and transactional; unrelated routes do not restart.
8. Imports cannot activate traffic and must be bounded/validated before any write.
9. Admin remains loopback-only by default with CSRF, strict cookies, escaping, and no inline code permitted by its CSP.
10. Install/update/uninstall preserve data and secrets by default; destructive categories require distinct explicit requests.

Run `npm run check` after every code change. Add unit/integration tests for new branches, including negative security cases. Mark environments experimental until there is recorded test evidence. Do not commit, push, publish, deploy, SSH, change DNS/NetBird/Coolify/Traefik, or use real credentials unless a user explicitly authorizes that production action.
