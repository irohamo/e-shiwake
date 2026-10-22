// Offline restore to a NEW path only. Never overwrite a running or existing ledger.
import Database from 'better-sqlite3';
import { existsSync, chmodSync } from 'node:fs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || existsSync(destination))
	throw new Error('Usage: node scripts/server-restore.mjs BACKUP NEW_DESTINATION');
process.umask(0o077);
const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
try {
	if (
		sourceDb.pragma('integrity_check', { simple: true }) !== 'ok' ||
		sourceDb.pragma('foreign_key_check').length
	)
		throw new Error('Invalid backup');
	if (sourceDb.prepare('SELECT MAX(version) AS version FROM schema_version').get().version !== 1)
		throw new Error('Unsupported backup schema');
	const imbalance = sourceDb
		.prepare(
			"SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING SUM(CASE WHEN type='debit' THEN amount ELSE -amount END) != 0"
		)
		.all();
	if (imbalance.length) throw new Error('Unbalanced backup');
	await sourceDb.backup(destination);
	chmodSync(destination, 0o600);
	const restored = new Database(destination);
	try {
		restored.prepare('DELETE FROM sessions').run();
	} finally {
		restored.close();
	}
	console.log(
		'Restore verified; sessions revoked. Point ACCOUNTING_DB_PATH to the new file while stopped.'
	);
} finally {
	sourceDb.close();
}
