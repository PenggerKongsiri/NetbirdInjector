# Troubleshooting

Start with redacted diagnostics; it never prints tokens, cookies, request headers, or page bodies:

```bash
sudo ./setup status
sudo ./setup doctor
sudo journalctl -u netbird-injector-manager --since "30 minutes ago"
```

If systemd reports `status=203/EXEC` or `/usr/bin/node: No such file or directory`, do not create an unmanaged symlink. Update to v0.1.5 or newer and run the repair path; the service unit safely searches the supported root-owned `/usr/local/bin` and `/usr/bin` locations.

## Retry reports `unable to open database file`

Update to v0.1.6 or newer and rerun the same guided installer. This can happen when the original service never started, so `config.json` exists but `/var/lib/netbird-injector-manager/state.db` was never created. The newer installer detects that exact missing-first-state condition before backup, explains it, and asks for confirmation.

Approve only if the first install never became usable and never held routes or later account/2FA changes. The recovery preserves the configured administrator hash and TLS files, initializes the missing empty database as the service user, creates the ordinary pre-update backup, and continues through health checks. It refuses a live service, a database symlink, a nonstandard database path, or an earlier backup manifest. If any of those apply, do not delete files to bypass the check; verify and restore the prior backup or investigate the state loss.

Installation, repair, and update failures now print a bounded systemd status/journal summary. If another error remains, save that summary plus these redacted commands:

```bash
sudo /opt/netbird-injector-manager/current/setup status
sudo /opt/netbird-injector-manager/current/setup doctor
```

## `421 Misdirected Request`

No active route exactly matches the incoming Host. Confirm NetBird preserves the public Host, the route is enabled and activated, and there is no trailing/alternate domain mismatch. This fail-closed result is intentional.

## `502 Bad Gateway`

Check, in order:

1. Destination port is in `network.allowedPorts`.
2. Every resolved destination address is in `network.allowedTargetCidrs`.
3. NetBird policy permits the injector peer to that destination/port.
4. The service binds a reachable address rather than only destination localhost.
5. Upstream Host and SNI are correct.
6. For HTTPS, the certificate chain matches the SNI; add a reviewed custom CA rather than turning verification off.
7. Connect/response/idle timeouts fit the application.

Run the candidate route test in the UI. It uses the same resolver, allowlists, Host, SNI, CA, protocol, and expected statuses.

## HTML is not injected

Use Preview and inspect its eligibility reasons. Common safe skips are: non-GET, non-200, non-`text/html`, route passthrough mode, excluded path, attachment, range/partial response, `Cache-Control: no-transform`, unsupported encoding, no enabled items, CSP in default skip mode, body limit, duplicate marker/text, or a missing insertion element.

Do not change CSP mode merely to silence a warning. Confirm the site's policy and script source first.

## Application login, redirects, or CSRF break

Check public Host forwarding, `X-Forwarded-Proto`, secure cookie domain, application trusted-proxy settings, redirect rewriting in NetBird, and whether an injected script changes forms or navigation. Switch the route to passthrough and activate a tested draft to separate proxy configuration from injection behavior.

## WebSocket does not upgrade

Confirm NetBird's route is HTTP mode, the final upstream supports HTTP/1.1 Upgrade, path/Host are correct, and all three hops keep idle connections long enough. Injection is never applied to upgrade traffic.

## NetBird peers are unavailable in UI

Routes continue normally. Check `netbird.mode`, API base URL, token file ownership/mode, PAT validity/permissions, and management reachability. Use manual IP/DNS entry until API metadata returns.

## Admin UI unavailable

It binds loopback by default. Use SSH port forwarding. For private HTTPS mode, confirm the VM owns the configured IP, the browser source is inside `admin.allowedCidrs`, the certificate/key are readable by the service, TCP 9090 is allowed only from the administrator network, and the URL uses `https://`. A `403` means the application CIDR gate rejected the source. A certificate warning must be checked against the fingerprint printed by setup. If the service runs but health is unavailable, check the listener, certificate, client CIDRs, and systemd sandbox. Never solve this by exposing 9090 publicly.

If the administrator loses the password, authenticator, and recovery codes, run `sudo ./setup reset-admin` from the installed release. It creates a backup and disables 2FA as part of the explicit recovery flow.
