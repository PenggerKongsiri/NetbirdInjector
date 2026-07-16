# Injection profiles

Profiles are reusable, revisioned groups of injection items. An activated route stores a materialized snapshot, so later profile edits do not silently change live traffic and exact rollback remains possible.

Supported items are external JavaScript, inline JavaScript, external stylesheets, inline CSS, meta tags, approved custom HTML, and structured Umami analytics/recorder configuration. Each item has a stable ID, enabled state, insertion location, numeric priority, optional hostname/path conditions, duplicate detection, and notes.

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
