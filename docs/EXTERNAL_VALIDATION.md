# External validation gates

All items below require an authorized human on a disposable real environment. They were not executed by local development.

## Ubuntu and service

- Verify the release checksum and manifest on the intended Ubuntu version and architecture.
- Run install, reboot, health, status, doctor, graceful stop/restart, update, rollback, backup/restore, preserving uninstall, and reinstall under actual systemd.
- Record unit hardening output, file ownership, firewall rules, memory/CPU/disk/log behavior, and a 24-hour soak.

## NetBird and upstream

- Join the injector peer and apply the reviewed least-privilege policies.
- Create a temporary test-domain Reverse Proxy service with public Host preserved.
- Validate manual target mode and, if approved, current API peer discovery with a dedicated PAT.
- Prove API/token removal has no data-plane impact.
- Validate the chosen Coolify/Traefik/application combination, public TLS, backend TLS/SNI/custom CA, redirects, cookies, auth/CSRF, all required methods, uploads/downloads/ranges, WebSockets, SSE, streaming, slow/error/reset behavior, and unknown-host failure.

## Browser and injection

- Test representative desktop/mobile browsers, keyboard use, application CSP, every profile item and order, exclusions, duplicate prevention, and browser-side script failures.
- Confirm that no request/response bodies, cookies, authorization, tokens, or sensitive query values appear in logs or diagnostics.

## Migration gate

Keep the existing NetBird/Coolify/Traefik route and injector active. Observe the test domain for the agreed window and abort thresholds. Only then propose one controlled existing-domain target change with an immediate dashboard rollback owner.

Until the evidence is attached to the change record, status is `EXTERNAL TEST REQUIRED` and immediate production cutover is `NO`.
