import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import { DEFAULT_CONFIG, validateConfig } from '../src/config.mjs';

const [
  outputArg, proxyListen, proxyPort, adminListen, adminPort, allowedCidrs, allowedPorts, passwordHash,
  netbirdMode = 'manual', apiBaseUrl = 'https://api.netbird.io', tokenFile = '', adminUsername = 'admin',
  adminAllowedCidrs = '127.0.0.0/8,::1/128', adminTlsCertFile = '', adminTlsKeyFile = '',
] = process.argv.slice(2);
if (!outputArg) {
  process.stderr.write('usage: configure.mjs OUTPUT PROXY_LISTEN PROXY_PORT ADMIN_LISTEN ADMIN_PORT CIDRS PORTS PASSWORD_HASH [MODE API_URL TOKEN_FILE ADMIN_USERNAME ADMIN_CLIENT_CIDRS ADMIN_TLS_CERT ADMIN_TLS_KEY]\n');
  process.exit(2);
}
const output = resolve(outputArg);
const alreadyExists = existsSync(output);
const existing = alreadyExists ? JSON.parse(readFileSync(output, 'utf8')) : structuredClone(DEFAULT_CONFIG);
if (!alreadyExists) existing.storage = { database: '/var/lib/netbird-injector-manager/state.db' };
existing.proxy = { ...existing.proxy, listen: proxyListen, port: Number(proxyPort) };
const loopbackAdmin = adminListen === '::1' || (net.isIP(adminListen) === 4 && adminListen.startsWith('127.'));
existing.admin = {
  ...existing.admin,
  listen: adminListen,
  port: Number(adminPort),
  username: adminUsername || existing.admin?.username || 'admin',
  passwordHash: passwordHash || existing.admin?.passwordHash,
  allowRemote: !loopbackAdmin,
  cookieSecure: !loopbackAdmin || Boolean(adminTlsCertFile),
  allowedCidrs: adminAllowedCidrs.split(',').map((value) => value.trim()).filter(Boolean),
  tlsCertFile: adminTlsCertFile,
  tlsKeyFile: adminTlsKeyFile,
};
existing.network = {
  ...existing.network,
  allowedTargetCidrs: allowedCidrs.split(',').map((value) => value.trim()).filter(Boolean),
  allowedPorts: allowedPorts.split(',').map(Number),
};
existing.netbird = {
  ...existing.netbird,
  mode: netbirdMode,
  apiBaseUrl,
  tokenFile,
  writeEnabled: false,
};
validateConfig(existing, dirname(output));
if (!existing.admin.passwordHash) throw new Error('an administrator password hash is required');
mkdirSync(dirname(output), { recursive: true, mode: 0o750 });
const temporary = `${output}.new`;
writeFileSync(temporary, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
chmodSync(temporary, 0o600);
renameSync(temporary, output);
process.stdout.write(`${output}\n`);
