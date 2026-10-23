import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getEvidence } from '$lib/server/evidence-runtime';
import { readJson } from '$lib/server/http';
import { ConflictError } from '$lib/server/sqlite';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = ({ params, url }) => {
	const s = getEvidence();
	if (params.resource === 'inbox') return json(s.list());
	if (params.resource === 'original') {
		const id = z.uuid().safeParse(url.searchParams.get('id'));
		if (!id.success) error(400, 'IDが必要です');
		try {
			const { data } = s.original(id.data);
			return new Response(new Uint8Array(data), {
				headers: {
					'content-type': 'application/octet-stream',
					'content-disposition': 'attachment; filename="evidence.bin"'
				}
			});
		} catch {
			error(409, '原本を参照できません');
		}
	}
	error(404);
};
const input = z.discriminatedUnion('action', [
	z
		.object({
			action: z.literal('answer'),
			questionId: z.uuid(),
			version: z.number().int().positive(),
			text: z.string().trim().min(1).max(4000)
		})
		.strict(),
	z
		.object({ action: z.literal('review'), id: z.uuid(), version: z.number().int().positive() })
		.strict(),
	z
		.object({
			action: z.literal('link'),
			id: z.uuid(),
			version: z.number().int().positive(),
			proposalId: z.uuid()
		})
		.strict()
]);
export const POST: RequestHandler = async ({ request, params }) => {
	if (params.resource !== 'decision') error(404);
	const p = input.safeParse(await readJson(request));
	if (!p.success) error(400, '形式を確認してください');
	const s = getEvidence();
	try {
		const v = p.data;
		return json(
			v.action === 'answer'
				? s.answer(v.questionId, v.version, v.text)
				: v.action === 'link'
					? s.link(v.id, v.version, v.proposalId)
					: s.review(v.id, v.version)
		);
	} catch (e) {
		if (e instanceof ConflictError) error(409, e.message);
		throw e;
	}
};
