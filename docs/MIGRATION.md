# Parallel migration from Coolify/Traefik injection

The existing middleware and experimental response-rewrite plugin remain untouched until every migrated route is stable.

## Phase 1: isolated service

1. Install the injector on a separate NetBird peer or isolated host listener.
2. Keep admin on loopback. Permit only NetBird Reverse Proxy to TCP 8080.
3. Add only the destination peer CIDR and port to the injector allowlists and NetBird policy.
4. Create the route as disabled. Use the intended upstream Host, HTTPS SNI, certificate verification, exclusions, size limit, and injection profile.
5. Save and preview representative HTML with and without CSP, existing script markers, missing head/body elements, and excluded paths.
6. Enable the draft and activate only after the candidate health test passes.

## Phase 2: test domain

1. Create a new test domain/service in NetBird Reverse Proxy targeting the injector peer:8080.
2. Forward the test domain to the same application peer currently used by Coolify/Traefik.
3. Verify normal pages, login/logout, cookies, redirects, POST/upload, APIs, JSON, WebSockets, SSE, downloads, media, PDFs, ranges, and error pages.
4. Confirm every intended script appears exactly once and no script appears on excluded responses.
5. Compare CSP console behavior and browser network failures. The injector must not weaken CSP.
6. Verify the application sees the intended Host, scheme, visitor IP chain, and trusted identity headers.
7. Restart the injector and simulate NetBird API outage; the test domain must continue.
8. Activate/rollback a harmless route version while a WebSocket and download are active.

## Phase 3: first real domain

1. Back up injector state and export route configuration.
2. Select one low-risk real domain with an owner and rollback window.
3. Point only that NetBird Reverse Proxy service to the injector. Do not change the old middleware/plugin.
4. Monitor HTTP status, latency, upstream errors, memory, WebSockets, application auth, and script duplication for the agreed window.
5. On failure, point that NetBird service back to its old target. The old injection path is still present.

## Phase 4: gradual completion

Move one domain at a time. Only after all domains have completed their monitoring windows may an operator separately plan removal of the old Traefik middleware. Remove the experimental plugin only after no stable route references it and after its own backup/rollback plan is approved.
