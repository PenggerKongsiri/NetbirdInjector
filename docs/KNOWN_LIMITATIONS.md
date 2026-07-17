# Known limitations

- The project is pre-1.0 and remains experimental until a real disposable Ubuntu/NetBird test-domain deployment is recorded.
- Real NetBird Reverse Proxy, peer/API, policy, certificate, identity-header, and BYOP combinations are not proven by the fake sandbox.
- No real systemd boot or machine reboot has been tested in this repository run; container lifecycle uses a mocked service manager.
- Local arm64 evidence, when recorded, is QEMU emulation rather than physical arm64 hardware.
- The 24-hour staging soak is provided but is not run during ordinary CI or this review session.
- Only HTTP/1.1 downstream is implemented. CONNECT and arbitrary upgrades are rejected; WebSocket is the supported upgrade.
- No server-side redirects are followed. Client redirects are passed through.
- CSP is never weakened. Pages with enforcing CSP skip by default; inline content may remain blocked under preserve mode.
- HTML transformation is bounded and conservative, not a browser-grade DOM rewrite. Ambiguous, malformed, oversized, unsupported, streaming, range, download, and non-HTML responses pass through where possible.
- The simple HTML/card editor is a trusted-operator input, not a sanitizer or WYSIWYG page builder. Arbitrary injected HTML and JavaScript execute with the destination origin's privileges.
- Umami paste-and-extract intentionally recognizes only one analytics tag and one optional `/recorder.js` tag using `src`, `defer`, and `data-website-id`. Other tracker attributes require reviewed advanced configuration rather than being silently dropped.
- Sessions are in memory, so administrator sessions end on restart. Route/profile state is persisted in SQLite.
- NetBird API access is optional read-only discovery; service creation, policy changes, DNS, and certificate management are manual external operations.
- Native lifecycle currently targets Node 24.15 through 24.x on systemd Linux. Other init systems are unsupported.

See [SUPPORT_MATRIX.md](SUPPORT_MATRIX.md) for the evidence level of specific combinations.
