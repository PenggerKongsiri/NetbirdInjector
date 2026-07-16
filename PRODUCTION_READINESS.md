# Production readiness

## Current status

| Gate | Status |
|---|---|
| Local implementation/security review | PASS |
| Controlled disposable Ubuntu/NetBird staging bundle | PASS |
| Real NetBird test-domain validation | EXTERNAL TEST REQUIRED |
| 24-hour staging soak | NOT TESTED |
| Actual systemd boot/reboot | NOT TESTED |
| Physical arm64 (if selected) | NOT TESTED |
| Immediate production cutover | EXTERNAL TEST REQUIRED — NO |

Docker simulation, browser automation, mocked lifecycle, and emulation do not establish production compatibility. NetBird Reverse Proxy remains a beta/current external component whose real service behavior, policy, certificate, identity headers, and chosen Coolify upstream must be validated on a temporary domain.

## Exact next human commands

On the trusted build/review workstation:

```bash
npm ci --ignore-scripts
npm run check
npm run release:build
cd dist/release
sha256sum -c SHA256SUMS
scp netbird-injector-manager-v0.1.0.tar.gz SHA256SUMS <ADMIN>@<STAGING_HOST>:/tmp/
```

On the disposable Ubuntu staging peer:

```bash
ssh <ADMIN>@<STAGING_HOST>
cd /tmp
sha256sum -c SHA256SUMS
mkdir -p "$HOME/netbird-injector-manager-0.1.0"
tar -C "$HOME/netbird-injector-manager-0.1.0" --strip-components=1 -xzf netbird-injector-manager-v0.1.0.tar.gz
cd "$HOME/netbird-injector-manager-0.1.0"
node scripts/release.mjs verify .
npm run check:runtime
sudo ./setup detect
sudo ./setup install
sudo ./setup health
sudo ./setup status
sudo ./setup doctor
sudo ./packaging/post-install-verify.sh
sudo ./setup backup
```

During `setup install`, create the administrator username/password and choose loopback/SSH (recommended) or explicit private-IP HTTPS. For a VM that owns `192.168.1.104`, remote answers may be `192.168.1.104` and `192.168.1.0/24`; then verify the printed certificate fingerprint and open `https://192.168.1.104:9090`. After first login, enable authenticator 2FA in **Settings** and store the recovery codes off-host.

Keep admin private:

```bash
ssh -L 9090:127.0.0.1:9090 <ADMIN>@<STAGING_HOST>
```

If read-only NetBird API discovery is approved, create the PAT file without shell history:

```bash
sudo install -o root -g netbird-injector -m 0640 /dev/null /etc/netbird-injector-manager/netbird.token
sudoedit /etc/netbird-injector-manager/netbird.token
sudo ./setup reconfigure
sudo ./setup doctor
```

## External NetBird/test-domain actions

An authorized NetBird operator—not this application—must:

1. Put the injector in its dedicated group.
2. Permit only the Reverse Proxy group to injector TCP 8080.
3. Permit only the injector group to the selected Coolify/application group and exact port.
4. Keep TCP 9090 loopback-only by default. If private HTTPS mode is explicitly chosen, allow only the administrator group/client CIDRs; always keep it outside public Reverse Proxy.
5. Create `<TEST_DOMAIN>` as a new HTTP-mode service targeting injector TCP 8080 with public Host preserved.
6. Leave the existing production domain, target, Traefik middleware, and plugin unchanged.

In the admin UI, create the exact `<TEST_DOMAIN>` route as disabled, configure the selected peer/port/Host/SNI/CA, attach reviewed profiles, preview representative HTML/CSP, save, test, and activate. Run every item in `docs/EXTERNAL_VALIDATION.md` and the 24-hour command:

```bash
npm run soak:staging | tee soak-24h.json
```

## Backup, rollback, and uninstall commands

```bash
sudo /opt/netbird-injector-manager/current/setup backup
sudo /opt/netbird-injector-manager/current/setup rollback
sudo /opt/netbird-injector-manager/current/setup restore /var/backups/netbird-injector-manager/<VERIFIED_BACKUP>
sudo /opt/netbird-injector-manager/current/packaging/collect-logs.sh
sudo /opt/netbird-injector-manager/current/setup uninstall
```

Traffic rollback is first: restore only the affected NetBird service target to `<OLD_PEER>:<OLD_PORT>`. Do not uninstall or delete evidence during an incident. Default uninstall preserves config, token file, data/history, and backups.

References: [NetBird Reverse Proxy](https://docs.netbird.io/manage/reverse-proxy), [service configuration](https://docs.netbird.io/manage/reverse-proxy/service-configuration), [API authentication](https://docs.netbird.io/api/guides/authentication), [peers API](https://docs.netbird.io/api/resources/peers), and [bring your own proxy](https://docs.netbird.io/manage/reverse-proxy/bring-your-own-proxy).
