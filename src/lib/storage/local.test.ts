import { it, expect } from 'vitest';
import { db, initializeDatabase } from '$lib/db/database';
import { localAccountingStorage } from './local';
it('retains the IndexedDB repository path for Local Mode', async () => {
	await db.delete();
	await db.open();
	await initializeDatabase();
	try {
		const id = await localAccountingStorage.createJournal(
			{
				date: '2026-10-22',
				vendor: '',
				description: 'Local regression',
				evidenceStatus: 'none',
				attachments: [],
				lines: [
					{ id: crypto.randomUUID(), type: 'debit', accountCode: '1001', amount: 100 },
					{ id: crypto.randomUUID(), type: 'credit', accountCode: '4001', amount: 100 }
				]
			},
			crypto.randomUUID()
		);
		expect(
			(await localAccountingStorage.listJournals()).find((j) => j.id === id)?.description
		).toBe('Local regression');
		expect((await localAccountingStorage.listAccounts()).length).toBeGreaterThan(0);
	} finally {
		await db.delete();
	}
});
