# Installation

## Production prerequisites

- A disposable staging host first. Native installation is designed for Linux with systemd; it is not yet validated on a real Ubuntu/Debian VM.
- Node.js `24.15–24.x` from a trusted distribution source. The tested workspace uses 24.18.0.
- A dedicated NetBird peer for the injector, or a host whose NetBird policies let only the required proxy source reach the injector and only the required destinations/ports leave it.
- A free TCP listener, default `8080`, reachable by NetBird Reverse Proxy but not the public internet.
- SSH access for the recommended loopback admin UI, or one private LAN/NetBird IP plus an administrator client CIDR for optional native HTTPS.
- OpenSSL when choosing direct private HTTPS; the installer uses it to generate a local certificate and prints its SHA-256 fingerprint.
- A verified repository/release bundle. Do not make an unaudited remote one-line shell command the installation path.

## Native setup

Inspect the repository and checksums, then:

```bash
chmod 0755 setup
sudo ./setup detect
sudo ./setup install
```

For a disposable automated staging build only, the initial password may be read from a root-only regular file instead of a TTY:

```bash
sudo install -o root -g root -m 0600 /dev/null /run/nim-admin-password
sudoedit /run/nim-admin-password
sudo NIM_ADMIN_PASSWORD_FILE=/run/nim-admin-password ./setup install
sudo rm -f /run/nim-admin-password
```

The program detects OS, architecture, systemd, container runtime, NetBird CLI/status, and port conflicts. Installation creates:

| Path | Purpose | Owner/mode |
|---|---|---|
| `/opt/netbird-injector-manager/releases/<timestamp>` | Immutable app release | root, not writable by service |
| `/opt/netbird-injector-manager/current` | Atomic release symlink | root |
| `/etc/netbird-injector-manager/config.json` | Configuration and admin hash | root:`netbird-injector`, `0640` |
| `/etc/netbird-injector-manager/netbird.token` | Optional NetBird PAT; create separately | root:`netbird-injector`, `0640` |
| `/var/lib/netbird-injector-manager/state.db` | Route/profile/history database | `netbird-injector` |
| `/var/backups/netbird-injector-manager` | Consistent local backups | `netbird-injector`, directory `0750` |
| `/etc/systemd/system/netbird-injector-manager.service` | Hardened service unit | root |

Interactive installation asks for:

1. An administrator username (3â€“64 lowercase letters, numbers, dots, underscores, or hyphens).
2. A password of at least 14 characters, entered twice without echo.
3. Admin access mode: loopback plus SSH tunnel (recommended), or native HTTPS on one explicit private LAN/NetBird IP.
4. In HTTPS mode, the private bind IP and private administrator client CIDR list.

The password is stored only as a bounded scrypt hash. At first start, the username/hash seed the local account in SQLite. Later account and 2FA changes are made from **Settings** in the UI.

Access the UI through an SSH tunnel:

```bash
ssh -L 9090:127.0.0.1:9090 injector-host
```

Then open `http://127.0.0.1:9090`. Do not publish this listener through NetBird Reverse Proxy.

For direct private HTTPS, select option 2 during installation. If the Injector VM owns `192.168.1.104` and administrators connect from that LAN, enter:

```text
Private LAN or NetBird IP: 192.168.1.104
Allowed administrator client CIDRs: 192.168.1.0/24
```

The installer generates `/etc/netbird-injector-manager/admin.crt` and `admin.key`, prints the certificate fingerprint, and configures `https://192.168.1.104:9090`. Verify the printed fingerprint before accepting the self-signed certificate. Restrict host firewall TCP 9090 to the same administrator CIDR. Never expose it to the public internet or through a public NetBird Reverse Proxy service.

See [ADMIN_ACCESS.md](ADMIN_ACCESS.md) for trusted-certificate replacement, 2FA enrollment, account recovery, and the complete security model.

## Configuration

Run the guided reconfiguration:

```bash
sudo ./setup reconfigure
```

Reconfiguration can move the admin listener between loopback and a private IP. A new self-signed certificate is generated when moving to a different private IP. Account username/password and 2FA changes belong in the UI so they do not require root or a service restart.

Secure target defaults permit only `100.64.0.0/10` and the listed application ports. Add a verified account IPv6 range or RFC1918/routed-resource CIDR only when the injector must reach it, and pair it with narrow NetBird policies.

For API mode, create a service-user PAT following the [NetBird authentication guide](https://docs.netbird.io/api/guides/authentication), put only the token in its file, and set permissions:

```bash
sudo install -o root -g netbird-injector -m 0640 /dev/null /etc/netbird-injector-manager/netbird.token
sudoedit /etc/netbird-injector-manager/netbird.token
sudo ./setup reconfigure
```

Read-only application behavior is enforced: the project exposes no NetBird write API. `netbird.writeEnabled` remains false.

## Updates and repair

Copy and verify the new release into a separate directory, enter it, then:

```bash
sudo ./setup update
```

Update creates a consistent state backup, installs a new immutable release, swaps the symlink, restarts, and polls health. On failure it restores the previous code symlink and restarts. It does not modify NetBird or routes.

Repair reapplies account/directory permissions, the unit, enablement, restart, and health check:

```bash
sudo ./setup repair
sudo ./setup doctor
```

If every administrator credential/recovery method is lost, use the explicit root-only recovery flow:

```bash
sudo ./setup reset-admin
```

It creates a backup, asks for a new username/password, stops the service, resets the local account, disables 2FA, restarts, and checks health. Enroll 2FA again immediately.

See [UPDATE_ROLLBACK.md](UPDATE_ROLLBACK.md) for manifest-required updates and health-gated manual rollback.

## Experimental container

The container path is not yet production-validated. Linux host networking is intentional: it preserves the loopback-only admin listener and lets the container use host NetBird routes without a privileged container or Docker socket.

```bash
mkdir -p data config
cp config/config.container.example.json config/config.container.json
# Replace admin.passwordHash and review CIDR/port allowlists before starting.
sudo chown -R 10001:10001 data
docker compose -f compose.example.yaml build
docker compose -f compose.example.yaml up -d
```

The container-specific example stores SQLite at `/var/lib/netbird-injector-manager/state.db`, matching the mounted data directory. Do not deploy this host-network compose file on Docker Desktop or non-Linux hosts. amd64 builds and an emulated arm64 runtime are local evidence only; the intended physical architecture must still pass staging.

## Uninstall

Default uninstall preserves configuration, credentials, state/history, and backups. Destructive categories require separate flags; see [UNINSTALL.md](UNINSTALL.md).
