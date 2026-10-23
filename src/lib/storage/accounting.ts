import type { Account, JournalEntry } from '$lib/types';

export type NewJournal = Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>;
/** Phase 1 contract. No raw DB/table operations or AI posting authority. */
export interface AccountingStorage {
	listAccounts(): Promise<Account[]>;
	listJournals(): Promise<JournalEntry[]>;
	createJournal(journal: NewJournal, requestId: string): Promise<string>;
}
