import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('./sandbox/compose.yaml', import.meta.url));
const project = process.env.NIM_SANDBOX_PROJECT || 'nim-injector-sandbox';
if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(project)) throw new Error('NIM_SANDBOX_PROJECT must be a short lowercase Docker Compose project name');
const context = process.env.NIM_DOCKER_CONTEXT || (process.platform === 'win32' ? 'desktop-linux' : '');
const enginePrefix = context ? ['--context', context] : [];
const prefix = [...(context ? ['--context', context] : []), 'compose', '-p', project, '-f', composeFile];

function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', [...prefix, ...args], { encoding: capture ? 'utf8' : undefined, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Docker is unavailable: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error(capture ? result.stderr.trim() : `docker compose failed with status ${result.status}`);
  return result;
}

function engine(args, { capture = false } = {}) {
  const result = spawnSync('docker', [...enginePrefix, ...args], { encoding: capture ? 'utf8' : undefined, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Docker is unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(capture ? result.stderr.trim() : `docker failed with status ${result.status}`);
  return result;
}

function reportEvidence() {
  const ids = docker(['ps', '-q'], { capture: true }).stdout.trim().split(/\s+/).filter(Boolean);
  const containers = ids.map((containerId) => JSON.parse(engine(['inspect', '--format', '{{json .}}', containerId], { capture: true }).stdout));
  const states = containers.map((container) => ({
    name: container.Name.replace(/^\//, ''), status: container.State.Status, health: container.State.Health?.Status ?? null,
    restartCount: container.RestartCount, oomKilled: container.State.OOMKilled,
  }));
  const stats = ids.length ? engine(['stats', '--no-stream', '--format', '{{json .}}', ...ids], { capture: true }).stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const logs = docker(['logs', '--no-color'], { capture: true }).stdout;
  const count = (pattern) => (logs.match(pattern) ?? []).length;
  process.stdout.write(`${JSON.stringify({
    sandboxEvidence: {
      states,
      resources: stats.map((entry) => ({ name: entry.Name, cpu: entry.CPUPerc, memory: entry.MemUsage, pids: entry.PIDs, network: entry.NetIO })),
      logs: {
        bytes: Buffer.byteLength(logs), injectionWarnings: count(/proxy\.injection_skipped/g), upstreamErrors: count(/proxy\.upstream_error/g),
        databaseErrors: count(/database|SQLITE_/gi), fatalErrors: count(/service\.fatal|service\.start_failed/g),
        suspectedSecretLeaks: count(/authorization|cookie|netbird[_ -]?token|password\s*[=:]/gi),
      },
    },
  }, null, 2)}\n`);
}

function waitHealthy() { docker(['up', '-d', '--wait', '--wait-timeout', '120']); }
function buildAll() { docker(['--profile', 'test', 'build']); }
function buildClient() { docker(['--profile', 'test', 'build', 'client']); }
function runTest(extra = []) { docker(['run', '--rm', 'client', 'node', 'tools/sandbox/test.mjs', ...extra]); }

const [command = 'help', ...extra] = process.argv.slice(2);
if (command === 'build') buildAll();
else if (command === 'up') { buildAll(); waitHealthy(); }
else if (command === 'status') docker(['ps', '--all']);
else if (command === 'logs') docker(['logs', '--no-color', '--tail', extra[0] || '200']);
else if (command === 'test') { buildClient(); waitHealthy(); runTest(); docker(['restart', 'injector']); waitHealthy(); runTest(['--after-restart']); }
else if (command === 'soak') { buildClient(); waitHealthy(); docker(['run', '--rm', 'client', 'node', 'tools/sandbox/soak.mjs', ...extra]); reportEvidence(); }
else if (command === 'report') reportEvidence();
else if (command === 'reset') { docker(['down', '--volumes', '--remove-orphans']); buildAll(); waitHealthy(); }
else if (command === 'down') docker(['down', '--remove-orphans']);
else if (command === 'destroy') docker(['down', '--volumes', '--remove-orphans']);
else {
  process.stdout.write('usage: node tools/sandbox.mjs {build|up|status|test|logs [LINES]|soak [--duration-seconds N --concurrency N]|report|reset|down|destroy}\n');
  if (command !== 'help') process.exitCode = 2;
}
