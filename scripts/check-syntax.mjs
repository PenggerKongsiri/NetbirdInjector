import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceRoots = process.argv.includes('--runtime') ? ['src', 'scripts'] : ['src', 'scripts', 'tools', 'test'];
const sourceExtensions = new Set(['.js', '.mjs']);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

for (const file of sourceRoots.flatMap(files).filter((path) => sourceExtensions.has(extname(path))).sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const file of ['package.json', 'package-lock.json', 'config/config.example.json', 'config/config.container.example.json']) {
  JSON.parse(readFileSync(file, 'utf8'));
}
