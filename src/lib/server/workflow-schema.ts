import { z } from 'zod';
import { journalSchema } from './journal-schema';
export const proposalSchema = z
	.object({
		requestId: z.uuid(),
		journal: journalSchema,
		transactionId: z.uuid().optional(),
		rationale: z.string().trim().min(1).max(4000),
		questions: z.array(z.string().min(1).max(500)).max(20).default([]),
		businessRatio: z.number().int().min(0).max(100).optional(),
		confidence: z.number().int().min(0).max(100).optional(),
		status: z.enum(['draft', 'pending']).default('pending')
	})
	.strict();
export const decisionSchema = z
	.object({
		id: z.uuid(),
		version: z.number().int().min(1),
		action: z.enum(['approve', 'reject', 'update']),
		journal: journalSchema.optional()
	})
	.strict();
export const annotationSchema = z
	.object({
		proposalId: z.uuid(),
		kind: z.enum(['explanation', 'question', 'classification']),
		text: z.string().trim().min(1).max(4000)
	})
	.strict();
export const csvInputSchema = z
	.object({
		csv: z.string().min(1).max(80000),
		source: z.enum(['bank', 'card', 'sales']),
		account: z.string().trim().min(1).max(100),
		direction: z.enum(['signed', 'expense', 'income']),
		mapping: z
			.object({
				date: z.string().min(1),
				description: z.string().min(1),
				amount: z.string(),
				inflow: z.string().optional(),
				outflow: z.string().optional(),
				vendor: z.string().optional(),
				externalId: z.string().optional()
			})
			.strict()
	})
	.strict();
export type ProposalInput = z.infer<typeof proposalSchema>;
export type CsvInput = z.infer<typeof csvInputSchema>;
export interface ImportedTransaction {
	fingerprint: string;
	date: string;
	amount: number;
	description: string;
	vendor: string;
	externalId: string;
	source: string;
	account: string;
	raw: Record<string, string>;
}
export interface Proposal {
	transaction?: {
		id: string;
		date: string;
		amount: number;
		description: string;
		vendor: string;
		raw: string;
	};
	id: string;
	version: number;
	status: 'draft' | 'pending' | 'approved' | 'rejected';
	actor: string;
	journal: z.infer<typeof journalSchema>;
	transactionId?: string;
	rationale: string;
	questions: string[];
	businessRatio?: number;
	confidence?: number;
	postedJournalId?: string;
	createdAt: string;
	annotations: { kind: string; text: string; actor: string; at: string }[];
}
