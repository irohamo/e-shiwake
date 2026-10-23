import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const executable = resolve('integrations/expense/ingest.mjs');
test('host intake retry, unknown tax, exclusions and conflict behavior', async (t) => {
	const home = mkdtempSync(join(tmpdir(), 'expense-cli-test-'));
	const requests = [];
	const evidence = new Map();
	const proposals = new Map();
	const links = new Map();
	const server = createServer(async (req, res) => {
		let text = '';
		for await (const chunk of req) text += chunk;
		const p = JSON.parse(text);
		requests.push({ path: req.url, p });
		res.setHeader('content-type', 'application/json');
		const reply = (code, value) => {
			res.statusCode = code;
			res.end(JSON.stringify(value));
		};
		if (req.url === '/api/integrations/gmail/evidence') {
			const key = JSON.stringify([p.account, p.messageId, p.partId]);
			const old = evidence.get(key);
			if (old && old.content !== p.content) return reply(409, {});
			if (old) return reply(201, { id: old.id, duplicate: true });
			const id = randomUUID();
			evidence.set(key, { id, content: p.content });
			return reply(201, { id, duplicate: false });
		}
		if (req.url === '/api/agent/proposals') {
			const old = proposals.get(p.requestId);
			if (old && old.text !== text) return reply(409, {});
			const id = old?.id || randomUUID();
			proposals.set(p.requestId, { id, text });
			return reply(201, { id });
		}
		if (req.url === '/api/agent/evidence-link') {
			const duplicate = links.has(p.id);
			links.set(p.id, p.proposalId);
			return reply(200, { linked: true, duplicate });
		}
		reply(404, {});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	try {
		mkdirSync(join(home, '.config/e-shiwake'), { recursive: true });
		mkdirSync(join(home, '.local/share/e-shiwake-gmail'), { recursive: true });
		writeFileSync(join(home, '.config/e-shiwake/agent-token'), 'fixture');
		writeFileSync(join(home, '.local/share/e-shiwake-gmail/ingest-token'), 'fixture');
		writeFileSync(
			join(home, '.config/e-shiwake/vendor-rules.json'),
			JSON.stringify({
				fallbackDebit: '5024',
				defaultTaxRate: 10,
				vendors: { 'google cloud': { debit: '5006', auto: true }, ahamo: { skip: true } }
			})
		);
		async function run(payload, url) {
			const child = spawn(process.execPath, [executable], {
				env: {
					...process.env,
					HOME: home,
					ESHIWAKE_URL: url || `http://127.0.0.1:${server.address().port}`
				},
				stdio: ['pipe', 'pipe', 'pipe']
			});
			let stdout = '',
				stderr = '';
			child.stdout.on('data', (x) => (stdout += x));
			child.stderr.on('data', (x) => (stderr += x));
			child.stdin.end(JSON.stringify(payload));
			const code = await new Promise((r) => child.on('close', r));
			return { code, ...JSON.parse(stdout || stderr) };
		}
		const p = {
			source: 'gmail',
			messageId: 'fixture',
			receivedAt: '2026-10-23T00:00:00Z',
			vendor: 'Google Cloud',
			date: '2026-10-01',
			amount: 63,
			taxRate: 10,
			subject: 'fixture receipt',
			raw: Buffer.from('fixture MIME').toString('base64')
		};
		await t.test('exact retry creates one proposal and deterministic lines', async () => {
			const first = await run(p),
				second = await run(p);
			assert.equal(first.code, 0);
			assert.equal(second.duplicate, true);
			assert.equal(first.proposalId, second.proposalId);
			assert.equal(proposals.size, 1);
			const j = JSON.parse([...proposals.values()][0].text).journal;
			assert.equal(j.lines[0].accountCode, '5006');
			assert.equal(j.lines[1].accountCode, '3003');
			assert.equal(j.lines[1].taxCategory, 'out_of_scope');
			assert.match(first.requestId, /^[\da-f]{8}-[\da-f]{4}-5/);
		});
		await t.test('unstated tax defaults to purchase_10 without a question', async () => {
			assert.equal((await run({ ...p, messageId: 'unknown-tax', taxRate: null })).code, 0);
			const proposal = JSON.parse([...proposals.values()][1].text);
			assert.equal(proposal.journal.lines[0].taxCategory, 'purchase_10');
			assert.equal(proposal.journal.lines[1].taxCategory, 'out_of_scope');
			assert.equal(JSON.parse(proposal.rationale).taxRate, null);
			assert.equal(proposal.questions.length, 0);
		});
		await t.test('explicit rates win and omitted tax retains other review questions', async () => {
			for (const [taxRate, expected] of [
				[0, 'out_of_scope'],
				[8, 'purchase_8'],
				[10, 'purchase_10'],
				[undefined, 'purchase_10']
			]) {
				assert.equal(
					(
						await run({
							...p,
							messageId: `rate-${taxRate}`,
							taxRate,
							vendor: 'unknown',
							raw: undefined
						})
					).code,
					0
				);
				const proposal = JSON.parse([...proposals.values()].at(-1).text);
				assert.equal(proposal.journal.lines[0].taxCategory, expected);
				assert.equal(proposal.questions.length, 2);
			}
		});
		await t.test('personal expense skips before any API calls', async () => {
			const n = requests.length;
			assert.equal((await run({ ...p, vendor: 'ahamo' })).skipped, true);
			assert.equal(requests.length, n);
		});
		await t.test('changed raw on the same key conflicts', async () => {
			assert.equal((await run({ ...p, raw: Buffer.from('different').toString('base64') })).code, 1);
			assert.equal(proposals.size, 6);
		});
		await t.test('vendor ratio defaults to 100 and preserves full amounts', async () => {
			assert.equal(JSON.parse([...proposals.values()][0].text).businessRatio, 100);
			for (const businessRatio of [0, 50, 100]) {
				writeFileSync(
					join(home, '.config/e-shiwake/vendor-rules.json'),
					JSON.stringify({ vendors: { 'google cloud': { debit: '5006', businessRatio } } })
				);
				assert.equal((await run({ ...p, messageId: `ratio-${businessRatio}` })).code, 0);
				const proposal = JSON.parse([...proposals.values()].at(-1).text);
				assert.equal(proposal.businessRatio, businessRatio);
				assert.equal(proposal.status, 'pending');
				assert.deepEqual(
					proposal.journal.lines.map((l) => l.amount),
					[63, 63]
				);
				assert.deepEqual(
					proposal.questions,
					businessRatio === 100
						? []
						: [`家事按分（事業割合 ${businessRatio}%）の計算・承認方法を確認してください`]
				);
			}
		});
		await t.test('invalid vendor ratios fail before API calls', async () => {
			for (const businessRatio of [-1, 101, 50.5, '50', null, true]) {
				writeFileSync(
					join(home, '.config/e-shiwake/vendor-rules.json'),
					JSON.stringify({ vendors: { 'google cloud': { debit: '5006', businessRatio } } })
				);
				const n = requests.length;
				const result = await run({ ...p, messageId: 'invalid-ratio' });
				assert.equal(result.code, 1);
				assert.equal(result.error, 'invalid_rule_ratio');
				assert.equal(requests.length, n);
			}
			writeFileSync(
				join(home, '.config/e-shiwake/vendor-rules.json'),
				JSON.stringify({ vendors: { 'google cloud': { debit: '5006' } } })
			);
		});
		await t.test('non-loopback plaintext URL is rejected', async () => {
			const n = requests.length;
			assert.equal((await run(p, 'http://example.com')).error, 'invalid_url');
			assert.equal(requests.length, n);
		});
	} finally {
		await new Promise((r) => server.close(r));
		rmSync(home, { recursive: true, force: true });
	}
});
