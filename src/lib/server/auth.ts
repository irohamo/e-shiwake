import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';

export const SESSION_COOKIE = 'eshiwake_session';
export const SESSION_SECONDS = 8 * 60 * 60;
export function verifyPassword(password: string, hashFile: string): boolean {
	if (password.length > 1024) return false;
	const stored = readFileSync(hashFile, 'utf8').trim();
	if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) throw new Error('Invalid password hash file');
	const [salt, expected] = stored.split(':');
	return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function createSession(db: Database.Database): string {
	const now = Date.now();
	db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
	const token = randomBytes(32).toString('hex');
	db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token), now + SESSION_SECONDS * 1000);
	return token;
}
export function authenticated(db: Database.Database, token: string | undefined): boolean {
	if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
	return !!db
		.prepare('SELECT 1 FROM sessions WHERE hash=? AND expires_at>?')
		.get(digest(token), Date.now());
}
export function revokeSession(db: Database.Database, token: string) {
	db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
}
/** Global ceiling avoids trusting spoofable forwarding headers; intentionally conservative for one owner. */
export class LoginLimiter {
	private attempts: number[] = [];
	allow(now = Date.now()) {
		this.attempts = this.attempts.filter((at) => at > now - 60_000);
		if (this.attempts.length >= 10) return false;
		this.attempts.push(now);
		return true;
	}
}
