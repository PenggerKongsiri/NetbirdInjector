# NetBird integration

## Data path

Create an ordinary NetBird Reverse Proxy HTTP service whose target is the injector peer and proxy port (default 8080). The injector then routes by the original public Host to the configured destination peer/IP/DNS and port.

NetBird's reverse proxy terminates public TLS before this hop. The injector may use HTTP or HTTPS to the final upstream. If HTTPS is selected, verification is on by default; configure SNI and a custom CA only when required.

## Minimum policies

Use exact groups and ports rather than all-to-all access. Names here are examples:

1. `netbird-reverse-proxy` source group -> `injector` destination group, TCP 8080 only.
2. `injector` source group -> each application destination group, only each configured application TCP port.
3. Administrator peers -> injector SSH port, if SSH is the chosen admin tunnel.
4. Do not expose admin TCP 9090 through a public service. Keep it host-loopback by default; optional private HTTPS must be limited to the administrator group and matching `admin.allowedCidrs` as documented in `ADMIN_ACCESS.md`.

If the destination is a routed RFC1918 resource, add only its CIDR to both NetBird network policy and `network.allowedTargetCidrs`. The application intentionally requires both layers.

NetBird documents that backends see a NetBird proxy address and may need trusted-proxy configuration. Review the [backend service guidance](https://docs.netbird.io/manage/reverse-proxy/service-configuration). Do not automatically trust all forwarding headers at the application: trust the injector address/policy boundary appropriate to the deployment.

## Peer discovery

Manual mode is the default and needs no token. API mode calls documented endpoints server-side:

- `GET /api/peers` for name, IP, IPv6, DNS label, connected state, last seen, OS, version, and accessible-peer count.
- `GET /api/reverse-proxies/clusters` for optional cluster visibility.

The browser receives only selected metadata. The token stays in `netbird.token`. Calls are cached and bounded. API failures appear only in the admin UI; route snapshots contain their own destinations and continue serving.

"Injector can reach" is determined by candidate route health checks, not NetBird's online flag. This avoids turning the peer browser into a general network scanner.

## Reverse-proxy service writes

Automatic creation/update/deletion is not implemented in this version and `writeEnabled` is always reported false. As of the research date, official documentation describes proxy cluster and proxy-token lifecycle, but not a stable, complete service create/update payload contract suitable for safe use by this project. The first workflow is therefore manual:

1. Create a test-domain service in the NetBird dashboard.
2. Select the injector peer, HTTP, and port 8080.
3. Preserve the public Host header.
4. Validate the new route end to end.

Adding write integration later requires versioned API fixtures from supported NetBird releases, least-privilege permissions, dry-run diffs, explicit confirmation, and rollback tests.

## Ingress identity headers

NetBird documents `X-NetBird-User` and `X-NetBird-Groups` for NetBird-only services. The injector preserves them only when the socket source address is inside `network.trustedIngressCidrs`; otherwise it strips them. The same trust rule applies to incoming XFF.

The default trusted range is broad (`100.64.0.0/10`) for compatibility, so NetBird policy must ensure only the intended reverse-proxy peer can reach the injector port. A narrower account range is preferable when known. IPv6 trust is not enabled by default; add only the actual NetBird IPv6 account range after verification.
