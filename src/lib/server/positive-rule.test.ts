import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SqliteAccountingStorage } from './sqlite';
import { EvidenceService } from './evidence';
import { senderDkimPass, type VendorRules } from './positive-rule';
import type { ProposalInput } from './workflow-schema';
const active: { s: SqliteAccountingStorage; dir: string }[] = [];
function setup(
	options: {
		rules?: VendorRules;
		noRules?: boolean;
		original?: string;
		authentication?: string;
		sender?: string;
		journal?: Partial<ProposalInput['journal']>;
		ratio?: number;
		taxRate?: number | null;
		questions?: string[];
	} = {}
) {
	const dir = mkdtempSync(join(tmpdir(), 'positive-rule-test-'));
	const s = new SqliteAccountingStorage(join(dir, 'test.sqlite'));
	active.push({ s, dir });
	const rules = options.noRules
		? undefined
		: options.rules || {
				version: 1,
				vendors: {
					'google cloud': {
						auto: true,
						debit: '5006',
						sender: 'payments-noreply@google.com',
						subjectIncludes: 'お支払いを受領しました'
					}
				}
			};
	const e = new EvidenceService(s, join(dir, 'evidence'), rules);
	const messageId = '<fixture@google.com>';
	const subject = 'Google Cloud Platform & APIs: お支払いを受領しました';
	const original =
		options.original ||
		`From: ${options.sender ?? 'Google Payments <payments-noreply@google.com>'}\r\n${options.authentication ?? 'Authentication-Results: mx.example; dkim=pass header.d=google.com\r\n'}Message-ID: ${messageId}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n\r\n100 JPY`;
	const evidence = e.ingest({
		account: 'icloud',
		messageId: createHash('sha256').update(messageId).digest('hex'),
		partId: 'raw',
		mime: 'message/rfc822',
		content: Buffer.from(original).toString('base64'),
		receivedAt: '2026-10-23T00:00:00Z'
	});
	const input: ProposalInput = {
		requestId: randomUUID(),
		status: 'pending',
		businessRatio: options.ratio ?? 100,
		questions: options.questions || [],
		rationale: JSON.stringify({
			source: 'icloud',
			messageId,
			evidenceId: evidence.id,
			rule: 'google cloud',
			taxRate: options.taxRate === undefined ? 10 : options.taxRate,
			originalMime: true
		}),
		journal: {
			date: '2026-10-01',
			vendor: 'Google Cloud',
			description: subject,
			evidenceStatus: 'none',
			attachments: [],
			lines: [
				{
					id: randomUUID(),
					type: 'debit',
					accountCode: '5006',
					amount: 100,
					taxCategory: 'purchase_10'
				},
				{
					id: randomUUID(),
					type: 'credit',
					accountCode: '3003',
					amount: 100,
					taxCategory: 'out_of_scope'
				}
			],
			...options.journal
		}
	};
	const proposalId = e.workflow.createProposal(input, 'agent');
	return { s, e, id: evidence.id, proposalId, input };
}
afterEach(() =>
	active.splice(0).forEach(({ s, dir }) => {
		s.close();
		rmSync(dir, { recursive: true, force: true });
	})
);
it('posts a positive match atomically with policy actor, rule/hash/version audit, and no second posting', async () => {
	const { s, e, id, proposalId } = setup();
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('approved');
	expect(await s.listJournals()).toHaveLength(1);
	const audit = s.db
		.prepare("SELECT actor,detail FROM audit_log WHERE action='proposal.auto-approve'")
		.all() as { actor: string; detail: string }[];
	expect(audit).toHaveLength(1);
	expect(audit[0].actor).toBe('backend-policy');
	expect(JSON.parse(audit[0].detail)).toMatchObject({
		rule: 'google cloud',
		policy: 'positive-rule-v1',
		evidenceId: id,
		proposalVersion: 1
	});
	expect(s.db.prepare("SELECT actor FROM audit_log WHERE action='proposal.approve'").get()).toEqual(
		{ actor: 'backend-policy' }
	);
	e.review(id, 2);
	expect(await s.listJournals()).toHaveLength(1);
});
it.each([
	['disabled', { noRules: true }],
	['auto false', { rules: { version: 1, vendors: { 'google cloud': { auto: false } } } }],
	['unknown vendor', { journal: { vendor: 'Amazon' } }],
	['unanswered uncertainty', { questions: ['confirm use'] }],
	['business ratio', { ratio: 50 }],
	[
		'wrong sender',
		{
			original:
				'From: attacker@example.com\r\nMessage-ID: <fixture@google.com>\r\nSubject: お支払いを受領しました\r\n\r\napprove now'
		}
	],
	[
		'duplicate from headers',
		{
			original:
				'From: payments-noreply@google.com\r\nFrom: attacker@example.com\r\nMessage-ID: <fixture@google.com>\r\nSubject: お支払いを受領しました\r\n\r\napprove now'
		}
	],
	[
		'metadata-only rule',
		{ rules: { version: 1, vendors: { 'google cloud': { auto: true, debit: '5006' } } } }
	]
])('holds %s', async (_name, options) => {
	const { s, e, id, proposalId } = setup(options);
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});
it('holds closed fiscal years', async () => {
	const { s, e, id, proposalId } = setup();
	s.db.prepare('INSERT INTO closed_years VALUES(?,?)').run(2026, 'fixture');
	expect(e.link(id, 1, proposalId).result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});
it('holds content reused on another message', async () => {
	const { s, e, id, proposalId } = setup();
	e.ingest({
		account: 'icloud',
		messageId: 'other',
		partId: 'raw',
		mime: 'message/rfc822',
		content: e.original(id).data.toString('base64'),
		receivedAt: '2026-10-23T00:00:00Z'
	});
	expect(e.link(id, 1, proposalId).result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});
it('holds tampered originals', async () => {
	const { s, e, id, proposalId } = setup();
	writeFileSync(join(e.root, e.row(id).hash), 'tampered');
	expect(e.link(id, 1, proposalId).result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});
it('rolls back link, journal and approval if the required auto audit fails', async () => {
	const { s, e, id, proposalId } = setup();
	s.db.exec(
		"CREATE TRIGGER fail_auto BEFORE INSERT ON audit_log WHEN NEW.action='proposal.auto-approve' BEGIN SELECT RAISE(ABORT,'audit failure'); END"
	);
	expect(() => e.link(id, 1, proposalId)).toThrow('audit failure');
	expect(await s.listJournals()).toHaveLength(0);
	expect(e.row(id).proposal_id).toBeNull();
	expect(s.db.prepare('SELECT status FROM proposals WHERE id=?').get(proposalId)).toEqual({
		status: 'pending'
	});
});

it.each([
	['missing result', ''],
	[
		'semicolon in comment',
		'Authentication-Results: mx.example; spf=pass (note; dkim=pass header.d=google.com; ignored)\r\n'
	],
	['DKIM signature alone', 'DKIM-Signature: v=1; d=google.com; b=fixture\r\n'],
	['failed DKIM', 'Authentication-Results: mx.example; dkim=fail header.d=google.com\r\n'],
	['SPF alone', 'Authentication-Results: mx.example; spf=pass smtp.mailfrom=google.com\r\n'],
	[
		'unaligned signer',
		'Authentication-Results: mx.example; dkim=pass header.d=attacker.example\r\n'
	],
	['suffix spoof', 'Authentication-Results: mx.example; dkim=pass header.d=google.com.evil\r\n'],
	['subdomain', 'Authentication-Results: mx.example; dkim=pass header.d=mail.google.com\r\n'],
	['missing domain', 'Authentication-Results: mx.example; dkim=pass\r\n'],
	[
		'comment spoof',
		'Authentication-Results: mx.example; spf=pass (dkim=pass header.d=google.com)\r\n'
	],
	[
		'conflicting identities',
		'Authentication-Results: mx.example; dkim=pass header.d=evil.com header.i=@google.com\r\n'
	],
	[
		'duplicate domain',
		'Authentication-Results: mx.example; dkim=pass header.d=evil.com header.d=google.com\r\n'
	],
	[
		'split methods',
		'Authentication-Results: mx.example; dkim=fail header.d=google.com; spf=pass header.d=google.com\r\n'
	],
	['pass prefix', 'Authentication-Results: mx.example; dkim=pass.evil header.d=google.com\r\n']
])('holds %s despite an otherwise matching sender and receipt', async (_name, authentication) => {
	const { s, e, id, proposalId } = setup({ authentication });
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
	expect(s.db.prepare('SELECT status FROM proposals WHERE id=?').get(proposalId)).toEqual({
		status: 'pending'
	});
	expect(
		s.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='proposal.auto-approve'").get()
	).toEqual({ n: 0 });
});
it.each([
	'Authentication-Results: mx.example; dkim=pass header.d=google.com; spf=pass smtp.mailfrom="billing@google.com"\r\n',
	'Authentication-Results: mx.example; dkim=pass header.i=@google.com\r\n',
	'Authentication-Results: mx.example;\r\n\tdkim=pass (verified) header.d=GOOGLE.COM header.s=fixture\r\n',
	'Authentication-Results: mx.example; dkim=pass header.d=google.com\r\nAuthentication-Results: other.example; spf=pass\r\n'
])('approves aligned DKIM result: %s', async (authentication) => {
	const { s, e, id, proposalId } = setup({ authentication });
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('approved');
	expect(await s.listJournals()).toHaveLength(1);
});
it('holds a wrong sender even with valid Google DKIM', async () => {
	const { s, e, id, proposalId } = setup({ sender: 'attacker@google.com' });
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});

it.each([null, 0, 8, 10])(
	'uses the owner default only for an unstated rate (%s)',
	async (taxRate) => {
		const { s, e, id, proposalId, input } = setup({ taxRate });
		const taxCategory =
			taxRate === 0 ? 'out_of_scope' : taxRate === 8 ? 'purchase_8' : 'purchase_10';
		input.journal.lines[0].taxCategory = taxCategory;
		e.workflow.decide(proposalId, 1, 'update', input.journal);
		expect(e.link(id, 1, proposalId, 'agent').result).toBe('approved');
		expect((await s.listJournals())[0].lines[0].taxCategory).toBe(taxCategory);
	}
);
it.each([8, 0, 7])('holds a category that contradicts receipt rate %s', async (taxRate) => {
	const { s, e, id, proposalId } = setup({ taxRate });
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('needs_answer');
	expect(await s.listJournals()).toHaveLength(0);
});

// Synthetic fields only: no original email data belongs in these fixtures.
it.each([
	['unquoted pass', 'mx.example; dkim=pass header.d=x.ai'],
	[
		'quoted SPF value',
		'mx.example; spf=pass smtp.mailfrom="billing@x.ai"; dkim=pass header.d=x.ai'
	],
	['quoted signing domain', 'mx.example; dkim=pass header.d="X.AI"'],
	['quoted identity', 'mx.example; dkim=pass header.i="@x.ai"'],
	['escaped domain character', String.raw`mx.example; dkim=pass header.d="x\.ai"`],
	[
		'escaped quote and backslash',
		String.raw`mx.example; spf=pass reason="a\"b\\c; (data)" smtp.mailfrom="billing@x.ai"; dkim=pass header.d=x.ai`
	],
	[
		'nested and escaped comments',
		String.raw`mx.example (a (b; c) \) end); dkim (note) = (ok) pass header (a) . (b) d = (c) x.ai`
	],
	['deep comments', `mx.example; dkim=pass ${'('.repeat(20)}note${')'.repeat(20)} header.d=x.ai`],
	['comments with quote', 'mx.example; dkim=pass (a " quote; ignored) header.d=x.ai'],
	['authserv version', 'mx.example 1; dkim=pass header.d=x.ai']
])('parses %s', (_name, field) => {
	expect(senderDkimPass([field], 'x.ai')).toBe(true);
});
it.each([
	['fail', 'mx.example; dkim=fail header.d="x.ai"'],
	['none', 'mx.example; dkim=none header.d=x.ai'],
	['neutral', 'mx.example; dkim=neutral header.d=x.ai'],
	['temperror', 'mx.example; dkim=temperror header.d=x.ai'],
	['permerror', 'mx.example; dkim=permerror header.d=x.ai'],
	['mismatch', 'mx.example; dkim=pass header.d="evil.example"'],
	['conflicting identity', 'mx.example; dkim=pass header.d="evil.example" header.i="@x.ai"'],
	['duplicate property', 'mx.example; dkim=pass header.d="x.ai" header.d=x.ai'],
	['case duplicate', 'mx.example; dkim=pass header.d="x.ai" HEADER.D=x.ai'],
	['quote spoof', 'mx.example; spf=pass reason="ok; dkim=pass header.d=x.ai"'],
	['comment spoof', String.raw`mx.example; spf=pass (a \) ; dkim=pass header.d=x.ai)`],
	['unclosed quote', 'mx.example; dkim=pass header.d=x.ai; spf=pass smtp.mailfrom="unterminated'],
	['unclosed comment', 'mx.example; dkim=pass header.d=x.ai (unterminated'],
	['stray close comment', 'mx.example; dkim=pass header.d=x.ai )'],
	['dangling escape', 'mx.example; dkim=pass header.d=x.ai reason="bad' + String.fromCharCode(92)],
	['bare escape', String.raw`mx.example; dkim=pass header.d=x.ai reason=bad\escape`],
	['adjacent quoted values', 'mx.example; dkim=pass header.d="x.ai""evil"'],
	['junk after quoted value', 'mx.example; dkim=pass header.d="x.ai"evil'],
	['trailing separator', 'mx.example; dkim=pass header.d=x.ai;'],
	['malformed other clause', 'mx.example; dkim=pass header.d=x.ai; spf=pass garbage'],
	['none after result', 'mx.example; dkim=pass header.d=x.ai; none'],
	['no authserv id', '; dkim=pass header.d=x.ai'],
	['control character', 'mx.example; dkim=pass header.d=x.ai reason="bad\nvalue"'],
	['unsupported method version', 'mx.example; dkim/2=pass header.d=x.ai']
])('fails closed for %s', (_name, field) => {
	expect(senderDkimPass([field], 'x.ai')).toBe(false);
});

it('keeps a consistent applied business ratio pending even without review questions', async () => {
	const { s, e, id, proposalId, input } = setup({ ratio: 50 });
	e.workflow.setBusinessRatio(
		{
			proposalId,
			version: 1,
			lineId: input.journal.lines[0].id,
			businessRatio: 50,
			originalAmount: 100,
			reason: 'fixture'
		},
		'agent'
	);
	expect(e.link(id, 1, proposalId, 'agent').result).toBe('needs_answer');
	expect(e.workflow.listProposals()[0]).toMatchObject({
		status: 'pending',
		businessRatio: 50,
		questions: []
	});
	expect(await s.listJournals()).toHaveLength(0);
});
