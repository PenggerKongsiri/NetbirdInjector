# Security policy

## Supported versions

No production-supported release exists yet. Security fixes target the latest `main` and most recent pre-1.0 tag. The project will publish a supported-version table before 1.0.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use the repository host's private security advisory feature and include:

- affected commit/version and deployment shape;
- impact and prerequisites;
- minimal reproduction using fake credentials/upstreams;
- whether data or credentials may already be exposed;
- suggested remediation, if known.

Do not test against systems you do not own or have explicit permission to assess. Do not include real NetBird tokens, cookies, Authorization headers, page bodies, or visitor data.

Acknowledgement is targeted within three business days. Severity, embargo, patch, tests, release notes, and coordinated disclosure timing will be agreed with the reporter. No bounty is currently offered.

## Operator security requirements

Keep admin loopback-only with SSH forwarding whenever practical. If private remote administration is required, use only the native HTTPS explicit-private-IP mode, narrow `admin.allowedCidrs`, a matching firewall/NetBird policy, verified certificate fingerprint, and authenticator 2FA. Never expose TCP 9090 publicly. Keep upstream TLS verification enabled, use a least-privilege service-user PAT, encrypt backups, and treat every injected snippet as third-party code executing in a trusted browser origin. See [the threat model](docs/THREAT_MODEL.md) and [admin security guide](docs/ADMIN_ACCESS.md).
