import { google } from 'googleapis';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { stateDir, read, save, SCOPE } from './common.mjs';
const dir = stateDir();
const c = read(dir + '/client.json').installed;
if (!c?.client_id || !c.client_secret) throw Error('Desktop OAuth client.json required');
const redirect = 'http://127.0.0.1:8765/oauth2callback';
const auth = new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
const state = randomBytes(32).toString('hex');
const { codeVerifier, codeChallenge } = await auth.generateCodeVerifierAsync();
const server = createServer(async (req, res) => {
	const url = new URL(req.url, redirect);
	if (
		url.pathname !== '/oauth2callback' ||
		url.searchParams.get('state') !== state ||
		!url.searchParams.get('code')
	) {
		res.writeHead(400);
		res.end('Invalid callback');
		return;
	}
	try {
		const { tokens } = await auth.getToken({ code: url.searchParams.get('code'), codeVerifier });
		auth.setCredentials(tokens);
		const info = await auth.getTokenInfo(tokens.access_token);
		if (info.scopes.length !== 1 || info.scopes[0] !== SCOPE || !tokens.refresh_token)
			throw Error('Readonly-only offline grant required');
		save(dir + '/token.json', tokens);
		res.end('Connected. You may close this tab.');
		server.close();
	} catch {
		res.writeHead(400);
		res.end('Authorization failed; retry locally.');
		server.close();
	}
});
server.listen(8765, '127.0.0.1', () =>
	process.stdout.write(
		auth.generateAuthUrl({
			access_type: 'offline',
			scope: [SCOPE],
			state,
			prompt: 'consent',
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			include_granted_scopes: false
		}) + '\n'
	)
);
setTimeout(() => server.close(), 5 * 60 * 1000).unref();
