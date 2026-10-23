import Database from 'better-sqlite3';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { migrateEvidence } from './evidence-migration';
import { migrateWorkflow } from './workflow-migration';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { defaultAccounts } from '$lib/db/seed';
import type { Account, JournalEntry, JournalLine } from '$lib/types';
import type { AccountingStorage, NewJournal } from '$lib/storage/accounting';
import { journalSchema } from './journal-schema';

export class ConflictError extends Error {}
/** All mutating calls are backend-only. Single-owner, single-ledger Phase 1. */
export class SqliteAccountingStorage implements AccountingStorage {
	readonly db: Database.Database;
	constructor(path: string) {
		const existed = path !== ':memory:' && existsSync(path);
		if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.db = new Database(path);
		if (path !== ':memory:') chmodSync(path, 0o600);
		this.db.pragma('journal_mode = WAL');
		this.db.pragma('foreign_keys = ON');
		this.db.pragma('busy_timeout = 5000');
		this.db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
		CREATE TABLE IF NOT EXISTS accounts (code TEXT PRIMARY KEY, data TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS journals (
		 id TEXT PRIMARY KEY, date TEXT NOT NULL, vendor TEXT NOT NULL, description TEXT NOT NULL,
		 evidence_status TEXT NOT NULL CHECK(evidence_status IN ('none','paper')),
		 created_at TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS journals_date ON journals(date);
		CREATE TABLE IF NOT EXISTS journal_lines (
		 journal_id TEXT NOT NULL REFERENCES journals(id), position INTEGER NOT NULL,
		 id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('debit','credit')),
		 account_code TEXT NOT NULL REFERENCES accounts(code),
		 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>=0 AND amount<=1000000000000),
		 tax_category TEXT, memo TEXT, PRIMARY KEY(journal_id, position), UNIQUE(journal_id,id)
		);
		-- Additive metadata storage also upgrades existing books without changing journal_lines.
		CREATE TABLE IF NOT EXISTS journal_line_business_ratio (
		 journal_id TEXT NOT NULL, position INTEGER NOT NULL, metadata TEXT NOT NULL,
		 PRIMARY KEY(journal_id, position),
		 FOREIGN KEY(journal_id, position) REFERENCES journal_lines(journal_id, position)
		);
		CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
		 action TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
		INSERT OR IGNORE INTO schema_version VALUES(1);
		`);
		const version = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
			version: number;
		};
		if (![1, 2].includes(version.version)) {
			this.db.close();
			throw new Error('Unsupported schema version');
		}
		migrateWorkflow(
			this.db,
			existed && version.version === 1 ? `${path}.before-v2-${randomUUID()}.sqlite` : undefined
		);
		migrateEvidence(
			this.db,
			existed ? `${path}.before-evidence-${randomUUID()}.sqlite` : undefined
		);
		this.db.transaction(() => {
			const seed = this.db.prepare('INSERT OR IGNORE INTO accounts(code,data) VALUES(?,?)');
			for (const account of defaultAccounts) seed.run(account.code, JSON.stringify(account));
		})();
	}
	async listAccounts(): Promise<Account[]> {
		return (
			this.db.prepare('SELECT data FROM accounts ORDER BY code').all() as { data: string }[]
		).map((row) => JSON.parse(row.data) as Account);
	}
	async listJournals(): Promise<JournalEntry[]> {
		const rows = this.db
			.prepare('SELECT * FROM journals ORDER BY date DESC, created_at DESC')
			.all() as {
			id: string;
			date: string;
			vendor: string;
			description: string;
			evidence_status: 'none' | 'paper';
			created_at: string;
		}[];
		return rows.map((row) => {
			const lines = this.db
				.prepare(
					`SELECT l.id,l.type,l.account_code AS accountCode,l.amount,l.tax_category AS taxCategory,l.memo,
			 b.metadata AS businessRatioMetadata FROM journal_lines l
			 LEFT JOIN journal_line_business_ratio b ON b.journal_id=l.journal_id AND b.position=l.position
			 WHERE l.journal_id=? ORDER BY l.position`
				)
				.all(row.id) as (JournalLine & { businessRatioMetadata: string | null })[];
			return {
				id: row.id,
				date: row.date,
				vendor: row.vendor,
				description: row.description,
				evidenceStatus: row.evidence_status,
				createdAt: row.created_at,
				updatedAt: row.created_at,
				attachments: [],
				lines: lines.map(({ businessRatioMetadata, ...line }) => ({
					...line,
					...JSON.parse(businessRatioMetadata ?? '{}'),
					taxCategory: line.taxCategory ?? undefined,
					memo: line.memo ?? undefined
				}))
			};
		});
	}
	async createJournal(input: NewJournal, requestId: string): Promise<string> {
		return this.postJournal(input, requestId);
	}
	postJournal(input: NewJournal, requestId: string): string {
		const journal = journalSchema.parse(input);
		if (
			this.db
				.prepare('SELECT 1 FROM closed_years WHERE year=?')
				.get(Number(journal.date.slice(0, 4)))
		)
			throw new ConflictError('締め済み年度には保存できません');
		const hash = createHash('sha256').update(JSON.stringify(journal)).digest('hex');
		return this.db
			.transaction(() => {
				const previous = this.db
					.prepare('SELECT id,request_hash FROM journals WHERE request_id=?')
					.get(requestId) as { id: string; request_hash: string } | undefined;
				if (previous) {
					if (previous.request_hash !== hash)
						throw new ConflictError('再送IDが別の仕訳に使用されています');
					return previous.id;
				}
				// Keep all existing Number-based report sums within the exact integer range.
				const existing = this.db.prepare('SELECT amount FROM journal_lines').all() as {
					amount: number;
				}[];
				const gross = [...existing, ...journal.lines].reduce(
					(sum, line) => sum + BigInt(line.amount),
					0n
				);
				if (gross > BigInt(Number.MAX_SAFE_INTEGER))
					throw new Error('帳簿総額が安全整数の上限を超えます');
				const knownAccount = this.db.prepare('SELECT code FROM accounts WHERE code=?');
				for (const line of journal.lines)
					if (!knownAccount.get(line.accountCode)) throw new Error('未登録の勘定科目です');
				const id = randomUUID();
				const now = new Date().toISOString();
				this.db
					.prepare('INSERT INTO journals VALUES(?,?,?,?,?,?,?,?)')
					.run(
						id,
						journal.date,
						journal.vendor,
						journal.description,
						journal.evidenceStatus,
						now,
						requestId,
						hash
					);
				const insert = this.db.prepare('INSERT INTO journal_lines VALUES(?,?,?,?,?,?,?,?)');
				journal.lines.forEach((line, index) =>
					insert.run(
						id,
						index,
						line.id,
						line.type,
						line.accountCode,
						line.amount,
						line.taxCategory ?? null,
						line.memo ?? null
					)
				);
				const metadataInsert = this.db.prepare(
					'INSERT INTO journal_line_business_ratio VALUES(?,?,?)'
				);
				journal.lines.forEach((line, index) => {
					const {
						_businessRatioApplied,
						_originalAmount,
						_businessRatio,
						_businessRatioGenerated
					} = line;
					const metadata = {
						_businessRatioApplied,
						_originalAmount,
						_businessRatio,
						_businessRatioGenerated
					};
					if (Object.values(metadata).some((v) => v !== undefined))
						metadataInsert.run(id, index, JSON.stringify(metadata));
				});
				this.db
					.prepare('INSERT INTO audit_log(at,actor,action,entity_id,detail) VALUES(?,?,?,?,?)')
					.run(now, 'owner', 'journal.create', id, JSON.stringify(journal));
				return id;
			})
			.immediate();
	}
	close() {
		this.db.close();
	}
}
