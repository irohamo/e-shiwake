import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSession, authenticated } from './auth';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SqliteAccountingStorage } from './sqlite';
import { createJournalSchema } from './journal-schema';
import { generateTrialBalance } from '$lib/utils/trial-balance';
import type { NewJournal } from '$lib/storage/accounting';

function journal(): NewJournal {
	return {
		date: '2026-10-22',
		vendor: 'テスト',
		description: '複合仕訳',
		evidenceStatus: 'none',
		attachments: [],
		lines: [
			{ id: randomUUID(), type: 'debit', accountCode: '1001', amount: 900 },
			{ id: randomUUID(), type: 'debit', accountCode: '1005', amount: 100 },
			{ id: randomUUID(), type: 'credit', accountCode: '4001', amount: 1000 }
		]
	};
}
const directories: string[] = [];
const stores: SqliteAccountingStorage[] = [];
function open(path = ':memory:') {
	const store = new SqliteAccountingStorage(path);
	stores.push(store);
	return store;
}
afterEach(() => {
	for (const store of stores.splice(0)) if (store.db.open) store.close();
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('Server canonical SQLite store', () => {
	it('persists a compound journal across independent connections and restart with matching trial balance', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'eshiwake-'));
		directories.push(dir);
		const path = join(dir, 'book.sqlite');
		const first = open(path);
		const second = open(path);
		const entry = journal();
		const id = await first.createJournal(entry, randomUUID());
		expect((await second.listJournals())[0]).toMatchObject({ ...entry, id });
		first.close();
		second.close();
		const restarted = open(path);
		const balance = generateTrialBalance(
			await restarted.listJournals(),
			await restarted.listAccounts()
		);
		expect(balance).toMatchObject({ totalDebit: 1000, totalCredit: 1000, isBalanced: true });
		expect(restarted.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
	});
	it('makes retries idempotent and rejects a different payload for the same request', async () => {
		const store = open();
		const entry = journal();
		const requestId = randomUUID();
		const id = await store.createJournal(entry, requestId);
		expect(await store.createJournal(entry, requestId)).toBe(id);
		await expect(
			store.createJournal({ ...entry, description: '別内容' }, requestId)
		).rejects.toThrow('再送ID');
		expect(await store.listJournals()).toHaveLength(1);
	});
	it('rejects invalid accounting and untrusted fields before any write', async () => {
		const store = open();
		const entry = journal();
		for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER, NaN, Infinity]) {
			const bad = { ...entry, lines: entry.lines.map((line) => ({ ...line, amount: value })) };
			await expect(store.createJournal(bad, randomUUID())).rejects.toThrow();
		}
		await expect(
			store.createJournal({ ...entry, lines: entry.lines.slice(1) }, randomUUID())
		).rejects.toThrow();
		await expect(
			store.createJournal({ ...entry, date: '2026-02-30' }, randomUUID())
		).rejects.toThrow();
		expect(
			createJournalSchema.safeParse({
				requestId: randomUUID(),
				journal: { ...entry, approved: true }
			}).success
		).toBe(false);
		expect(await store.listJournals()).toHaveLength(0);
	});
	it('rejects unknown accounts, attachments, and fractional business ratio metadata', async () => {
		const store = open();
		const entry = journal();
		entry.lines[0].accountCode = '9999';
		await expect(store.createJournal(entry, randomUUID())).rejects.toThrow('未登録');
		expect(
			createJournalSchema.safeParse({
				requestId: randomUUID(),
				journal: { ...journal(), attachments: [{}] }
			}).success
		).toBe(false);
		const ratio = journal();
		ratio.lines[0]._businessRatio = 50;
		await expect(store.createJournal(ratio, randomUUID())).rejects.toThrow();
		expect(await store.listJournals()).toHaveLength(0);
	});
	it('rolls back journal, lines, and audit together if audit write fails', async () => {
		const store = open();
		store.db.exec(
			"CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'test failure'); END;"
		);
		await expect(store.createJournal(journal(), randomUUID())).rejects.toThrow('test failure');
		expect(await store.listJournals()).toEqual([]);
		expect(store.db.prepare('SELECT COUNT(*) AS n FROM journal_lines').get()).toEqual({ n: 0 });
	});
	it('restores an online backup including uncheckpointed WAL data', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'eshiwake-backup-'));
		directories.push(dir);
		const store = open(join(dir, 'source.sqlite'));
		await store.createJournal(journal(), randomUUID());
		const backup = join(dir, 'backup.sqlite');
		await store.db.backup(backup);
		const restored = open(backup);
		expect(await restored.listJournals()).toEqual(await store.listJournals());
		expect(restored.db.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(restored.db.pragma('foreign_key_check')).toEqual([]);
	});
	it('enforces integer and foreign key constraints at the DB boundary', () => {
		const store = open();
		expect(() =>
			store.db
				.prepare('INSERT INTO journal_lines VALUES(?,?,?,?,?,?,?,?)')
				.run('missing', 0, randomUUID(), 'debit', '1001', 1.5, null, null)
		).toThrow();
		expect(store.db.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(Database).toBeDefined();
	});
});

it('restores through the offline CLI to a fresh path, revokes sessions, and refuses overwrite', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'eshiwake-restore-'));
	directories.push(dir);
	const source = join(dir, 'source.sqlite');
	const destination = join(dir, 'restored.sqlite');
	const store = open(source);
	await store.createJournal(journal(), randomUUID());
	const token = createSession(store.db);
	await promisify(execFile)(process.execPath, ['scripts/server-restore.mjs', source, destination]);
	const restored = open(destination);
	expect(await restored.listJournals()).toEqual(await store.listJournals());
	expect(authenticated(restored.db, token)).toBe(false);
	expect(authenticated(store.db, token)).toBe(true);
	await expect(
		promisify(execFile)(process.execPath, ['scripts/server-restore.mjs', source, destination])
	).rejects.toThrow();
});
