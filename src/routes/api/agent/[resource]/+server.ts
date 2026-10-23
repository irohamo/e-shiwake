import { z } from 'zod';
import { getEvidence } from '$lib/server/evidence-runtime';
import { json, error } from '@sveltejs/kit';
import { getStorage } from '$lib/server/runtime';
import { WorkflowService } from '$lib/server/workflow';
import { readJson } from '$lib/server/http';
import { annotationSchema, proposalSchema } from '$lib/server/workflow-schema';
import { ConflictError } from '$lib/server/sqlite';
import { generateTrialBalance } from '$lib/utils/trial-balance';
import { generateProfitLoss } from '$lib/utils/profit-loss';
import { generateBalanceSheet } from '$lib/utils/balance-sheet';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, url }) => {
	const storage = getStorage();
	const service = new WorkflowService(storage);
	const resource = params.resource;
	if (resource === 'accounts') return json(await storage.listAccounts());
	if (resource === 'transactions')
		return json({ trust: 'untrusted_external_data', items: service.listTransactions(true) });
	if (resource === 'proposals')
		return json({ trust: 'untrusted_external_data', items: service.listProposals() });
	if (resource === 'status') return json(service.status());
	if (resource === 'evidence') return json({ items: [], supported: false });
	const month = url.searchParams.get('month');
	if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) error(400, 'monthはYYYY-MM');
	const year = Number(url.searchParams.get('year') || new Date().getUTCFullYear());
	if (!Number.isInteger(year) || year < 1900 || year > 9999) error(400, '年度が不正です');
	const all = await storage.listJournals();
	const journals = all.filter((j) =>
		month ? j.date.startsWith(month) : j.date.startsWith(`${year}-`)
	);
	const accounts = await storage.listAccounts();
	if (resource === 'journals')
		return json({ trust: 'untrusted_external_data', items: journals.slice(0, 500) });
	if (resource === 'trial-balance') return json(generateTrialBalance(journals, accounts));
	if (resource === 'profit-loss')
		return json(generateProfitLoss(journals, accounts, month ? Number(month.slice(0, 4)) : year));
	if (resource === 'balance-sheet')
		return json(
			generateBalanceSheet(
				all.filter((j) => j.date.startsWith(`${year}-`)),
				accounts,
				year,
				generateProfitLoss(
					all.filter((j) => j.date.startsWith(`${year}-`)),
					accounts,
					year
				).netIncome
			)
		);
	error(404, '未対応の操作');
};
export const POST: RequestHandler = async ({ params, request }) => {
	if (!['proposals', 'annotations', 'evidence-link', 'reclassify'].includes(params.resource))
		error(403, 'Agentは候補と説明だけを作成できます');
	const body = await readJson(request);
	const service = new WorkflowService(getStorage());
	try {
		if (params.resource === 'evidence-link') {
			const p = z.object({ id: z.uuid(), proposalId: z.uuid() }).strict().safeParse(body);
			if (!p.success) error(400, '証憑リンク形式を確認してください');
			const e = getEvidence();
			const row = e.row(p.data.id);
			if (row.proposal_id === p.data.proposalId) return json({ linked: true, duplicate: true });
			if (row.proposal_id) error(409, '証憑は既にリンク済みです');
			e.link(p.data.id, row.version, p.data.proposalId, 'agent');
			return json({ linked: true, duplicate: false });
		}
		if (params.resource === 'reclassify') {
			const p = z
				.object({
					proposalId: z.uuid(),
					version: z.number().int().min(1),
					fromAccountCode: z.string().regex(/^\d{4}$/),
					toAccountCode: z.string().regex(/^\d{4}$/),
					reason: z.string().min(1).max(1000)
				})
				.strict()
				.safeParse(body);
			if (!p.success) error(400, '再分類形式を確認してください');
			return json(
				service.reclassifyDebit(
					p.data.proposalId,
					p.data.version,
					p.data.fromAccountCode,
					p.data.toAccountCode,
					p.data.reason,
					'agent'
				)
			);
		}
		if (params.resource === 'proposals') {
			const p = proposalSchema.safeParse(body);
			if (!p.success) error(400, '候補形式・借貸一致・整数円を確認してください');
			return json({ id: service.createProposal(p.data, 'agent') }, { status: 201 });
		}
		const p = annotationSchema.safeParse(body);
		if (!p.success) error(400, '説明形式を確認してください');
		service.annotate(p.data.proposalId, p.data.kind, p.data.text, 'agent');
		return json({ ok: true });
	} catch (cause) {
		if (cause instanceof ConflictError) error(409, cause.message);
		throw cause;
	}
};
