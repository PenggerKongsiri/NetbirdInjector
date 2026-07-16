import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { PASSWORD_HASH_PATTERN } from '../src/lib/security.mjs';

const placeholder = 'REPLACE_WITH_SCRIPTS_HASH_PASSWORD_OUTPUT';
const validationHash = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
if (!PASSWORD_HASH_PATTERN.test(validationHash)) throw new Error('internal example validation hash is malformed');

for (const name of ['config/config.example.json', 'config/config.container.example.json']) {
  const path = resolve(name);
  const source = readFileSync(path, 'utf8');
  if (!source.includes(placeholder)) throw new Error(`${name} must retain its password placeholder`);
  const parsed = JSON.parse(source.replace(placeholder, validationHash));
  validateConfig(parsed, dirname(path));
  process.stdout.write(`${name}: valid with placeholder substituted\n`);
}
