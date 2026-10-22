import { env } from '$env/dynamic/private';
import { SqliteAccountingStorage } from './sqlite';
let storage: SqliteAccountingStorage | undefined;
export function getStorage() {
	if (env.ACCOUNTING_MODE !== 'server' || !__ACCOUNTING_SERVER__)
		throw new Error('Server Mode is disabled');
	if (!env.ACCOUNTING_DB_PATH) throw new Error('ACCOUNTING_DB_PATH is required');
	return (storage ??= new SqliteAccountingStorage(env.ACCOUNTING_DB_PATH));
}
