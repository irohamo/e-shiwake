#!/usr/bin/env node
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const home = homedir();
process.umask(0o077);
const logDir = join(home, '.local/state/e-shiwake');
mkdirSync(logDir, { recursive: true, mode: 0o700 });
const audit = (data) =>
	appendFileSync(
		join(logDir, 'expense-audit.jsonl'),
		JSON.stringify({ at: new Date().toISOString(), ...data }) + '\n',
		{ mode: 0o600 }
	);
function uuid(name) {
	const h = createHash('sha1')
		.update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
		.update(name)
		.digest();
	h[6] = (h[6] & 15) | 80;
	h[8] = (h[8] & 63) | 128;
	const x = h.subarray(0, 16).toString('hex');
	return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
let requestId;
try {
	const input = readFileSync(0, 'utf8');
	if (Buffer.byteLength(input) > 12 * 1024 * 1024) throw Error('input_too_large');
	const p = JSON.parse(input);
	for (const k of ['source', 'messageId', 'vendor', 'subject'])
		if (typeof p[k] !== 'string' || !p[k].trim() || p[k].length > 500 || /[\r\n\0]/.test(p[k]))
			throw Error('invalid_' + k);
	if (!['icloud', 'gmail'].includes(p.source)) throw Error('invalid_source');
	if (
		!/^\d{4}-\d\d-\d\d$/.test(p.date) ||
		Number.isNaN(Date.parse(p.date)) ||
		new Date(p.date).toISOString().slice(0, 10) !== p.date
	)
		throw Error('invalid_date');
	if (
		!Number.isSafeInteger(p.amount) ||
		p.amount <= 0 ||
		p.amount > 1e12 ||
		![undefined, null, 0, 8, 10].includes(p.taxRate)
	)
		throw Error('invalid_amount_or_tax');
	if (typeof p.receivedAt !== 'string' || Number.isNaN(Date.parse(p.receivedAt)))
		throw Error('invalid_receivedAt');
	if (p.invoiceNo !== undefined && (typeof p.invoiceNo !== 'string' || p.invoiceNo.length > 100))
		throw Error('invalid_invoiceNo');
	requestId = uuid(p.source + '\0' + p.messageId);
	const rules = JSON.parse(readFileSync(join(home, '.config/e-shiwake/vendor-rules.json'), 'utf8'));
	const key = p.vendor.trim().toLowerCase();
	const rule = rules.vendors[key];
	if (
		rule?.skip ||
		/ahamo|emails\.povo\.jp/i.test(p.vendor) ||
		(/freee/i.test(p.vendor) && p.subject.includes('請求書送付のご案内'))
	) {
		audit({ requestId, result: 'skipped' });
		console.log(JSON.stringify({ requestId, skipped: true }));
		process.exit(0);
	}
	const businessRatio = rule?.businessRatio === undefined ? 100 : rule.businessRatio;
	if (!Number.isInteger(businessRatio) || businessRatio < 0 || businessRatio > 100)
		throw Error('invalid_rule_ratio');
	const base = new URL(process.env.ESHIWAKE_URL || 'http://127.0.0.1:3000');
	if (
		base.username ||
		base.password ||
		!['http:', 'https:'].includes(base.protocol) ||
		(base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
	)
		throw Error('invalid_url');
	const agent = readFileSync(join(home, '.config/e-shiwake/agent-token'), 'utf8').trim();
	const ingest = readFileSync(
		join(home, '.local/share/e-shiwake-gmail/ingest-token'),
		'utf8'
	).trim();
	async function post(path, body, token) {
		const r = await fetch(new URL(path, base), {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!r.ok) throw Error('http_' + r.status + '_' + path);
		return r.json();
	}
	let content = p.raw;
	if (
		content !== undefined &&
		(typeof content !== 'string' || Buffer.from(content, 'base64').toString('base64') !== content)
	)
		throw Error('invalid_raw');
	if (content && Buffer.from(content, 'base64').length > 8 * 1024 * 1024)
		throw Error('raw_too_large');
	const hasRaw = !!content;
	if (!content)
		content = Buffer.from(
			'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nSubject: Payload snapshot (not original MIME)\r\n\r\n' +
				JSON.stringify(p)
		).toString('base64');
	const e = await post(
		'/api/integrations/gmail/evidence',
		{
			account: p.source,
			messageId: createHash('sha256').update(p.messageId).digest('hex'),
			partId: 'raw',
			mime: 'message/rfc822',
			content,
			receivedAt: new Date(p.receivedAt).toISOString()
		},
		ingest
	);
	const questions = [];
	if (businessRatio !== 100)
		questions.push(`家事按分（事業割合 ${businessRatio}%）の計算・承認方法を確認してください`);
	if (!rule || rule.review) questions.push('用途・科目・税区分を確認してください');
	if (!hasRaw) questions.push('原本MIME未提供：ペイロード写しを保管しています');
	const taxRate = p.taxRate ?? rules.defaultTaxRate ?? 10;
	if (![0, 8, 10].includes(taxRate)) throw Error('invalid_rule_tax');
	const debit = rule?.debit || rules.fallbackDebit;
	if (!/^\d{4}$/.test(debit)) throw Error('invalid_rule_account');
	const proposal = {
		requestId,
		status: 'pending',
		businessRatio,
		questions,
		rationale: JSON.stringify({
			source: p.source,
			messageId: p.messageId,
			evidenceId: e.id,
			rule: key,
			taxRate: p.taxRate ?? null,
			invoiceNo: p.invoiceNo || null,
			originalMime: hasRaw
		}),
		journal: {
			date: p.date,
			vendor: p.vendor,
			description: p.subject,
			evidenceStatus: 'none',
			attachments: [],
			lines: [
				{
					id: uuid(requestId + 'debit'),
					type: 'debit',
					accountCode: debit,
					amount: p.amount,
					taxCategory:
						taxRate === 10
							? 'purchase_10'
							: taxRate === 8
								? 'purchase_8'
								: taxRate === 0
									? 'out_of_scope'
									: 'na'
				},
				{
					id: uuid(requestId + 'credit'),
					type: 'credit',
					accountCode: '3003',
					amount: p.amount,
					taxCategory: 'out_of_scope'
				}
			]
		}
	};
	const result = await post('/api/agent/proposals', proposal, agent);
	const link = await post('/api/agent/evidence-link', { id: e.id, proposalId: result.id }, agent);
	const out = {
		requestId,
		evidenceId: e.id,
		proposalId: result.id,
		duplicate: e.duplicate && link.duplicate,
		status: 'pending'
	};
	audit({ ...out, result: 'ok' });
	console.log(JSON.stringify(out));
} catch (e) {
	// Never echo payloads, credentials, raw messages, or server response bodies.
	const code = /^(invalid_|input_too_large|raw_too_large|http_)/.test(e.message)
		? e.message
		: 'ingest_failed';
	audit({ requestId, result: 'error', code });
	console.error(JSON.stringify({ error: code, requestId }));
	process.exitCode = 1;
}
