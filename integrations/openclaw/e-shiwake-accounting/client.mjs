import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [command, period] = process.argv.slice(2);
const read = new Set([
	'accounts',
	'transactions',
	'proposals',
	'journals',
	'status',
	'trial-balance',
	'profit-loss',
	'balance-sheet'
]);
const post = { 'create-proposal': 'proposals', annotate: 'annotations' };
if (!read.has(command) && !Object.hasOwn(post, command)) throw new Error('Command not allowed');
const base = new URL(process.env.ESHIWAKE_URL || 'http://127.0.0.1:3000');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
	throw new Error('Invalid accounting URL');
if (
	base.protocol === 'http:' &&
	!['127.0.0.1', 'localhost', '[::1]', 'accounting'].includes(base.hostname)
)
	throw new Error('HTTP is allowed only on loopback or the private accounting Docker network');
const token = readFileSync(
	process.env.ESHIWAKE_AGENT_TOKEN_FILE || join(homedir(), '.config/e-shiwake/agent-token'),
	'utf8'
).trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid Agent token file');
const url = new URL(`/api/agent/${post[command] || command}`, base);
if (period) {
	if (/^\d{4}$/.test(period)) url.searchParams.set('year', period);
	else if (
		/^\d{4}-(0[1-9]|1[0-2])$/.test(period) &&
		['profit-loss', 'trial-balance', 'journals'].includes(command)
	)
		url.searchParams.set('month', period);
	else throw new Error('Period must be YYYY or supported YYYY-MM');
}
let body;
if (post[command]) {
	const text = readFileSync(0, 'utf8');
	if (Buffer.byteLength(text) > 120000) throw new Error('Payload too large');
	body = JSON.stringify(JSON.parse(text));
}
const response = await fetch(url, {
	method: body ? 'POST' : 'GET',
	redirect: 'error',
	signal: AbortSignal.timeout(15000),
	headers: {
		authorization: `Bearer ${token}`,
		...(body ? { 'content-type': 'application/json' } : {})
	},
	body
});
if (!response.ok) {
	const data = await response.json().catch(() => ({ message: 'Request failed' }));
	throw new Error(`Accounting API ${response.status}: ${data.message}`);
}
console.log(JSON.stringify(await response.json(), null, 2));
