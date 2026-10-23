import { it, expect } from 'vitest';
import { createSession, authenticated, revokeSession, LoginLimiter } from './auth';
import { SqliteAccountingStorage } from './sqlite';
it('requires a valid, unexpired session and revokes logout; stores only a digest', () => {
	const store = new SqliteAccountingStorage(':memory:');
	try {
		expect(authenticated(store.db, undefined)).toBe(false);
		expect(authenticated(store.db, 'agent-token')).toBe(false);
		const token = createSession(store.db);
		expect(authenticated(store.db, token)).toBe(true);
		expect(JSON.stringify(store.db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
		revokeSession(store.db, token);
		expect(authenticated(store.db, token)).toBe(false);
		const expired = createSession(store.db);
		store.db.prepare('UPDATE sessions SET expires_at=0').run();
		expect(authenticated(store.db, expired)).toBe(false);
	} finally {
		store.close();
	}
});
it('limits login attempts and allows retries after a minute', () => {
	const limiter = new LoginLimiter();
	for (let i = 0; i < 10; i++) expect(limiter.allow(1000)).toBe(true);
	expect(limiter.allow(1001)).toBe(false);
	expect(limiter.allow(61001)).toBe(true);
});
