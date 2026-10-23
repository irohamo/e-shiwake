import type Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
export function migrateEvidence(db: Database.Database, backupPath?: string) {
	if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='gmail_evidence'").get()) return;
	if (backupPath) {
		db.prepare('VACUUM INTO ?').run(backupPath);
		chmodSync(backupPath, 0o600);
	}
	db.transaction(() =>
		db.exec(`
 CREATE TABLE gmail_evidence(id TEXT PRIMARY KEY,account TEXT NOT NULL,message_id TEXT NOT NULL,part_id TEXT NOT NULL,hash TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,received_at TEXT NOT NULL,proposal_id TEXT REFERENCES proposals(id),version INTEGER NOT NULL DEFAULT 1,UNIQUE(account,message_id,part_id));
 CREATE INDEX evidence_hash ON gmail_evidence(hash);
 CREATE TABLE evidence_reviews(id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES gmail_evidence(id),version INTEGER NOT NULL,proposal_version INTEGER,policy TEXT NOT NULL,result TEXT NOT NULL,checks TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE evidence_questions(id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL REFERENCES gmail_evidence(id),version INTEGER NOT NULL,text TEXT NOT NULL,answer TEXT,answered_at TEXT);
 `)
	)();
}
