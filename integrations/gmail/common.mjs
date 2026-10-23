import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	chmodSync,
	renameSync,
	realpathSync
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export function stateDir() {
	const path = process.env.GMAIL_STATE_DIR;
	if (!path || !path.startsWith('/')) throw Error('Set private absolute GMAIL_STATE_DIR');
	const dir = resolve(path);
	const repo = existsSync(new URL('../../package.json', import.meta.url))
		? fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
		: process.cwd();
	if (dir === repo || dir.startsWith(repo + sep)) throw Error('State must be outside repository');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (realpathSync(dir) !== dir) throw Error('Symlinks forbidden');
	chmodSync(dir, 0o700);
	return dir;
}
export const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
export function save(path, value) {
	writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 });
	chmodSync(path + '.tmp', 0o600);
	renameSync(path + '.tmp', path);
}
export async function retry(fn) {
	for (let n = 0; ; n++) {
		try {
			return await fn();
		} catch (e) {
			const code = Number(e.response?.status ?? e.code);
			if (n >= 3 || ![429, 500, 502, 503, 504].includes(code)) throw e;
			await new Promise((r) => setTimeout(r, Math.min(4000, 500 * 2 ** n)));
		}
	}
}
export function settings(c) {
	if (
		!c.account ||
		!Array.isArray(c.labelIds) ||
		!c.labelIds.length ||
		c.labelIds.some((x) => !/^Label_[a-zA-Z0-9_-]+$/.test(x))
	)
		throw Error('STOPPED: explicit Gmail user-label allowlist required');
	if (!Number.isInteger(c.maxMessages) || c.maxMessages < 1 || c.maxMessages > 30)
		throw Error('maxMessages must be 1..30');
	const url = new URL(c.backend);
	if (
		!['127.0.0.1', 'localhost', 'accounting'].includes(url.hostname) ||
		url.protocol !== 'http:' ||
		url.pathname !== '/' ||
		url.username ||
		url.password
	)
		throw Error('Backend must be loopback or private Compose accounting service');
	return c;
}
export function lowerBound(now, checkpoint) {
	const floor = now - 30 * 86400000;
	return Math.max(floor, Math.min(now, Number(checkpoint) || floor) - 86400000);
}
