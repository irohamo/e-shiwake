import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
// stdin only. Never put a password in argv, shell history or a committed env file.
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (password.length < 16 || password.length > 1024)
	throw new Error('Use a password of 16-1024 characters');
const salt = randomBytes(16).toString('hex');
process.stdout.write(`${salt}:${scryptSync(password, salt, 64).toString('hex')}\n`);
