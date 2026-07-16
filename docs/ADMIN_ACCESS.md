# Admin access, account settings, and 2FA

The admin control plane is separate from visitor traffic. Port `8080` receives only proxied application traffic; port `9090` is for trusted administrators. Do not create a public NetBird Reverse Proxy service for port `9090`.

## Choose an access mode during installation

Run the verified installer from a local release directory:

```bash
sudo ./setup detect
sudo ./setup install
```

The guided setup asks for an administrator username, a password entered twice without echo, and one of two access modes.

### Mode 1: loopback plus SSH tunnel (recommended)

The service listens on `127.0.0.1:9090`. From an administrator workstation:

```bash
ssh -L 9090:127.0.0.1:9090 <USER>@<INJECTOR_VM>
```

Open `http://127.0.0.1:9090`. The SSH channel supplies encryption and access control. This remains the safest default.

### Mode 2: HTTPS on a private LAN or NetBird IP

Use this only when the VM actually owns the address. For an Injector VM at `192.168.1.104` with administrator workstations in `192.168.1.0/24`, answer:

```text
Choose admin access mode: 2
Private LAN or NetBird IP to bind: 192.168.1.104
Allowed administrator client CIDRs: 192.168.1.0/24
```

Then browse to:

```text
https://192.168.1.104:9090
```

Remote mode is accepted only when all of these are true:

- The listener is one explicit RFC1918, NetBird CGNAT (`100.64.0.0/10`), or IPv6 ULA address.
- It is not `0.0.0.0`, `::`, loopback masquerading as remote, or a public IP.
- Native TLS certificate and key files are configured.
- Session cookies are `Secure`, `HttpOnly`, and `SameSite=Strict`.
- Every client source is inside an explicit private `admin.allowedCidrs` entry.

The installer generates a 3072-bit RSA self-signed certificate with an IP subject alternative name and prints its SHA-256 fingerprint. Verify that fingerprint on first connection. The private key is root-owned, group-readable only by `netbird-injector`, and excluded from application backups and releases.

Also restrict the host firewall and NetBird policy to administrator sources. The application CIDR check is defense in depth, not a replacement for network policy.

To install a certificate from an internal CA, replace these files while preserving ownership/modes, then restart and health-check:

```bash
sudo install -o root -g netbird-injector -m 0644 <CERTIFICATE> /etc/netbird-injector-manager/admin.crt
sudo install -o root -g netbird-injector -m 0640 <PRIVATE_KEY> /etc/netbird-injector-manager/admin.key
sudo systemctl restart netbird-injector-manager
sudo ./setup health
```

The certificate must cover the exact IP or private DNS name used by the browser. Never paste private-key material into the UI, database, Git, logs, or support reports.

## Administrator account

Setup creates one local administrator account. The UI login requires its username and password. This release intentionally has no multi-user RBAC, OIDC, email reset, or external identity-provider dependency.

Open **Settings** after login to:

- change the administrator username;
- change the password (minimum 14 characters);
- review the effective admin URL and client CIDRs;
- enroll or disable authenticator-app two-factor authentication;
- replace recovery codes and see how many unused codes remain.

Changing credentials or disabling 2FA invalidates all administrator sessions. Sensitive changes require the current password and CSRF token. TOTP and recovery values are never logged.

## Enable authenticator 2FA

1. Open **Settings** and choose **Start 2FA setup**.
2. Re-enter the current administrator password.
3. Enter the displayed Base32 secret or `otpauth://` provisioning URI in an RFC 6238 compatible authenticator.
4. Enter the current six-digit code to confirm enrollment.
5. Save the ten displayed recovery codes in a password manager. They are shown only once.

Codes use SHA-1 TOTP with six digits and a 30-second period for broad authenticator compatibility. The verifier accepts only the adjacent clock window. Keep the VM clock synchronized.

Each recovery code is single-use. The database stores only its SHA-256 hash. Replacing recovery codes invalidates every older unused recovery code. A recovery code can be entered in the same login field as an authenticator code.

## Account recovery

If the authenticator is unavailable, sign in with one unused recovery code. If all credentials and recovery codes are lost, an authorized root operator can run:

```bash
sudo ./setup reset-admin
```

This command creates a backup first, resets the username/password, disables 2FA, invalidates sessions, restarts, and checks health. It does not change routes, NetBird, DNS, or upstream applications. Enroll 2FA again and replace any off-host backup after recovery.

## Move between access modes

```bash
sudo ./setup reconfigure
```

Choose `127.0.0.1` for tunnel-only mode. Choose one private IP and its administrator client CIDRs for direct HTTPS. Moving to a new private IP generates a new certificate/fingerprint. A failed restart or health check restores the previous configuration.

## Firewall examples

Use the host's approved firewall manager. Conceptually, remote mode should allow only:

```text
administrator subnet -> injector private IP TCP 9090
all other sources     -> deny TCP 9090
```

Do not copy a firewall command blindly: interface names, existing rules, IPv6 policy, and the chosen NetBird/LAN source differ between installations.
