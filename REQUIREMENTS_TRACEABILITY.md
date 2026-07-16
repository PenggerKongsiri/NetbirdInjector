# Requirements traceability

Statuses describe the final local run. `EXTERNAL TEST REQUIRED` is not a local failure; it marks work that requires an authorized real environment.

| Requirement area | Status | Evidence / remaining gate |
|---|---|---|
| Resume existing tree; preserve architecture/untracked state | PASS | No reset/delete/rewrite; no Git mutation |
| Required architecture/threat/support review | PASS | Reviewed before code changes |
| Quick syntax/shutdown/full checks | PASS | Shutdown-focused test and repeated full `npm run check` |
| Exact Host/no default/open proxy | PASS | Integration and raw HTTP negative cases |
| HTTP/HTTPS, Host, SNI, normal/custom CA, invalid cert | PASS | Proxy/sandbox/TLS tests |
| Methods, query, cookies, redirects, upload/download/range | PASS | Proxy and sandbox functional tests |
| Chunking, 100-continue, WebSocket, SSE, streaming/timeouts/resets | PASS | Raw proxy and sandbox tests; bounded shutdown test |
| Forwarding trust/hop headers/request IDs | PASS | Trusted/untrusted integration tests |
| Request smuggling/Host confusion/CRLF/IDN | PASS | Strict parser raw-socket and canonicalization tests |
| SSRF/DNS rebinding/redirect SSRF/CIDR/ports | PASS | Dial-time policy and negative address tests; no server redirect following |
| XSS/CSRF/cookies/session/throttling/hash limits | PASS | Admin/API/security/UI static and real browser stored-XSS tests |
| Named admin, optional private-IP access, TLS/client CIDR gate | PASS | Config negatives and native HTTPS integration test; wildcard/public/HTTP remote modes fail closed |
| Account Settings, TOTP, recovery codes, session invalidation | PASS | Security unit, admin integration, static UI, and browser Settings smoke |
| Root administrator lockout recovery | PASS (mocked) | Pre-reset backup, credential replacement, 2FA disable, restart, and health gate in lifecycle container |
| Prototype pollution/import/path/command/temp/secret/backup safety | PASS | Strict schemas, bounded transactional import, fixed commands/paths, manifest scans, backup tests |
| Installer boundaries/update rollback/uninstall preservation | PASS (mocked) | Docker lifecycle pass; actual systemd external |
| General injection types/locations/order/scopes/profiles/duplicates | PASS | Unit/integration and interactive browser profile/preview workflow |
| HTML edge corpus, size boundaries, compression bombs/unsupported encoding | PASS | Deterministic/fuzz/integration tests |
| Non-HTML/download/range/WS/SSE/stream preservation | PASS | Unit/integration/sandbox tests |
| Transformed vs skipped response metadata | PASS | Header-decision regressions |
| Enforcing vs report-only CSP; no weakening | PASS | Unit/proxy tests and threat documentation |
| Safe sandbox commands/isolation/repetition/Docker-unavailable behavior | PASS | Project launcher, Compose config, clean repeated cycle |
| Clean sandbox normal + injector restart repeat | PASS | Both functional runs passed |
| Short soak and resource/log review | PASS | 13,627 requests, zero failures/restarts/OOM/fatal/database/secret findings |
| 24-hour soak command and observability | PASS (command/report) | `npm run soak:staging`; actual duration NOT TESTED |
| First-run/login/logout/invalid/throttle/dashboard | PASS | Mocked install, browser, API/security tests |
| Route render/create/edit/clone/manual/peer select | PASS | Extended in-app browser plus reproducible clone browser smoke |
| Profile create/edit/attach/order/preview | PASS | Extended in-app browser plus injection tests |
| Newest activation/enable/disable/exact rollback | PASS | Browser/admin/store transaction tests |
| Import/export/delete confirmation | PASS | Admin integration plus browser confirmed soft delete |
| Stored-XSS escaping/mobile/keyboard | PASS | Reproducible Playwright smoke and static UI guard |
| Fresh/repeat install, user/dirs/modes/DB/service/health | PASS (mocked) | Debian container lifecycle |
| Reconfigure/status/doctor/repair/backup/restore | PASS (mocked) | Debian container lifecycle |
| Verified update/tamper/failed update/manual rollback | PASS (mocked) | Manifest rejection and health-failure rollback lifecycle |
| Stop/restart/preserving uninstall/reinstall/full purge | PASS (mocked) | Debian container lifecycle |
| Shell parse/ShellCheck | PASS | ShellCheck exit 0 |
| Actual systemd unit/start/reboot | NOT TESTED | Disposable Ubuntu gate |
| amd64 release/container | PASS (build) | Final OCI artifact built |
| arm64 release/container | PASS (build + emulated run) | Node arm64 runtime UID 10001; physical hardware external |
| Runtime manifest/checksum/tamper/exact archive | PASS | 63 files, SHA-256, extracted re-verification, forbidden scan |
| npm package content | PASS | 62-entry dry run; no tests/tools/key/generated state |
| CI least privilege/clean install/test/browser/sandbox/lifecycle/release/arch/audit | PASS (definition) | Immutable pins and actionlint; actual GitHub run NOT TESTED |
| Automatic publishing prohibited | PASS | No publish/release/container push action |
| Required documentation/deployment bundle | PASS | All requested focused documents, templates, unit, commands, verification/log scripts |
| Sandbox cleanup | PASS | No named containers, networks, or volume remain |
| Real NetBird API/policy/service/domain/Coolify | EXTERNAL TEST REQUIRED | Explicitly not accessed |
| Public-CA/backend production combination | EXTERNAL TEST REQUIRED | Test-domain gate |
| Independent external security review | EXTERNAL TEST REQUIRED | Local security review complete; separate reviewer still recommended |
| Immediate production cutover | EXTERNAL TEST REQUIRED — NO | Real staging and test-domain proof incomplete |

## Final decision

```text
Ready to commit: YES
Ready to push to GitHub: YES
Ready for controlled Ubuntu/NetBird staging: YES
Ready for real NetBird test-domain validation: YES
Ready for immediate production cutover: NO
```
