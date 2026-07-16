# Docker sandbox

The sandbox is a project-local simulation. It uses only fake credentials, reserved test hostnames, a fake NetBird API, fake HTTP/HTTPS upstreams, and a fake public edge. It is evidence for local behavior, not evidence that a real NetBird deployment is production-ready.

## Commands

```bash
npm run sandbox:build
npm run sandbox:up
npm run sandbox:status
npm run sandbox:test
npm run sandbox:logs
npm run soak:short
npm run sandbox:report
npm run sandbox:reset
npm run sandbox:down
npm run sandbox:destroy
```

`sandbox:test` runs the functional suite, restarts only the injector, waits for health, and repeats the suite. `sandbox:reset` destroys and recreates only the named project. `sandbox:destroy` removes only the `nim-injector-sandbox` Compose project, its named test networks, and its named test volume. Set `NIM_SANDBOX_PROJECT` only to a short lowercase project name when an isolated second instance is required.

The only host-published endpoint is the fake edge on `127.0.0.1:${NIM_SANDBOX_PORT:-18080}`. Application networks are internal, the Docker socket is never mounted, the injector runs as UID 10001 with a read-only filesystem and all capabilities dropped, and health checks replace fixed startup sleeps.

## Soak tests

The CI-safe run is 20 seconds at concurrency 8:

```bash
npm run soak:short
```

The staging soak is 24 hours at concurrency 16:

```bash
npm run soak:staging | tee soak-24h.json
```

The report includes requests, failures, status codes, latency, bytes, process memory/CPU, active resource types, proxy connections, WebSockets, injection outcomes, upstream errors, restarts, OOM state, container resources, categorized log errors, and log byte growth. Run `npm run sandbox:report` again after the workload for a final snapshot. A 24-hour run is still required on the intended disposable Linux/NetBird staging host.

## Safety

Never point sandbox routes at real services or add production tokens. If Docker is unavailable, the launcher fails with a direct error. Do not use broad Docker prune commands; the project scripts are the supported cleanup path.
