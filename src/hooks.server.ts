import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { authenticated, SESSION_COOKIE } from '$lib/server/auth';
import { AgentRateLimit } from '$lib/server/agent-rate';
import { authenticateAgent } from '$lib/server/agent-auth';
import { getStorage } from '$lib/server/runtime';

const agentRate = new AgentRateLimit();
const failure = (status: number, message: string) =>
	new Response(JSON.stringify({ message }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname.replace(/\/$/, '') || '/';
	if (!__ACCOUNTING_SERVER__) {
		if (
			path.includes('/api/accounting') ||
			path.includes('/api/auth') ||
			path.includes('/api/workflow') ||
			path.includes('/api/agent') ||
			/\/(server|login)$/.test(path)
		)
			return failure(404, 'Server Mode is disabled');
		return resolve(event);
	}
	if (
		env.ACCOUNTING_MODE !== 'server' ||
		!env.ACCOUNTING_PASSWORD_HASH_FILE ||
		!env.ACCOUNTING_DB_PATH ||
		!env.ORIGIN
	) {
		return failure(503, 'Server Modeの設定が不足または不一致です');
	}
	const agentPath = /^\/api\/agent\/[a-z-]+$/.test(path);
	if (
		agentPath &&
		!authenticateAgent(
			event.request.headers.get('authorization'),
			env.ACCOUNTING_AGENT_TOKEN_HASH_FILE
		)
	)
		return failure(401, 'Agent認証が必要です');
	if (agentPath && !agentRate.allow()) return failure(429, 'Agent APIは1分120回までです');
	const allowed = [
		'/server/review',
		'/server/import',
		'/',
		'/login',
		'/server',
		'/api/auth/login',
		'/api/auth/logout',
		'/api/accounting/accounts',
		'/api/accounting/journals',
		'/api/accounting/trial-balance'
	];
	if (
		!allowed.includes(path) &&
		!agentPath &&
		!/^\/api\/workflow\/[a-z-]+$/.test(path) &&
		!path.startsWith('/_app/') &&
		path !== '/favicon.ico'
	)
		return failure(404, 'この機能はServer Modeへ未移植です');
	if (!agentPath && !['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
		if (event.request.headers.get('origin') !== env.ORIGIN || event.url.origin !== env.ORIGIN)
			return failure(403, '同一オリジンから操作してください');
	}
	if (path === '/')
		return new Response(null, {
			status: 303,
			headers: { location: '/server', 'cache-control': 'no-store' }
		});
	if (
		!agentPath &&
		path !== '/login' &&
		path !== '/api/auth/login' &&
		!path.startsWith('/_app/') &&
		path !== '/favicon.ico'
	) {
		if (!authenticated(getStorage().db, event.cookies.get(SESSION_COOKIE))) {
			if (path.startsWith('/api/')) return failure(401, '認証が必要です');
			return new Response(null, {
				status: 303,
				headers: { location: '/login', 'cache-control': 'no-store' }
			});
		}
	}
	const response = await resolve(event);
	// An early body-limit response must not leave a partially read keep-alive request.
	if (response.status === 413) response.headers.set('connection', 'close');
	response.headers.set('cache-control', 'no-store');
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'no-referrer');
	response.headers.set(
		'content-security-policy',
		"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
	);
	return response;
};
