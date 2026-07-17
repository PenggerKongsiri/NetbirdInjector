import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const excluded = new Set(['.git', 'node_modules', 'coverage', 'dist', 'test-results']);
const allowedPrivateKeys = new Set(['test/fixtures/tls/server-key.pem', 'test/store.test.mjs']);
const textExtensions = new Set(['', '.css', '.html', '.js', '.json', '.md', '.mjs', '.service', '.sh', '.txt', '.yaml', '.yml']);
const machinePathPattern = new RegExp([
  'C:' + '\\\\' + 'Users' + '\\\\' + '[^\\\\\r\n]+',
  '/' + 'Users/[^/\r\n]+',
  '/' + 'home/(?!<)[^/\\s]+',
  'Se' + 'afile',
].join('|'), 'i');
const secretPrefixPattern = new RegExp(['gh' + 'p_[A-Za-z0-9]{30,}', 'github_' + 'pat_[A-Za-z0-9_]{40,}', 'nb' + 'p_[A-Za-z0-9_-]{24,}'].join('|'));
const privateKeyPattern = new RegExp('-----BEGIN ' + '[^-\\r\\n]*PRIVATE KEY-----');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`repository contains an unexpected symlink: ${relative(root, path)}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}

let inspected = 0;
for (const path of files(root)) {
  const name = relative(root, path).split(sep).join('/');
  const lowerBase = basename(path).toLowerCase();
  if (lowerBase === '.env' || (lowerBase.startsWith('.env.') && !lowerBase.endsWith('.example'))) throw new Error(`repository contains an environment file: ${name}`);
  if (!textExtensions.has(extname(path).toLowerCase()) || statSync(path).size > 5_242_880) continue;
  inspected += 1;
  const value = readFileSync(path, 'utf8');
  if (privateKeyPattern.test(value) && !allowedPrivateKeys.has(name)) throw new Error(`repository contains unexpected private key material: ${name}`);
  if (machinePathPattern.test(value)) throw new Error(`repository contains a machine-specific path: ${name}`);
  if (secretPrefixPattern.test(value)) throw new Error(`repository contains a token-shaped secret: ${name}`);
}
process.stdout.write(`${inspected} repository text files passed secret and machine-path scanning; the public test TLS key and fake negative-test key markers are explicitly allowlisted\n`);
