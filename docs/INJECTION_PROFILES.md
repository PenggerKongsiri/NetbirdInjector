# Injection profiles

Profiles are reusable, revisioned groups of injection items. An activated route stores a materialized snapshot, so later profile edits do not silently change live traffic and exact rollback remains possible.

Supported items are external JavaScript, inline JavaScript, external stylesheets, inline CSS, meta tags, approved custom HTML, and structured Umami analytics/recorder configuration. Each item has a stable ID, enabled state, insertion location, numeric priority, optional hostname/path conditions, duplicate detection, and notes.

## Simple UI and Advanced mode

The default UI does not require JSON. **Sites** shows the request path from the NetBird HTTP service through this Injector VM to each configured peer. A site editor asks for the exact public hostname, destination peer/IP/DNS name, HTTP or HTTPS, and port. Reusable injections are selected with checkboxes, and direct items can be added as an external script URL, inline JavaScript, or an HTML block/card.

Saving creates only a disabled draft. The destination test must pass before the separate activation action can switch traffic. Existing active traffic and unrelated routes are unchanged while editing or testing.

**Advanced mode** reveals raw IDs and profile JSON, upstream Host and TLS SNI overrides, TLS and custom-CA fields, health checks, timeouts and size ceilings, path scopes, CSP behavior, import/export, Preview, and Audit. The switch changes presentation only; the same server-side schema, CIDR/port authorization, health gate, and transaction rules apply in both modes.

## Paste an Umami profile

Paste the code supplied by Umami into **Injections -> Add Umami**, for example:

```html
<script defer src="https://analytics.example/script.js" data-website-id="site-id-from-umami"></script>
<script defer src="https://analytics.example/recorder.js" data-website-id="site-id-from-umami"></script>
```

The server parses this as data; it does not insert it into the admin page or execute it. The paste is limited to 32 KiB and at most two empty external `<script>` tags. Every tag must have a quoted, credential-free HTTP(S) `src` and the same `data-website-id`; `defer` is the only other accepted attribute. Inline JavaScript, other markup, event handlers, duplicate/unknown attributes, mismatched IDs, and multiple analytics or recorder tags fail closed. The UI shows the extracted values before saving.

Use HTTPS tracker URLs for HTTPS sites. HTTP is accepted for deliberately local HTTP applications, but browsers normally block an HTTP script on an HTTPS page as mixed content. This structured helper intentionally rejects additional Umami attributes it cannot preserve; use the reviewed advanced custom-profile editor only when those attributes are required.

The recorder tag also receives the website ID. Session replay can capture visitor interactions, so configure Umami masking/block selectors and sampling, review consent and privacy obligations, and test on a non-production hostname before enabling Recorder. An older recorder-only profile created before v0.2.0 without a website ID must be edited or recreated before it can pass current validation.

## Direct scripts and HTML cards

The simple site editor stores external scripts, inline JavaScript, and HTML blocks as normal injection items; JSON is only an advanced representation. Choose whether the item belongs at the end of `<head>`, the start of `<body>`, or the end of `<body>`. Each item remains in the draft until the route is tested and activated.

The simple HTML editor rejects `<script>` elements so code is entered through the clearly labeled JavaScript type. It is not a sanitizer or a visual page builder: trusted HTML may still contain dangerous behavior, and both HTML and JavaScript run with the destination origin's privileges. The admin UI renders item summaries as text and never runs them. A destination site's CSP may intentionally block the injected content; this project never weakens that policy.

## Safe workflow

1. Create a profile with one owner and purpose.
2. Use lower priorities for content that must appear first; ties are resolved deterministically by stable identity.
3. Prefer external resources with integrity, crossorigin, and referrer policy where applicable.
4. Scope hostnames and paths narrowly and keep API/download/event paths excluded at the route level.
5. Attach the profile to a disabled draft and use Preview against representative HTML and CSP headers.
6. Test the candidate route, then activate atomically.
7. Verify page behavior and browser console/network outcomes without collecting visitor data.

Insertion locations are the end of `<head>`, after the opening `<body>`, and before the closing `<body>`. If a safe unambiguous insertion point does not exist, the original body is preserved. The parser ignores apparent tags inside comments, script strings, and style content. Duplicate manager markers, equivalent script URLs, and configured literal content prevent repeat injection.

Enforcing CSP skips injection by default. Report-only CSP produces a warning but does not block modification. The application never weakens either header. Inline content can remain blocked by the application's policy; changing CSP is a separate application security decision.

Umami is only a structured profile type. Unrelated custom scripts and styles continue to work independently. Treat every enabled item as privileged code execution in the destination origin.
