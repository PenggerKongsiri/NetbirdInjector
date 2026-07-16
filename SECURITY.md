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

## Public repository and installer trust

Before changing repository visibility to public, run `npm run check` from a full clone and confirm the current-tree and Git-history audits pass. The repository intentionally contains one public test-only TLS private key under `test/fixtures/tls`; it is not trusted by production code and must never be reused. No production credential, domain, database, backup, `.env` file, or machine-specific path belongs anywhere in Git history.

The one-command installer is a convenience boundary, not an independent signature authority. `curl | bash` trusts the repository owner, the served `main` script, GitHub, DNS, and TLS. The entry script narrows the remaining operation to one immutable commit, validates archive layout/types, and prints the archive SHA-256 before the reviewed bootstrap runs. Operators requiring stronger provenance should download and review the script first and install only a tagged release whose checksum they verified through a separate trusted channel.
