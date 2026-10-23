import type { AccountingStorage } from './accounting';
import { getAllAccounts } from '$lib/db/account-repository';
import { getAllJournals, addJournal } from '$lib/db/journal-repository';
/** Existing Local Mode remains authoritative in IndexedDB; never use in Server Mode. */
export const localAccountingStorage: AccountingStorage = {
	listAccounts: getAllAccounts,
	listJournals: getAllJournals,
	createJournal: (journal) => addJournal(journal)
};
