import { json, error } from '@sveltejs/kit';
import { getStorage } from '$lib/server/runtime';
import { createJournalSchema } from '$lib/server/journal-schema';
import { ConflictError } from '$lib/server/sqlite';
import { readJson } from '$lib/server/http';
import { generateTrialBalance } from '$lib/utils/trial-balance';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params }) => {
	const storage = getStorage();
	if (params.resource === 'accounts') return json(await storage.listAccounts());
	if (params.resource === 'journals') return json(await storage.listJournals());
	if (params.resource === 'trial-balance')
		return json(generateTrialBalance(await storage.listJournals(), await storage.listAccounts()));
	error(404, '未対応の機能です');
};
export const POST: RequestHandler = async ({ params, request }) => {
	if (params.resource !== 'journals') error(405, '読み取り専用です');
	const result = createJournalSchema.safeParse(await readJson(request));
	if (!result.success)
		error(400, '仕訳形式・日付・整数金額・借貸一致を確認してください。証憑はまだ保存できません。');
	try {
		const id = await getStorage().createJournal(result.data.journal, result.data.requestId);
		return json({ id }, { status: 201 });
	} catch (cause) {
		if (cause instanceof ConflictError) error(409, cause.message);
		if (
			cause instanceof Error &&
			['未登録の勘定科目です', '帳簿総額が安全整数の上限を超えます'].includes(cause.message)
		)
			error(400, cause.message);
		throw cause;
	}
};
