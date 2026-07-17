# Threat model

## Assets and trust boundaries

Assets include internal application reachability, visitor sessions and content, route history, administrator credentials, NetBird API tokens, custom CA trust, and availability of existing routes. Trust boundaries are: public visitor to NetBird, NetBird to data listener, data listener to upstream, administrator to control listener, service to disk, and control listener to NetBird API.

The administrator is trusted to authorize code execution in browsers, but mistakes and malicious imports are in scope. A compromised upstream is untrusted. NetBird API availability and metadata are untrusted for data-plane availability.

## Threats and controls

| Threat | Controls | Residual risk |
|---|---|---|
| Open-proxy abuse | Exact normalized Host lookup; unknown hosts `421`; absolute-form targets and `CONNECT` rejected; no default route | A deliberately configured public hostname remains public according to NetBird settings |
| SSRF / network scanning | Global target CIDR and port allowlists; every DNS result must be allowed; dial-time DNS lookup; no redirect following; import validation | A trusted administrator can expand allowlists; authorized upstream HTTP paths may expose internal app functions |
| Unauthorized peer/port | Independent global CIDR/port authorization plus per-route validation and activation test | Network policy outside this app must still restrict the injector peer |
| Host confusion | Exactly one Host header, canonical case/trailing dot/port handling, no IP public hosts, active-host uniqueness | Internationalized names must be entered in canonical ASCII/punycode form |
| Forwarding-header spoofing | Strip `Forwarded`, XFF family, real-IP, and NetBird identity from untrusted source addresses; rebuild forwarding fields; preserve identity only from configured trusted ingress CIDRs | Overly broad trusted ingress CIDRs let an authorized NetBird peer spoof identity; policy must limit who can reach port 8080 |
| Request smuggling | Node strict HTTP parser, duplicate Host check, reject Transfer-Encoding with Content-Length, header ceiling, no insecure parser, hop-by-hop and nominated-header removal | Parser differences with upstream applications need continued differential testing |
| Upstream TLS impersonation | Verification is enabled by default; custom CA and SNI are supported; the HTTPS-only bypass is an explicit per-route switch with a visible warning and health-gated activation | When an administrator enables the bypass, any peer able to intercept or spoof that allowed destination can impersonate it; prefer a reviewed CA and restrict the path with NetBird policy |
| Malicious upstream / malformed HTML | Strict content eligibility, byte preservation, comment/raw-text-aware boundary scanning, ambiguity rejection, no browser rendering in server, bounded content, fail-to-original behavior | Injected arbitrary HTML is intentionally powerful and can break pages |
| Decompression bombs / oversized data | Compressed and decompressed ceilings, zlib output limit, streaming passthrough, request body ceiling | Candidate responses buffer up to the configured route ceiling and affect memory under concurrency |
| Binary, download, media, PDF, API mutation | Exact `text/html` requirement plus status/method/range/disposition/no-transform/path checks | Incorrect upstream `Content-Type` can misclassify content; keep injection limits and exclusions conservative |
| CSP weakening | Default skips any CSP response; explicit mode preserves the header unchanged; no rewrite feature | Explicit preserve mode may inject content that the browser blocks |
| Stored XSS in admin UI | No inline admin scripts, strict admin CSP, DOM `textContent`, escaped/static shell, JSON APIs | Browser/runtime vulnerabilities remain outside project control |
| Malicious pasted tracker markup | Umami paste is capped at 32 KiB/two tags; a dedicated non-DOM parser accepts only empty external scripts with `src`, `defer`, and `data-website-id`; quoted attributes, consistent IDs, credential-free HTTP(S), CSRF, and normal profile validation are required | A permitted tracker URL still supplies privileged third-party JavaScript to the destination origin |
| CSRF | SameSite=Strict session cookie plus per-session header token on every mutation | A compromised admin origin/session defeats CSRF controls |
| Brute-force login | Named local account, scrypt N=32768, per-address attempt window/block, loopback default, optional TOTP | In-memory limit resets on restart; SSH/firewall access should have its own rate limit |
| Remote admin interception/exposure | Remote mode permits only explicit private IPs, native TLS, Secure cookies, private client CIDRs, and no wildcard/public bind; setup prints the certificate fingerprint; installer, diagnostics, lifecycle, and sandbox health clients verify the configured certificate | Self-signed first use requires out-of-band fingerprint verification; firewall/NetBird policy remains mandatory |
| Session theft | HttpOnly, SameSite=Strict, short sliding expiry, in-memory invalidation; Secure required for remote admin; credential/2FA removal invalidates sessions | Loopback HTTP assumes a trusted local host and SSH tunnel |
| TOTP/recovery theft | Enrollment requires current password and verified code; secrets never logged; recovery codes shown once, stored hashed, consumed once, and replaceable | SQLite/backups contain the TOTP seed needed for verification; encrypt backups and restrict service/root access |
| Arbitrary script misuse | Persistent warning, explicit enablement, profile/route version history, preview, audit trail, no secret logging | This is an inherent product capability; administrator review is mandatory |
| Analytics/replay privacy misuse | Recorder is separately visible, requires a website ID, and the UI warns about masking, sampling, consent, and privacy review before activation | The injector cannot enforce the tracker operator's retention, masking, consent, or jurisdictional settings |
| Accidental deletion | Soft delete retains versions; confirmation in UI; backups; uninstall preserves data by default | Deleting an active route stops it immediately by design |
| Malicious import | 5 MiB limit, strict known-field schemas, collection/item/string/materialized-profile limits, duplicate and existing-ID rejection, URL/CIDR/port validation, all routes forced disabled drafts, transactional writes | Administrator must still inspect imported scripts before activation |
| NetBird token theft | Server-only token file, never stored in route DB, never sent to browser/log, read-only mode, write disabled | Root or service-account compromise exposes the token; use a least-privilege service user/PAT |
| Secrets in logs/backups | Structured logger drops sensitive field names; no headers/bodies; backup explicitly excludes token file; restrictive modes | Configuration backup contains password hash and may contain custom CA certificates; protect backup media |
| Unsafe update | Pre-update consistent backup, versioned release directory, atomic symlink, health check, automatic code rollback | Database migration rollback is only safe while migrations are backwards compatible; pre-1.0 migrations require review |
| Unsafe uninstall | Separate explicit purge switches; no NetBird lifecycle mutation; preservation default | Root can always override safeguards manually |
| Service compromise | Dedicated account, no capabilities, hardened systemd sandbox, no Docker socket, rootless container, read-only app files | Node runtime or application vulnerabilities may permit actions available to the service account and network policy |

## Abuse cases to test before production

- Duplicate and malformed Host, CL/TE disagreement, oversized headers, absolute-form URI, and `CONNECT`.
- DNS names changing from allowed to disallowed addresses.
- Mixed allowed/disallowed DNS answers (must reject).
- Malicious import with conflicting IDs, huge arrays/strings, credential-bearing URLs, unauthorized ports, and custom CAs.
- Trusted versus untrusted `X-NetBird-User`, `X-NetBird-Groups`, and XFF chains.
- Many concurrent compressed responses near the body ceiling.
- WebSocket and SSE connections across route activation and shutdown.
- Login limiter behavior behind the chosen SSH/private ingress.
