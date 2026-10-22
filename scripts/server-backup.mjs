import Database from 'better-sqlite3';
import { chmodSync, existsSync } from 'node:fs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || existsSync(destination))
	throw new Error('Usage: node scripts/server-backup.mjs SOURCE NEW_DESTINATION');
process.umask(0o077);
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
	await db.backup(destination);
	chmodSync(destination, 0o600);
	const backup = new Database(destination, { readonly: true });
	try {
		if (
			backup.pragma('integrity_check', { simple: true }) !== 'ok' ||
			backup.pragma('foreign_key_check').length
		)
			throw new Error('Backup validation failed');
	} finally {
		backup.close();
	}
	console.log('Backup verified');
} finally {
	db.close();
}
