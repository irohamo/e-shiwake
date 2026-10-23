import { google } from 'googleapis';
import { createHash } from 'node:crypto';
import { openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { stateDir, read, save, SCOPE, retry, settings, lowerBound } from './common.mjs';
async function main() {
	const dir = stateDir();
	let config;
	try {
		config = settings(read(dir + '/config.json'));
	} catch {
		console.log('STOPPED: configure private config.json and explicit label allowlist');
		return;
	}
	let token, client;
	try {
		token = read(dir + '/token.json');
		client = read(dir + '/client.json').installed;
	} catch {
		console.log('STOPPED: dedicated OAuth connection required; run npm run oauth over SSH tunnel');
		return;
	}
	// O_EXCL lock is never force-cleared: inspect a stale lock manually after verifying no process runs.
	const lock = dir + '/fetch.lock';
	let fd;
	try {
		fd = openSync(lock, 'wx', 0o600);
	} catch {
		console.log('STOPPED: fetch lock exists');
		return;
	}
	try {
		const auth = new google.auth.OAuth2(
			client.client_id,
			client.client_secret,
			'http://127.0.0.1:8765/oauth2callback'
		);
		auth.setCredentials(token);
		auth.on('tokens', (t) => {
			token = { ...token, ...t };
			save(dir + '/token.json', token);
		});
		const access = await auth.getAccessToken();
		const info = await auth.getTokenInfo(access.token);
		if (info.scopes.length !== 1 || info.scopes[0] !== SCOPE) throw Error('scope');
		const gmail = google.gmail({ version: 'v1', auth });
		let checkpoint;
		try {
			checkpoint = read(dir + '/checkpoint.json');
		} catch {
			checkpoint = {};
		}
		const selection = createHash('sha256')
			.update(JSON.stringify([config.account, [...config.labelIds].sort()]))
			.digest('hex');
		if (checkpoint.selection !== selection) checkpoint = {};
		const now = Date.now();
		const floor = lowerBound(now, checkpoint.completedAt);
		const { data: list } = await retry(() =>
			gmail.users.messages.list(
				{
					userId: 'me',
					labelIds: config.labelIds,
					q: `after:${Math.floor(floor / 1000)} -in:spam -in:trash`,
					maxResults: config.maxMessages
				},
				{ timeout: 20000, retry: false }
			)
		);
		const bearer = readFileSync(dir + '/ingest-token', 'utf8').trim();
		const post = async (messageId, partId, mime, content, receivedAt) => {
			if (Buffer.from(content, 'base64').length > 8 * 1024 * 1024) throw Error('oversize');
			const response = await retry(async () => {
				const r = await fetch(new URL('/api/integrations/gmail/evidence', config.backend), {
					method: 'POST',
					redirect: 'error',
					signal: AbortSignal.timeout(20000),
					headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json' },
					body: JSON.stringify({
						account: config.account,
						messageId,
						partId,
						mime,
						content: Buffer.from(content, 'base64url').toString('base64'),
						receivedAt
					})
				});
				if (!r.ok) {
					const e = Error('backend');
					e.code = r.status;
					throw e;
				}
				return r;
			});
			await response.arrayBuffer();
		};
		let count = 0;
		for (const m of list.messages ?? []) {
			const { data: full } = await retry(() =>
				gmail.users.messages.get(
					{ userId: 'me', id: m.id, format: 'full' },
					{ timeout: 20000, retry: false }
				)
			);
			const at = Number(full.internalDate);
			if (!Number.isFinite(at) || at < floor || at > now) throw Error('date');
			if (!config.labelIds.every((l) => full.labelIds?.includes(l))) throw Error('allowlist');
			if (Number(full.sizeEstimate) > 8 * 1024 * 1024) throw Error('oversize');
			const receivedAt = new Date(at).toISOString();
			const { data: raw } = await retry(() =>
				gmail.users.messages.get(
					{ userId: 'me', id: m.id, format: 'raw' },
					{ timeout: 20000, retry: false }
				)
			);
			if (!raw.raw) throw Error('raw');
			await post(m.id, 'raw', 'message/rfc822', raw.raw, receivedAt);
			const walk = async (part) => {
				if (part.mimeType === 'application/pdf') {
					if (Number(part.body?.size) > 8 * 1024 * 1024) throw Error('oversize');
					let data = part.body?.data;
					if (!data && part.body?.attachmentId) {
						const r = await retry(() =>
							gmail.users.messages.attachments.get(
								{ userId: 'me', messageId: m.id, id: part.body.attachmentId },
								{ timeout: 20000, retry: false }
							)
						);
						data = r.data.data;
					}
					if (!data) throw Error('attachment');
					await post(m.id, part.partId || 'pdf', 'application/pdf', data, receivedAt);
				}
				for (const p of part.parts ?? []) await walk(p);
			};
			if (full.payload) await walk(full.payload);
			count++;
		}
		// No advancing past a truncated batch. Operator must narrow labels if the cap is reached.
		if (!list.nextPageToken) save(dir + '/checkpoint.json', { completedAt: now, selection });
		console.log(
			JSON.stringify({
				importedMessages: count,
				checkpointAdvanced: !list.nextPageToken,
				state: list.nextPageToken ? 'bounded_batch_requires_narrower_allowlist' : 'complete'
			})
		);
	} finally {
		closeSync(fd);
		unlinkSync(lock);
	}
}
main().catch(() => {
	console.error(
		'STOPPED: fetch failed; checkpoint not advanced. Check OAuth, limits and service health locally.'
	);
	process.exitCode = 1;
});
