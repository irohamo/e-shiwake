import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { getStorage } from '$lib/server/runtime';
import {
	verifyPassword,
	createSession,
	LoginLimiter,
	SESSION_COOKIE,
	SESSION_SECONDS
} from '$lib/server/auth';
import { readJson } from '$lib/server/http';
import type { RequestHandler } from './$types';
const limiter = new LoginLimiter();
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	if (!limiter.allow()) error(429, 'しばらく待ってから再試行してください');
	const result = z
		.object({ password: z.string().max(1024) })
		.strict()
		.safeParse(await readJson(request));
	if (!result.success) error(400, 'パスワードを入力してください');
	if (
		!env.ACCOUNTING_PASSWORD_HASH_FILE ||
		!verifyPassword(result.data.password, env.ACCOUNTING_PASSWORD_HASH_FILE)
	)
		error(401, 'ログインできませんでした');
	cookies.set(SESSION_COOKIE, createSession(getStorage().db), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: url.protocol === 'https:',
		maxAge: SESSION_SECONDS
	});
	return json({ ok: true });
};
