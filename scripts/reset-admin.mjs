import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { normalizeAdminUsername, PASSWORD_HASH_PATTERN } from '../src/lib/security.mjs';
import { Store } from '../src/lib/store.mjs';

const [configArgument, usernameArgument, passwordHash] = process.argv.slice(2);
if (!configArgument || !usernameArgument || !passwordHash) {
  process.stderr.write('usage: reset-admin.mjs CONFIG USERNAME PASSWORD_HASH\n');
  process.exit(2);
}
if (!PASSWORD_HASH_PATTERN.test(passwordHash)) throw new Error('administrator password hash is invalid');
const configPath = resolve(configArgument);
const username = normalizeAdminUsername(usernameArgument);
const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
rawConfig.admin = { ...rawConfig.admin, username, passwordHash };
const validated = validateConfig(rawConfig, dirname(configPath));
const store = new Store(validated.storage.database);
try {
  const existing = store.getAdminAccount();
  if (existing) store.updateAdminCredentials(username, passwordHash, 'root-recovery');
  else store.ensureAdminAccount(username, passwordHash);
  if (store.getAdminAccount().totpEnabled) store.disableAdminTotp('root-recovery');
} finally {
  store.close();
}
const temporary = `${configPath}.reset-admin`;
writeFileSync(temporary, `${JSON.stringify(rawConfig, null, 2)}\n`, { mode: 0o640 });
chmodSync(temporary, 0o640);
renameSync(temporary, configPath);
process.stdout.write('administrator account reset; two-factor authentication disabled\n');
