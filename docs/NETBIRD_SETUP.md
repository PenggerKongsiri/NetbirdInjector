# NetBird setup

NetBird configuration is deliberately manual. The application has no NetBird write path and cannot create policies, services, domains, or certificates.

## Staging sequence

1. Join a disposable Ubuntu host to the intended NetBird account and place it in a dedicated injector group.
2. Install the verified release and keep the proxy listener private on TCP 8080. Keep admin on loopback TCP 9090 by default; if private HTTPS administration is required, follow [ADMIN_ACCESS.md](ADMIN_ACCESS.md) and permit only the administrator group.
3. Create the least-privilege policies in [NETBIRD_POLICIES.md](NETBIRD_POLICIES.md).
4. In NetBird Reverse Proxy, create a new HTTP-mode service for `<TEST_DOMAIN>` whose backend is the injector peer on port 8080.
5. Preserve the incoming public Host value. The injector selects only an exact configured hostname; any other Host receives 421.
6. In the injector UI, create a disabled route for `<TEST_DOMAIN>`, select or enter the destination peer, configure Host/SNI/CA, attach profiles, preview, save, test, and activate.
7. Validate the complete checklist in [EXTERNAL_VALIDATION.md](EXTERNAL_VALIDATION.md) before considering any existing domain.

NetBird Reverse Proxy HTTP mode terminates client TLS. Backend TLS remains independent: use an HTTPS route, normal certificate validation, explicit SNI, and an optional certificate-only custom CA when the application requires it. Never put a private key in the CA field.

## Optional read-only API discovery

Manual target entry is always available. API mode is control-plane convenience only and never enters the data-plane dependency path. Create a dedicated service-user PAT, store it in the organization vault, then create the file without putting its value in shell history:

```bash
sudo install -o root -g netbird-injector -m 0640 /dev/null /etc/netbird-injector-manager/netbird.token
sudoedit /etc/netbird-injector-manager/netbird.token
sudo ./setup reconfigure
sudo ./setup doctor
```

The client sends `Authorization: Token <PAT>` only from the server. The token, API response, and credentials never enter the browser or export. API loss may make peer selection unavailable but does not interrupt active proxy routes.

References: [NetBird Reverse Proxy](https://docs.netbird.io/manage/reverse-proxy), [service configuration](https://docs.netbird.io/manage/reverse-proxy/service-configuration), [API authentication](https://docs.netbird.io/api/guides/authentication), and [peers API](https://docs.netbird.io/api/resources/peers).
