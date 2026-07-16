# Migration from a Traefik injection plugin

This is a parallel migration. The existing plugin and working service remain intact until the new route is proven and separately approved.

1. Inventory the current domain, backend peer/port, Host/SNI, headers, middleware order, plugin configuration, injection content, CSP, exclusions, monitoring, and rollback owner.
2. Install the injector on a separate disposable NetBird peer or approved host without changing any existing service.
3. Configure least-privilege source and destination policies.
4. Create `<TEST_DOMAIN>` as a new NetBird Reverse Proxy service targeting injector TCP 8080. Do not repoint the existing domain.
5. Create the matching disabled injector route, configure the original upstream, attach profiles, preview, test, and activate.
6. Run functional, browser, security, load, restart, API-outage, and rollback checks. Compare behavior with the old route.
7. Observe for the agreed test window. Any threshold failure abandons the test service; the existing domain remains unchanged.
8. For an approved first domain, change only its NetBird backend target to the injector. Keep the former backend value and Traefik plugin ready.
9. On failure, immediately restore that service target in NetBird. Do not uninstall or delete state during incident rollback.
10. Migrate additional domains one at a time. Remove the old plugin only under a later, separate destructive change after every domain and rollback window has completed.

Use [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) and [EXTERNAL_VALIDATION.md](EXTERNAL_VALIDATION.md) as mandatory gates.
