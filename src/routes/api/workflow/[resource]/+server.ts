import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getStorage } from '$lib/server/runtime';
import { WorkflowService } from '$lib/server/workflow';
import { readJson } from '$lib/server/http';
import {
	proposalSchema,
	decisionSchema,
	csvInputSchema,
	annotationSchema
} from '$lib/server/workflow-schema';
import { ConflictError } from '$lib/server/sqlite';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ params }) => {
	const s = new WorkflowService(getStorage());
	if (params.resource === 'proposals') return json(s.listProposals());
	if (params.resource === 'transactions') return json(s.listTransactions());
	if (params.resource === 'status') return json(s.status());
	error(404, '未対応の操作');
};
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readJson(request);
	const s = new WorkflowService(getStorage());
	try {
		if (params.resource === 'proposals') {
			const p = proposalSchema.safeParse(body);
			if (!p.success) error(400, '候補形式を確認してください');
			return json({ id: s.createProposal(p.data, 'owner') }, { status: 201 });
		}
		if (params.resource === 'decision') {
			const p = decisionSchema.safeParse(body);
			if (!p.success) error(400, '承認形式を確認してください');
			return json(s.decide(p.data.id, p.data.version, p.data.action, p.data.journal));
		}
		if (params.resource === 'annotations') {
			const p = annotationSchema.safeParse(body);
			if (!p.success) error(400, '説明形式を確認してください');
			s.annotate(p.data.proposalId, p.data.kind, p.data.text, 'owner');
			return json({ ok: true });
		}
		if (params.resource === 'csv-preview') {
			const p = csvInputSchema.safeParse(body);
			if (!p.success) error(400, 'CSV・列・口座名を確認してください');
			try {
				return json(s.preview(p.data));
			} catch (cause) {
				if (cause instanceof Error) error(400, cause.message);
				throw cause;
			}
		}
		if (params.resource === 'csv-commit') {
			const p = z.object({ id: z.uuid() }).strict().safeParse(body);
			if (!p.success) error(400, 'プレビューIDが必要です');
			return json(s.commitPreview(p.data.id));
		}
		error(404, '未対応の操作');
	} catch (cause) {
		if (cause instanceof ConflictError) error(409, cause.message);
		throw cause;
	}
};
