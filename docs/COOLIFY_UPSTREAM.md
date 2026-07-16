# Coolify upstream guidance

The injector targets the application endpoint, not the Coolify dashboard and not an arbitrary public URL. Determine the exact NetBird peer/resource, protocol, port, Host header, and TLS identity for the selected application.

## Route fields

- Destination: the selected peer IP/DNS label or routed resource name.
- Port: the application listener, explicitly allowed in both NetBird policy and `network.allowedPorts`.
- Protocol: HTTP only for a trusted private cleartext hop; otherwise HTTPS.
- Upstream Host: the virtual-host name expected by Traefik or the application.
- TLS SNI: the certificate name when it differs from the destination address.
- Custom CA: certificate chain only, after independent review; private keys are rejected.
- Health: a side-effect-free path with explicit acceptable statuses.
- Exclusions: APIs, authentication callbacks, downloads, events, and other non-page paths.

If Coolify still uses Traefik internally, the injector may target Traefik with the application's Host header. That does not replace or reconfigure Traefik. Validate redirects, cookies, CSRF, uploads, downloads, WebSockets, SSE, ranges, and streaming on the test domain before migration.

Keep the old public route and injection middleware active. The new test-domain route is parallel and can be abandoned without changing the existing service.
