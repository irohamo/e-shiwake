import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAccountingStorage, ConflictError } from './sqlite';
import { WorkflowService } from './workflow';
import { journalSchema } from './journal-schema';
import { businessRatioSchema, type ProposalInput } from './workflow-schema';
import { applyBusinessRatio } from '$lib/utils/business-ratio';
import { OWNER_WITHDRAWAL_CODE } from '$lib/constants/accounts';

const stores: SqliteAccountingStorage[] = [];
const dirs: string[] = [];
const open = (path = ':memory:') => {
	const store = new SqliteAccountingStorage(path);
	stores.push(store);
	return store;
};
afterEach(() => {
	stores.splice(0).forEach((s) => s.close());
	dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const proposal = (amount = 1001): ProposalInput => ({
	requestId: randomUUID(),
	status: 'pending',
	rationale: 'fixture',
	questions: [],
	businessRatio: 50,
	journal: {
		date: '2026-10-22',
		vendor: 'fixture vendor',
		description: 'fixture expense',
		evidenceStatus: 'none',
		attachments: [],
		lines: [
			{
				id: randomUUID(),
				type: 'debit',
				accountCode: '5006',
				amount,
				taxCategory: 'purchase_10',
				memo: 'keep'
			},
			{ id: randomUUID(), type: 'credit', accountCode: '3003', amount, taxCategory: 'out_of_scope' }
		]
	}
});
function setup(amount = 1001) {
	const store = open(),
		service = new WorkflowService(store),
		p = proposal(amount);
	const id = service.createProposal(p, 'agent');
	const input = {
		proposalId: id,
		version: 1,
		lineId: p.journal.lines[0].id,
		businessRatio: 50,
		originalAmount: 1001,
		reason: 'documented business use'
	};
	return { store, service, p, id, input };
}
function applied(ratio = 50) {
	const journal = proposal().journal;
	journal.lines = applyBusinessRatio({
		lines: journal.lines,
		targetLineIndex: 0,
		businessRatio: ratio
	}).lines;
	return journal;
}

it.each([0, 1, 50, 100])('accepts canonical %i%% journals including zero amounts', (ratio) => {
	expect(journalSchema.safeParse(applied(ratio)).success).toBe(true);
});
it.each([
	'missing-original',
	'missing-ratio',
	'fraction-original',
	'negative-original',
	'fraction-ratio',
	'ratio-outside',
	'round-up',
	'missing-generated',
	'duplicate-generated',
	'wrong-account',
	'generated-credit',
	'wrong-remainder',
	'applied-credit',
	'orphan-generated',
	'wrong-credit',
	'unknown-field'
])('rejects inconsistent metadata: %s', (scenario) => {
	const j = applied();
	const target = j.lines[0],
		generated = j.lines[1];
	if (scenario === 'missing-original') delete target._originalAmount;
	if (scenario === 'missing-ratio') delete target._businessRatio;
	if (scenario === 'fraction-original') target._originalAmount = 1001.5;
	if (scenario === 'negative-original') target._originalAmount = -1001;
	if (scenario === 'fraction-ratio') target._businessRatio = 50.5;
	if (scenario === 'ratio-outside') target._businessRatio = 101;
	if (scenario === 'round-up') {
		target.amount++;
		generated.amount--;
	}
	if (scenario === 'missing-generated') j.lines.splice(1, 1);
	if (scenario === 'duplicate-generated')
		j.lines.push({ ...generated, id: randomUUID(), amount: 0 });
	if (scenario === 'wrong-account') generated.accountCode = '3003';
	if (scenario === 'generated-credit') generated.type = 'credit';
	if (scenario === 'wrong-remainder') {
		generated.amount++;
		j.lines[2].amount++;
	}
	if (scenario === 'applied-credit') target.type = 'credit';
	if (scenario === 'orphan-generated') {
		delete target._businessRatioApplied;
	}
	if (scenario === 'wrong-credit') {
		j.lines.push({ id: randomUUID(), type: 'debit', accountCode: '5001', amount: 1 });
		j.lines[2].amount++;
	}
	if (scenario === 'unknown-field') Object.assign(target, { unexpected: true });
	expect(journalSchema.safeParse(j).success).toBe(false);
});

it.each(['agent', 'owner'] as const)(
	'applies from original with metadata, version, annotation and audit as %s',
	async (actor) => {
		const { store, service, id, input, p } = setup();
		expect(service.setBusinessRatio(input, actor)).toEqual({ id, version: 2 });
		const saved = service.listProposals()[0];
		expect(saved).toMatchObject({
			status: 'pending',
			version: 2,
			businessRatio: 50,
			questions: [],
			journal: { vendor: p.journal.vendor, description: p.journal.description }
		});
		expect(saved.journal.lines).toEqual([
			{
				...p.journal.lines[0],
				amount: 500,
				_businessRatioApplied: true,
				_originalAmount: 1001,
				_businessRatio: 50
			},
			{
				id: expect.any(String),
				type: 'debit',
				accountCode: OWNER_WITHDRAWAL_CODE,
				amount: 501,
				taxCategory: 'na',
				_businessRatioGenerated: true
			},
			p.journal.lines[1]
		]);
		expect(saved.annotations).toEqual([
			{
				kind: 'classification',
				text: expect.stringContaining('50%（元の金額 1001円）: documented business use'),
				actor,
				at: expect.any(String)
			}
		]);
		const audit = store.db
			.prepare(
				"SELECT actor,entity_id,detail FROM audit_log WHERE action='proposal.business-ratio'"
			)
			.get() as { actor: string; entity_id: string; detail: string };
		expect(audit).toMatchObject({ actor, entity_id: id });
		expect(JSON.parse(audit.detail)).toEqual({
			lineId: input.lineId,
			businessRatio: 50,
			originalAmount: 1001,
			previousAmount: 1001,
			previousVersion: 1,
			reason: input.reason
		});
		expect(await store.listJournals()).toEqual([]);
	}
);
it('uses the original rather than halving an already manually prorated amount again', () => {
	const { service, input } = setup(500);
	service.setBusinessRatio(input, 'agent');
	expect(service.listProposals()[0].journal.lines.map((l) => l.amount)).toEqual([500, 501, 1001]);
});
it('reapplies from a new original and ratio, replaces the generated line, and removes proration at 100%', () => {
	const { service, input } = setup();
	service.setBusinessRatio(input, 'agent');
	const generatedId = service.listProposals()[0].journal.lines[1].id;
	service.setBusinessRatio(
		{ ...input, version: 2, originalAmount: 2003, businessRatio: 33 },
		'owner'
	);
	const saved = service.listProposals()[0];
	expect(saved.journal.lines.map((l) => l.amount)).toEqual([660, 1343, 2003]);
	expect(saved.journal.lines[1].id).not.toBe(generatedId);
	expect(saved.businessRatio).toBe(33);
	service.setBusinessRatio(
		{ ...input, version: 3, originalAmount: 2003, businessRatio: 100 },
		'owner'
	);
	expect(service.listProposals()[0]).toMatchObject({ version: 4, businessRatio: 100 });
	expect(service.listProposals()[0].journal.lines).toEqual([
		{
			id: input.lineId,
			type: 'debit',
			accountCode: '5006',
			amount: 2003,
			taxCategory: 'purchase_10',
			memo: 'keep'
		},
		{ ...proposal().journal.lines[1], id: saved.journal.lines[2].id, amount: 2003 }
	]);
});
it.each([
	'missing',
	'stale',
	'draft',
	'approved',
	'rejected',
	'amount',
	'credit',
	'non-expense',
	'missing-line',
	'generated',
	'multiple-credits',
	'other-debit'
])('conflicts without mutations for %s', (scenario) => {
	const { store, service, input, id } = setup();
	if (scenario === 'missing') input.proposalId = randomUUID();
	if (scenario === 'stale') input.version++;
	if (['draft', 'approved', 'rejected'].includes(scenario))
		store.db.prepare('UPDATE proposals SET status=? WHERE id=?').run(scenario, id);
	if (scenario === 'amount') input.originalAmount = 4444;
	if (scenario === 'missing-line') input.lineId = randomUUID();
	const j = service.listProposals()[0].journal;
	if (scenario === 'credit') input.lineId = j.lines[1].id;
	if (scenario === 'non-expense') j.lines[0].accountCode = '1001';
	if (scenario === 'generated') j.lines[0]._businessRatioGenerated = true;
	if (scenario === 'multiple-credits') j.lines.push({ ...j.lines[1], id: randomUUID(), amount: 0 });
	if (scenario === 'other-debit') {
		j.lines[0].amount--;
		j.lines.push({ ...j.lines[0], id: randomUUID(), amount: 1 });
	}
	store.db.prepare('UPDATE proposals SET journal=? WHERE id=?').run(JSON.stringify(j), id);
	const before = service.listProposals(),
		audits = store.db.prepare('SELECT * FROM audit_log').all();
	expect(() => service.setBusinessRatio(input, 'agent')).toThrow(ConflictError);
	expect(service.listProposals()).toEqual(before);
	expect(store.db.prepare('SELECT * FROM audit_log').all()).toEqual(audits);
});
it('rolls back journal, ratio, version and annotation on audit failure', () => {
	const { store, service, input } = setup();
	const before = service.listProposals();
	store.db.exec(
		"CREATE TRIGGER fail_ratio BEFORE INSERT ON audit_log WHEN NEW.action='proposal.business-ratio' BEGIN SELECT RAISE(ABORT,'audit failure'); END"
	);
	expect(() => service.setBusinessRatio(input, 'agent')).toThrow('audit failure');
	expect(service.listProposals()).toEqual(before);
});
it('approves an applied proposal and persists metadata through posting and reopening', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'business-ratio-'));
	dirs.push(dir);
	const path = join(dir, 'test.sqlite'),
		store = open(path),
		service = new WorkflowService(store),
		p = proposal();
	p.journal = applied();
	const id = service.createProposal(p, 'agent');
	service.decide(id, 1, 'approve');
	expect((await store.listJournals())[0].lines).toEqual(
		p.journal.lines.map((l) => ({
			...l,
			memo: l.memo ?? undefined,
			taxCategory: l.taxCategory ?? undefined
		}))
	);
	store.close();
	stores.splice(stores.indexOf(store), 1);
	const reopened = open(path);
	expect((await reopened.listJournals())[0].lines[0]).toMatchObject({
		_businessRatioApplied: true,
		_originalAmount: 1001,
		_businessRatio: 50
	});
	expect((await reopened.listJournals())[0].lines[1]._businessRatioGenerated).toBe(true);
});
it.each(['unapplied', 'mismatch', 'corrupt'])(
	'refuses approval for %s ratio form',
	async (scenario) => {
		const { store, service, id } = setup();
		if (scenario !== 'unapplied') {
			const j = applied(scenario === 'mismatch' ? 30 : 50);
			if (scenario === 'corrupt') j.lines[1].amount++;
			store.db.prepare('UPDATE proposals SET journal=? WHERE id=?').run(JSON.stringify(j), id);
		}
		expect(() => service.decide(id, 1, 'approve')).toThrow(ConflictError);
		expect(await store.listJournals()).toEqual([]);
	}
);
it('strictly validates the business-ratio command body', () => {
	const { input } = setup();
	expect(businessRatioSchema.safeParse(input).success).toBe(true);
	for (const patch of [
		{ businessRatio: 0 },
		{ businessRatio: 101 },
		{ businessRatio: 50.5 },
		{ originalAmount: 0 },
		{ originalAmount: 1.5 },
		{ version: 0 },
		{ lineId: 'bad' },
		{ proposalId: 'bad' },
		{ reason: '' },
		{ reason: 'x'.repeat(1001) },
		{ unexpected: true }
	]) {
		expect(businessRatioSchema.safeParse({ ...input, ...patch }).success).toBe(false);
	}
});

it('adds metadata storage to an existing book and preserves its earlier journals', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'ratio-upgrade-'));
	dirs.push(dir);
	const path = join(dir, 'test.sqlite'),
		original = open(path);
	const entry = proposal().journal;
	const journalId = original.postJournal(entry, randomUUID());
	original.db.exec('DROP TABLE journal_line_business_ratio');
	original.close();
	stores.splice(stores.indexOf(original), 1);
	const upgraded = open(path);
	expect((await upgraded.listJournals())[0]).toMatchObject({ id: journalId, ...entry });
	const ratioJournal = applied();
	upgraded.postJournal(ratioJournal, randomUUID());
	expect(
		(await upgraded.listJournals()).find((j) => j.id !== journalId)?.lines[0]._businessRatioApplied
	).toBe(true);
});
