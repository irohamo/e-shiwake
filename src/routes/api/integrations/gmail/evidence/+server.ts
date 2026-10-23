import { json, error } from '@sveltejs/kit';
import { getEvidence } from '$lib/server/evidence-runtime';
import { evidenceSchema } from '$lib/server/evidence';
import { readJson } from '$lib/server/http';
import { ConflictError } from '$lib/server/sqlite';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request }) => {
	const p = evidenceSchema.safeParse(await readJson(request, 12 * 1024 * 1024));
	if (!p.success) error(400, '証憑形式を確認してください');
	try {
		return json(getEvidence().ingest(p.data), { status: 201 });
	} catch (e) {
		if (e instanceof ConflictError) error(409, e.message);
		throw e;
	}
};
