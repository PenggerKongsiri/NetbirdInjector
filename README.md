# NetBird Injector Manager

NetBird Injector Manager is an independent, exact-host reverse proxy and administrator-controlled HTML injection manager. It is designed to sit between NetBird Reverse Proxy and an internal application without changing NetBird, Coolify, Traefik, or the destination service.

```text
Visitor -> NetBird Reverse Proxy -> Injector Manager -> selected NetBird peer/app
```

## Project status

This repository is a security-focused **pre-1.0 staging candidate**, not a declaration of production readiness. Unit/integration tests, a real local browser smoke, the isolated Docker sandbox, short soak, mocked Linux lifecycle, release verification, and multi-architecture container checks are documented locally. Actual systemd/reboot, physical arm64, a 24-hour staging soak, and real NetBird/Coolify/test-domain behavior remain external gates in [the support matrix](docs/SUPPORT_MATRIX.md) and [external validation checklist](docs/EXTERNAL_VALIDATION.md).

Do not replace a working route yet. Use the parallel test-domain migration in [docs/MIGRATION_FROM_TRAEFIK_PLUGIN.md](docs/MIGRATION_FROM_TRAEFIK_PLUGIN.md).

## What is implemented

- Exact normalized hostname routing; unknown hosts return `421` and never reach a default upstream.
- Atomic current-draft activation, health-gated changes, exact-snapshot enable/disable, version history, soft deletion, and one-click rollback.
- HTTP/HTTPS upstreams, explicit Host and TLS SNI, TLS verification, custom CA PEM, timeouts, streaming uploads, redirects, errors, SSE, ranges, and WebSocket tunneling.
- Global destination CIDR and port allowlists with DNS revalidation at dial time to contain SSRF and DNS rebinding.
- Safe HTML eligibility rules: only bounded `200 GET text/html` responses; downloads, APIs, binary data, ranges, `no-transform`, unsupported compression, CSP-protected pages (default), and excluded paths pass unchanged.
- Gzip, deflate, and Brotli response modification with a decompressed-size ceiling.
- External/inline scripts, external/inline styles, arbitrary approved HTML, meta tags, data attributes, integrity/crossorigin/referrer policy, priority ordering, path/host scopes, nonce copying, duplicate text, and stable manager markers.
- A simple-by-default operator UI: a live traffic map shows `NetBird service -> Injector VM -> destination peer`, and a guided site editor keeps raw IDs, TLS/SNI overrides, health details, CSP controls, import/export, preview, and audit under an explicit **Advanced mode** switch.
- Reusable, editable, revisioned profiles plus a paste-and-extract Umami analytics/recorder form. The bounded parser accepts only one or two empty external script tags, extracts the URLs and website ID without executing the paste, and rejects inline code, extra markup, unknown attributes, credentials, and inconsistent IDs.
- Guided external-script, inline-JavaScript, and HTML block/card injection without writing JSON. Profile contents and direct items are snapshotted into route versions for exact rollback; saving a draft never changes live traffic.
- Loopback-only admin UI by default, or explicit private-IP HTTPS with a private client-CIDR allowlist. Authentication includes a named local administrator, scrypt password, optional authenticator-app TOTP 2FA, one-time recovery codes, expiring sessions, Secure/HttpOnly/SameSite cookies for remote mode, CSRF protection, throttling, strict CSP, escaped rendering, and audit records.
- Optional server-side NetBird peer and reverse-proxy cluster discovery. API loss never affects proxy traffic. Tokens are read from a server-only file and never returned to the browser.
- Safe configuration export/import: imported routes are always disabled drafts and identifier conflicts fail without changing active traffic.
- Native lifecycle program for install, update, verified/manual rollback, reconfigure, repair, health, status, doctor/diagnostics, backup, restore, and preserving uninstall.
- Rootless, capability-free experimental container definition; no Docker socket and no privileged mode.

## Guided Ubuntu/Debian VM installation

The simplest staging path is the guided installer. It supports x86_64 and arm64 Ubuntu/Debian hosts booted with systemd.

After this repository is public, the requested one-command installer is:

```bash
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/PenggerKongsiri/NetbirdInjector/main/install.sh | bash
```

Run it as a normal sudo-capable user, without `sudo` before `curl` or `bash`. The small remote entry script resolves `main` to one immutable Git commit through GitHub's API, downloads that exact source archive, rejects unexpected paths/links, prints the commit and archive SHA-256, and then opens the full interactive bootstrap through `/dev/tty`.

For self-hosted NetBird, pass the management URL through to the bootstrap:

```bash
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://raw.githubusercontent.com/PenggerKongsiri/NetbirdInjector/main/install.sh \
  | bash -s -- --netbird-management-url https://netbird.example.com
```

`curl | bash` necessarily trusts the repository owner, the current `main` branch, GitHub, DNS, and TLS at execution time. No project can remove that trust. The safer review-first form is:

```bash
installer="$(mktemp)"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$installer" \
  https://raw.githubusercontent.com/PenggerKongsiri/NetbirdInjector/main/install.sh
less "$installer"
bash "$installer"
rm -f "$installer"
```

The complete-checkout path remains available, including while the repository is private:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/PenggerKongsiri/NetbirdInjector.git
cd NetbirdInjector
less bootstrap-ubuntu.sh
chmod 0755 bootstrap-ubuntu.sh
./bootstrap-ubuntu.sh
```

Run it as your normal sudo-capable user when possible. The script:

- installs the OS tools and a compatible official Node.js 24 archive after SHA-256 verification;
- leaves an existing NetBird installation, service, management URL, and enrollment untouched; when NetBird is missing, installs it through its signed apt repository and guides `netbird up` without accepting or storing a setup key;
- runs the locked dependency install, all source-applicable checks/tests (plus the full Git-history audit when metadata is present), high/critical dependency audit, release build, and release-manifest verification; and
- starts the existing systemd installer, which asks for the administrator username, password, and loopback or private-HTTPS admin access mode.

If an earlier first start failed after saving configuration but before creating `state.db`, rerunning the same command detects that exact incomplete state. It does not silently invent data: it refuses active services, database symlinks, nonstandard database paths, and installations with an earlier backup manifest, then asks before initializing the empty first-start database from the preserved administrator configuration. After approval, the ordinary pre-update backup and health-gated update continue. Do not approve this recovery if the installation ever held routes or later account/2FA changes; investigate and restore a verified backup instead.

For a self-hosted NetBird deployment where the client is not installed yet, either enter its HTTPS management URL when prompted or pass `--netbird-management-url`. If NetBird is already installed, all NetBird setup options are ignored and the existing configuration is left unchanged. If a missing client must be enrolled separately with a dashboard-generated setup key, run the bootstrap with `--skip-netbird-connect`, then run the exact enrollment command from the NetBird dashboard.

The bootstrap deliberately does **not** create NetBird policies, DNS records, firewall rules, reverse-proxy services, Coolify/Traefik changes, or application routes. Follow [the NetBird setup guide](docs/NETBIRD_SETUP.md) after installation and begin with a parallel test hostname. Ubuntu/Debian VM validation is still an external pre-1.0 gate; see [the support matrix](docs/SUPPORT_MATRIX.md).

To update an existing managed VM, run the same one-command installer again. It detects `/opt/netbird-injector-manager/current` and the existing configuration, leaves an already installed NetBird client alone, creates a checksummed backup, verifies the new release manifest, restarts the service, and requires a successful health check. A failed restart or health check restores the previous code automatically. Routes, history, account settings, 2FA, certificates, and configuration remain in place.

## Secure quick start for local evaluation

Requirements: Node.js `24.15–24.x`. Node 24.18.0 is the tested development version.

```bash
cp config/config.example.json config/config.json
read -rsp "Admin password: " NIM_PASSWORD; printf '\n'
printf '%s' "$NIM_PASSWORD" | node scripts/hash-password.mjs
unset NIM_PASSWORD
```

Put the printed hash in `admin.passwordHash`. For a local fake upstream, explicitly add `127.0.0.1/32` to `network.allowedTargetCidrs`; never copy that testing allowance into production without reviewing the SSRF impact.

```bash
npm run check
npm run browser:test
NIM_CONFIG=./config/config.json node src/main.mjs
```

Open the private UI through `http://127.0.0.1:9090`. The data-plane listener is `0.0.0.0:8080` by default.

## Manual native installation

If prerequisites and NetBird enrollment are already handled, copy a verified release or checked-out repository to the target Linux peer, inspect it, then run:

```bash
chmod 0755 setup
sudo ./setup detect
sudo ./setup install
```

The installer creates the unprivileged `netbird-injector` account and asks for an administrator username, password, and access mode. The recommended mode keeps admin on loopback behind an SSH tunnel. An optional mode serves native HTTPS on one explicit RFC1918, NetBird CGNAT, or IPv6 ULA address, never a wildcard or public IP. It installs a hardened systemd unit and checks health. It does not touch NetBird, DNS, firewall policy, Coolify, Traefik, or current routes. See [the installation guide](docs/INSTALL.md) and [admin access/account guide](docs/ADMIN_ACCESS.md).

After signing in, open **Settings** to change the administrator username/password, enroll authenticator 2FA, save or replace one-time recovery codes, disable 2FA, and see the effective admin URL/client CIDRs. Listener, certificate, and network changes remain root-controlled through `sudo ./setup reconfigure` because they require a service restart.

For the first site, stay in the default simple mode:

1. Open **Injections**. For Umami, paste the tracker and optional recorder tags, review the extracted website ID and HTTPS URLs, and save the reusable injection.
2. Open **Sites**, select **Add a site**, enter the exact public hostname and the destination NetBird peer/IP/DNS name, protocol, and port.
3. Choose the saved injection, or add an external script, inline JavaScript, or an HTML block/card directly to that site.
4. Select **Save safe draft**, **Test destination**, then **Activate**. Live traffic changes only at the final confirmed activation step.
5. Use **Advanced mode** only when you need explicit Host/SNI/TLS values, health rules, path scopes, CSP behavior, raw profile JSON, preview, import/export, or audit history.

Injected JavaScript and HTML run in the destination site's browser origin and are therefore as powerful as code deployed by that site. Only use reviewed content. The admin UI never executes pasted Umami tags or previews injected scripts. See [the injection profile guide](docs/INJECTION_PROFILES.md).

## Documentation

- [Architecture and major decisions](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Installation](docs/INSTALL.md)
- [Admin access, accounts, HTTPS, and 2FA](docs/ADMIN_ACCESS.md)
- [Docker sandbox](docs/SANDBOX.md)
- [NetBird setup](docs/NETBIRD_SETUP.md) and [least-privilege policies](docs/NETBIRD_POLICIES.md)
- [Coolify upstream guidance](docs/COOLIFY_UPSTREAM.md)
- [Injection profiles](docs/INJECTION_PROFILES.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Update and rollback](docs/UPDATE_ROLLBACK.md) and [uninstall](docs/UNINSTALL.md)
- [Parallel Traefik-plugin migration](docs/MIGRATION_FROM_TRAEFIK_PLUGIN.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md) and [external validation gates](docs/EXTERNAL_VALIDATION.md)
- [Production checklist](docs/PRODUCTION_CHECKLIST.md)
- [Proposed production deployment plan](docs/DEPLOYMENT_PLAN.md)
- [Disaster recovery](docs/DISASTER_RECOVERY.md)
- [Testing and fake local environment](docs/TESTING.md)
- [Support matrix and current limitations](docs/SUPPORT_MATRIX.md)
- [Security policy](SECURITY.md)

## Security boundary

Only trusted administrators should access the control plane. Injected content executes with the target site's browser origin and can read or modify that site's rendered data. The service deliberately does not weaken Content Security Policy. Treat routes, imports, custom CAs, and profile changes as production code changes.

## License

Apache License 2.0. See [LICENSE](LICENSE).
