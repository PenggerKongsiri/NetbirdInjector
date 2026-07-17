import { spawnSync } from 'node:child_process';

const allowedPrivateKeyPaths = new Set(['test/fixtures/tls/server-key.pem', 'test/store.test.mjs']);
const forbiddenBasenames = new Set(['.env', 'state.db', 'state.db-wal', 'state.db-shm']);
const machinePathPattern = new RegExp([
  'C:' + '\\\\' + 'Users' + '\\\\' + '[^\\\\\r\n]+',
  '/' + 'Users/[^/\r\n]+',
  '/' + 'home/(?!<)[^/\\s]+',
  'Se' + 'afile',
].join('|'), 'i');
const tokenPattern = new RegExp([
  'gh' + 'p_[A-Za-z0-9]{30,}',
  'github_' + 'pat_[A-Za-z0-9_]{40,}',
  'nb' + 'p_[A-Za-z0-9_-]{24,}',
  'AKIA[0-9A-Z]{16}',
  'xox[baprs]-[A-Za-z0-9-]{20,}',
].join('|'));
const privateKeyPattern = new RegExp('-----BEGIN ' + '[^-\\r\\n]*PRIVATE KEY-----');

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: options.binary ? undefined : 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error) throw new Error(`git is unavailable: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}

const pathsByObject = new Map();
// Scan public Git refs, excluding local tool/checkpoint refs that are never pushed to the repository.
for (const line of git(['rev-list', '--objects', '--branches', '--tags', '--remotes']).split(/\r?\n/).filter(Boolean)) {
  const separator = line.indexOf(' ');
  const object = separator === -1 ? line : line.slice(0, separator);
  const path = separator === -1 ? '' : line.slice(separator + 1).replaceAll('\\', '/');
  if (!pathsByObject.has(object)) pathsByObject.set(object, new Set());
  if (path) pathsByObject.get(object).add(path);
}

let inspected = 0;
for (const [object, paths] of pathsByObject) {
  if (git(['cat-file', '-t', object]).trim() !== 'blob') continue;
  const size = Number(git(['cat-file', '-s', object]).trim());
  if (!Number.isSafeInteger(size) || size > 5_242_880) throw new Error(`Git history contains an oversized or invalid blob: ${[...paths].join(', ') || object}`);
  for (const path of paths) {
    const basename = path.split('/').at(-1).toLowerCase();
    if (forbiddenBasenames.has(basename) || (basename.startsWith('.env.') && !basename.endsWith('.example')) || /\.db(?:-wal|-shm)?$|\.log$/i.test(path)) {
      throw new Error(`Git history contains a forbidden sensitive/generated path: ${path}`);
    }
  }
  const buffer = git(['cat-file', 'blob', object], { binary: true });
  if (buffer.includes(0)) continue;
  inspected += 1;
  const value = buffer.toString('utf8');
  const names = [...paths];
  if (privateKeyPattern.test(value) && (!names.length || names.some((path) => !allowedPrivateKeyPaths.has(path)))) {
    throw new Error(`Git history contains unexpected private key material: ${names.join(', ') || object}`);
  }
  if (machinePathPattern.test(value)) throw new Error(`Git history contains a machine-specific path: ${names.join(', ') || object}`);
  if (tokenPattern.test(value)) throw new Error(`Git history contains a token-shaped secret: ${names.join(', ') || object}`);
}

process.stdout.write(`${inspected} unique historical text blobs passed secret, private-key, generated-path, and machine-path scanning\n`);
