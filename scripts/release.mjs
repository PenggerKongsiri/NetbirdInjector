import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RUNTIME_ENTRIES = Object.freeze([
  'src', 'scripts', 'packaging', 'docs', 'config', 'package.json', 'package-lock.json', 'README.md', 'LICENSE',
  'SECURITY.md', 'CONTRIBUTING.md', 'AGENTS.md', 'Containerfile', 'compose.example.yaml', 'setup',
  'bootstrap-ubuntu.sh',
]);

const FORBIDDEN_BASENAMES = new Set(['.env', 'state.db', 'state.db-wal', 'state.db-shm']);
const FORBIDDEN_SEGMENTS = new Set(['node_modules', 'coverage', 'backups', 'test-results']);
const TEXT_EXTENSIONS = new Set(['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.service', '.sh', '.txt', '.yaml', '.yml']);
const MACHINE_PATH_PATTERN = new RegExp([
  'C:\\\\' + 'Users\\\\[^\\\\\\r\\n]+',
  '/' + 'Users/[^/\\r\\n]+',
  '/' + 'home/(?!<)[^/\\s]+',
  'Se' + 'afile',
].join('|'), 'i');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function extension(path) {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
}

function inspectFile(path, root) {
  const name = relative(root, path).split(sep).join('/');
  const segments = name.split('/');
  if (FORBIDDEN_BASENAMES.has(basename(path).toLowerCase()) || segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    throw new Error(`release contains forbidden generated or sensitive path: ${name}`);
  }
  if (/\.db(?:-wal|-shm)?$|\.log$|\.env(?:\.|$)|(?:^|[-_.])key\.pem$/i.test(name)) throw new Error(`release contains forbidden file: ${name}`);
  if (!TEXT_EXTENSIONS.has(extension(path)) || statSync(path).size > 5_242_880) return;
  const value = readFileSync(path, 'utf8');
  if (/-----BEGIN [^-\r\n]*PRIVATE KEY-----/.test(value)) throw new Error(`release contains private key material: ${name}`);
  if (MACHINE_PATH_PATTERN.test(value)) throw new Error(`release contains a machine-specific path: ${name}`);
}

function manifestFor(root) {
  const result = {};
  for (const path of files(root).sort()) {
    const name = relative(root, path).split(sep).join('/');
    if (name === 'RELEASE_MANIFEST.json') continue;
    inspectFile(path, root);
    result[name] = { sha256: sha256(path), bytes: statSync(path).size };
  }
  return result;
}

export function verifyRuntime(rootArg) {
  const root = resolve(rootArg);
  const manifestPath = join(root, 'RELEASE_MANIFEST.json');
  if (!existsSync(manifestPath)) throw new Error('release manifest is missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'netbird-injector-manager-release' || manifest.version !== 1 || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('release manifest is invalid or unsupported');
  }
  const actualNames = files(root).map((path) => relative(root, path).split(sep).join('/')).filter((name) => name !== 'RELEASE_MANIFEST.json').sort();
  const expectedNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error('release file list does not match its manifest');
  for (const name of expectedNames) {
    if (name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new Error(`unsafe release manifest path: ${name}`);
    const path = join(root, ...name.split('/'));
    inspectFile(path, root);
    const expected = manifest.files[name];
    if (sha256(path) !== expected.sha256 || statSync(path).size !== expected.bytes) throw new Error(`release checksum mismatch: ${name}`);
  }
  for (const required of ['src/main.mjs', 'setup', 'bootstrap-ubuntu.sh', 'packaging/netbird-injector-manager.service', 'config/config.example.json', 'LICENSE']) {
    if (!Object.hasOwn(manifest.files, required)) throw new Error(`release is missing required file: ${required}`);
  }
  return { root, fileCount: expectedNames.length, manifest };
}

export function buildRuntime(sourceArg, outputArg) {
  const source = resolve(sourceArg);
  const output = resolve(outputArg);
  if (output === source || source.startsWith(`${output}${sep}`)) throw new Error('release output must not contain the source repository');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true, mode: 0o755 });
  for (const entry of RUNTIME_ENTRIES) {
    const from = join(source, entry);
    if (!existsSync(from)) throw new Error(`runtime source entry is missing: ${entry}`);
    cpSync(from, join(output, entry), { recursive: true, errorOnExist: true, force: false });
  }
  const packageData = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const manifest = {
    format: 'netbird-injector-manager-release', version: 1, packageVersion: packageData.version,
    files: manifestFor(output),
  };
  writeFileSync(join(output, 'RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return verifyRuntime(output);
}

function buildArchive() {
  const source = process.cwd();
  const releaseRoot = resolve(source, 'dist', 'release');
  if (!releaseRoot.startsWith(`${source}${sep}`)) throw new Error('release output escaped the repository');
  const packageData = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const directory = join(releaseRoot, 'netbird-injector-manager');
  mkdirSync(dirname(directory), { recursive: true });
  const result = buildRuntime(source, directory);
  const archiveName = `netbird-injector-manager-v${packageData.version}.tar.gz`;
  const archivePath = join(releaseRoot, archiveName);
  const tar = spawnSync('tar', ['-czf', archivePath, '-C', releaseRoot, 'netbird-injector-manager'], { stdio: 'inherit', windowsHide: true });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error(`tar failed with status ${tar.status}`);
  writeFileSync(join(releaseRoot, 'SHA256SUMS'), `${sha256(archivePath)}  ${archiveName}\n`, { mode: 0o644 });
  process.stdout.write(`${archivePath}\n${result.fileCount} runtime files verified\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [command = 'help', path = '.'] = process.argv.slice(2);
  if (command === 'build') buildArchive();
  else if (command === 'verify') {
    const result = verifyRuntime(path);
    process.stdout.write(`${result.root}: ${result.fileCount} runtime files verified\n`);
  } else {
    process.stderr.write('usage: release.mjs build | verify RELEASE_DIRECTORY\n');
    process.exitCode = 2;
  }
}
