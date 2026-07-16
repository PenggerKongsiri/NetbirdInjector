import http from 'node:http';
import https from 'node:https';

const numberArg = (name, fallback) => { const index = process.argv.indexOf(name); const value = index >= 0 ? Number(process.argv[index + 1]) : fallback; if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`); return value; };
const durationSeconds = numberArg('--duration-seconds', 20);
const concurrency = Math.floor(numberArg('--concurrency', 8));
const deadline = Date.now() + durationSeconds * 1000;
const cases = [
  ['html.test.invalid', '/html', 'GET', null], ['html.test.invalid', '/gzip', 'GET', null], ['api.test.invalid', '/json', 'GET', null],
  ['api.test.invalid', '/echo', 'POST', Buffer.alloc(4096, 0x61)], ['files.test.invalid', '/large', 'GET', null], ['files.test.invalid', '/range', 'GET', null],
  ['sse.test.invalid', '/sse', 'GET', null],
];
const metrics = { startedAt: new Date().toISOString(), durationSeconds, concurrency, totalRequests: 0, failures: 0, codes: {}, latencyMs: { min: Infinity, max: 0, sum: 0 }, bytes: 0 };

function adminCall(path, { method = 'GET', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { connection: 'close' };
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
    if (cookie) headers.cookie = cookie;
    const req = https.request({ hostname: '172.30.250.10', port: 9090, path, method, headers, rejectUnauthorized: false, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.setTimeout(5000, () => req.destroy(new Error('admin request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const login = await adminCall('/api/login', { method: 'POST', body: { username: 'admin', password: 'sandbox-admin-password-only' } });
if (login.status !== 200) throw new Error('sandbox admin login failed');
const cookie = login.headers['set-cookie'][0].split(';')[0];
const runtimeSnapshot = async () => {
  const response = await adminCall('/api/status', { cookie });
  const body = response.json();
  if (response.status !== 200 || !body.runtime?.proxy || !body.runtime?.memory || !body.runtime?.cpu || !body.runtime?.activeResources) {
    throw new Error(`sandbox runtime status is unavailable: HTTP ${response.status} ${body.error ?? 'invalid response'}`);
  }
  return body.runtime;
};
metrics.runtimeBefore = await runtimeSnapshot();

function one(index) {
  const [host, path, method, body] = cases[index % cases.length];
  const started = performance.now();
  return new Promise((resolve) => {
    const headers = { host, connection: 'close' };
    if (body) headers['content-length'] = body.length;
    if (path === '/range') headers.range = 'bytes=2-5';
    const req = http.request({ hostname: 'fake-public-proxy', port: 8080, path, method, headers, agent: false }, (res) => {
      let bytes = 0; res.on('data', (chunk) => { bytes += chunk.length; }); res.on('end', () => {
        const latency = performance.now() - started; metrics.totalRequests += 1; metrics.codes[res.statusCode] = (metrics.codes[res.statusCode] ?? 0) + 1; metrics.bytes += bytes;
        metrics.latencyMs.min = Math.min(metrics.latencyMs.min, latency); metrics.latencyMs.max = Math.max(metrics.latencyMs.max, latency); metrics.latencyMs.sum += latency; if (res.statusCode >= 500) metrics.failures += 1; resolve();
      }); res.on('error', () => { metrics.totalRequests += 1; metrics.failures += 1; resolve(); });
    });
    req.setTimeout(5000, () => req.destroy()); req.on('error', () => { metrics.totalRequests += 1; metrics.failures += 1; resolve(); }); if (body) req.write(body); req.end();
  });
}

await Promise.all(Array.from({ length: concurrency }, async (_, worker) => { let index = worker; while (Date.now() < deadline) { await one(index); index += concurrency; } }));
metrics.finishedAt = new Date().toISOString();
metrics.runtimeAfter = await runtimeSnapshot();
metrics.latencyMs.average = metrics.totalRequests ? metrics.latencyMs.sum / metrics.totalRequests : 0;
delete metrics.latencyMs.sum;
if (metrics.latencyMs.min === Infinity) metrics.latencyMs.min = 0;
process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
if (metrics.failures) process.exitCode = 1;
