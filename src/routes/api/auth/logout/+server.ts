import { json } from '@sveltejs/kit';
import { getStorage } from '$lib/server/runtime';
import { revokeSession, SESSION_COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) revokeSession(getStorage().db, token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
