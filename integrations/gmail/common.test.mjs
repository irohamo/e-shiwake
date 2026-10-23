import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retry, settings, lowerBound } from './common.mjs';
test('explicit allowlist, private backend, bounded batch', () => {
	const c = {
		account: 'fixture',
		labelIds: ['Label_fixture'],
		maxMessages: 10,
		backend: 'http://127.0.0.1:3000/'
	};
	assert.deepEqual(settings(c), c);
	for (const bad of [{ labelIds: [] }, { backend: 'https://public.example/' }, { maxMessages: 31 }])
		assert.throws(() => settings({ ...c, ...bad }));
});
test('checkpoint never expands beyond thirty days', () => {
	const now = Date.now();
	assert.equal(lowerBound(now, 0), now - 30 * 86400000);
	assert.equal(lowerBound(now, now), now - 86400000);
});
test('authentication errors do not retry', async () => {
	let calls = 0;
	await assert.rejects(
		retry(() => {
			calls++;
			throw { code: 401 };
		})
	);
	assert.equal(calls, 1);
});

test('missing allowlist/OAuth stops before network work', async () => {
	const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { spawnSync } = await import('node:child_process');
	const dir = mkdtempSync(join(tmpdir(), 'gmail-stopped-'));
	try {
		const run = () =>
			spawnSync(process.execPath, ['fetch.mjs'], {
				cwd: new URL('.', import.meta.url),
				env: { ...process.env, GMAIL_STATE_DIR: dir },
				encoding: 'utf8',
				timeout: 10000
			});
		let r = run();
		assert.equal(r.status, 0);
		assert.match(r.stdout, /STOPPED.*allowlist/);
		writeFileSync(
			join(dir, 'config.json'),
			JSON.stringify({
				account: 'fixture',
				labelIds: ['Label_fixture'],
				maxMessages: 1,
				backend: 'http://127.0.0.1:3000/'
			}),
			{ mode: 0o600 }
		);
		r = run();
		assert.equal(r.status, 0);
		assert.match(r.stdout, /STOPPED.*OAuth/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
