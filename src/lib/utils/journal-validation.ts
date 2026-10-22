import type { JournalEntry } from '$lib/types';

export function validateJournal(journal: Pick<JournalEntry, 'lines'>): {
	isValid: boolean;
	debitTotal: number;
	creditTotal: number;
	hasEmptyAccounts: boolean;
} {
	const debitTotal = journal.lines
		.filter((line) => line.type === 'debit')
		.reduce((sum, line) => sum + line.amount, 0);

	const creditTotal = journal.lines
		.filter((line) => line.type === 'credit')
		.reduce((sum, line) => sum + line.amount, 0);

	// 勘定科目が選択されていない行があるかチェック
	const hasEmptyAccounts = journal.lines.some((line) => !line.accountCode);

	const isTotalValid = debitTotal === creditTotal && debitTotal > 0;

	return {
		isValid: isTotalValid && !hasEmptyAccounts,
		debitTotal,
		creditTotal,
		hasEmptyAccounts
	};
}
