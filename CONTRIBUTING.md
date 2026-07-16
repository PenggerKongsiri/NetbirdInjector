# Contributing

## Development

Use Node.js 24.18.0 or the pinned CI version. The runtime has no npm dependencies.

```bash
npm run check
npm run test:coverage
```

Changes to routing, headers, CIDR parsing, TLS, compression, injection eligibility, imports, authentication, persistence, installer behavior, or logging are security-sensitive. Add adversarial tests and update the threat model/support matrix.

## Pull requests

- Keep scope small and explain the trust-boundary impact.
- Do not weaken defaults to make a test pass.
- Never add real credentials, domains, peer addresses, page bodies, production logs, or backups.
- Preserve unknown-host fail-closed behavior and data-plane independence from NetBird API.
- Add migration logic that is transactional and backwards compatible with the immediately previous release.
- Include exact test commands/results and identify environments not tested.
- Do not publish releases or alter live infrastructure from CI.

Use the Apache-2.0 license for contributions and certify that you have the right to submit them.
