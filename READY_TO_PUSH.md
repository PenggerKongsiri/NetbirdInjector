# Ready to push

## Decision

- Ready to commit: **YES — PASS**
- Ready to push to GitHub: **YES — PASS**
- Commit/stage/push performed: **NO**

## First-commit checklist

- [x] No known failing local test, browser smoke, ShellCheck, workflow lint, lifecycle mock, release verification, audit, package inspection, or final sandbox check.
- [x] Guided setup creates a named administrator and offers loopback/SSH or explicit-private-IP HTTPS; remote mode has native TLS, Secure cookies, and a private client-CIDR gate.
- [x] Account Settings provides password/username changes, TOTP 2FA, single-use recovery codes, and root-only lockout recovery is backup- and health-gated.
- [x] No generated database, session, log, backup, coverage, browser trace, `.env`, credentials, or `node_modules` is eligible for Git.
- [x] The one test TLS private key is isolated under `test/fixtures/` and is excluded from runtime release and npm package.
- [x] Repository scanning rejects any other private key, token-shaped secret, environment file, or machine-specific user path.
- [x] Release and CI workflows use read-only default permissions, immutable action revisions, clean installs, and no production secrets.
- [x] No workflow publishes a package, image, or GitHub release. Tag/manual runs create validation artifacts only.
- [x] Apache-2.0 license, security policy, contribution guidance, architecture, threat model, install/lifecycle, sandbox, migration, and external-gate docs are present.
- [x] Real NetBird staging remains an explicit external gate; no production-ready claim is made.

## Reviewer commands

Run from the repository root:

```bash
npm ci --ignore-scripts
npm audit --audit-level=high
npm run check
npm run test:coverage
npx playwright install chromium
npm run browser:test
npm run release:build
npm run release:inspect
npm pack --dry-run --json
```

On Linux with Docker, also run:

```bash
npm run lifecycle:test
npm run sandbox:reset
npm run sandbox:test
npm run soak:short
npm run sandbox:destroy
```

## Git state

The repository intentionally has no commits. All project files therefore appear as untracked (`??`) rather than as a normal diff. Generated `dist/`, `node_modules/`, databases, logs, and local config are ignored. Review everything before the first commit. No `git add`, commit, branch, push, tag, or release operation has been performed.
