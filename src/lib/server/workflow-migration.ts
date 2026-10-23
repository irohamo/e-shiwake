import { chmodSync } from 'node:fs';
import type Database from 'better-sqlite3';
export function migrateWorkflow(db: Database.Database, backupPath?: string) {
	const version = (
		db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number }
	).version;
	if (version === 2) return;
	if (version !== 1) throw new Error('Unsupported schema version');
	// Synchronous, consistent SQLite snapshot before any v1 -> v2 schema changes.
	if (backupPath) {
		db.prepare('VACUUM INTO ?').run(backupPath);
		chmodSync(backupPath, 0o600);
	}
	db.transaction(() => {
		db.exec(`
 CREATE TABLE transactions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,date TEXT NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer'),description TEXT NOT NULL,vendor TEXT NOT NULL,source TEXT NOT NULL,account TEXT NOT NULL,external_id TEXT NOT NULL,raw TEXT NOT NULL,batch_id TEXT NOT NULL,journal_id TEXT REFERENCES journals(id));
 CREATE TABLE import_previews(id TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL,committed_at TEXT);
 CREATE TABLE import_batches(id TEXT PRIMARY KEY,at TEXT NOT NULL,inserted INTEGER NOT NULL,skipped INTEGER NOT NULL);
 CREATE TABLE proposals(id TEXT PRIMARY KEY,version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','pending','approved','rejected')),actor TEXT NOT NULL,transaction_id TEXT REFERENCES transactions(id),journal TEXT NOT NULL,rationale TEXT NOT NULL,questions TEXT NOT NULL,business_ratio INTEGER,confidence INTEGER,posted_journal_id TEXT UNIQUE REFERENCES journals(id),created_at TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);
 CREATE UNIQUE INDEX one_active_proposal_per_transaction ON proposals(transaction_id) WHERE status IN ('draft','pending','approved');
 CREATE TABLE proposal_annotations(id INTEGER PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES proposals(id),kind TEXT NOT NULL,text TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE closed_years(year INTEGER PRIMARY KEY,closed_at TEXT NOT NULL);
 INSERT INTO schema_version VALUES(2);
 `);
	})();
}
