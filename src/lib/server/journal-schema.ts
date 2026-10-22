import { z } from 'zod';
import { validateJournal } from '$lib/utils/journal-validation';

// Integer JPY only; the lower bound on zero-valued lines permits compound entries.
export const amountSchema = z.number().int().min(0).max(1_000_000_000_000);
export const journalSchema = z
	.object({
		date: z.iso.date(),
		vendor: z.string().max(500),
		description: z.string().trim().min(1).max(2000),
		evidenceStatus: z.enum(['none', 'paper']),
		attachments: z.array(z.never()).length(0),
		lines: z
			.array(
				z
					.object({
						id: z.uuid(),
						type: z.enum(['debit', 'credit']),
						accountCode: z.string().regex(/^\d{4}$/),
						amount: amountSchema,
						taxCategory: z
							.enum([
								'sales_10',
								'sales_8',
								'purchase_10',
								'purchase_8',
								'exempt',
								'out_of_scope',
								'na'
							])
							.optional(),
						memo: z.string().max(500).optional()
					})
					.strict()
			)
			.min(2)
			.max(100)
	})
	.strict()
	.superRefine((journal, ctx) => {
		const totals = journal.lines.reduce(
			(sum, line) => {
				sum[line.type] += BigInt(line.amount);
				return sum;
			},
			{ debit: 0n, credit: 0n }
		);
		if (
			totals.debit > BigInt(Number.MAX_SAFE_INTEGER) ||
			totals.credit > BigInt(Number.MAX_SAFE_INTEGER) ||
			!validateJournal(journal).isValid
		) {
			ctx.addIssue({ code: 'custom', message: '借貸一致・正の合計・安全整数を確認してください' });
		}
		if (new Set(journal.lines.map((line) => line.id)).size !== journal.lines.length) {
			ctx.addIssue({ code: 'custom', message: '仕訳行IDが重複しています' });
		}
	});
export const createJournalSchema = z
	.object({ journal: journalSchema, requestId: z.uuid() })
	.strict();
