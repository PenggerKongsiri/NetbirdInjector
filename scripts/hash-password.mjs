import { readFileSync } from 'node:fs';
import { hashPassword } from '../src/lib/security.mjs';

const password = readFileSync(0, 'utf8').replace(/[\r\n]+$/, '');
try {
  process.stdout.write(`${await hashPassword(password)}\n`);
} catch (error) {
  process.stderr.write(`Cannot hash password: ${error.message}\n`);
  process.exit(1);
}
