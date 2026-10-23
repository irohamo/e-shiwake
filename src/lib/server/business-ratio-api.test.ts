import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteAccountingStorage } from './sqlite';
import { WorkflowService } from './workflow';
import { getStorage } from './runtime';
import { POST } from '../../routes/api/agent/[resource]/+server';

vi.mock('./runtime', () => ({ getStorage: vi.fn() }));
vi.mock('./evidence-runtime', () => ({ getEvidence: vi.fn() }));
const stores: SqliteAccountingStorage[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup() {
	const store = new SqliteAccountingStorage(':memory:');
	stores.push(store);
	vi.mocked(getStorage).mockReturnValue(store);
	const lineId = randomUUID();
	const proposalId = new WorkflowService(store).createProposal(
		{
			requestId: randomUUID(),
			status: 'pending',
			rationale: 'fixture',
			questions: [],
			journal: {
				date: '2026-10-22',
				vendor: 'fixture',
				description: 'fixture',
				evidenceStatus: 'none',
				attachments: [],
				lines: [
					{ id: lineId, type: 'debit', accountCode: '5006', amount: 1001 },
					{ id: randomUUID(), type: 'credit', accountCode: '3003', amount: 1001 }
				]
			}
		},
		'agent'
	);
	return {
		proposalId,
		version: 1,
		lineId,
		businessRatio: 50,
		originalAmount: 1001,
		reason: 'fixture'
	};
}
const post = (body: unknown) =>
	POST({
		params: { resource: 'business-ratio' },
		request: new Request('http://localhost/api/agent/business-ratio', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0]);
it('handles the business-ratio endpoint and maps stale versions to 409', async () => {
	const input = setup();
	const response = await post(input);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ id: input.proposalId, version: 2 });
	await expect(post(input)).rejects.toMatchObject({ status: 409 });
});
it('rejects invalid or extra body fields with 400 and missing proposals with 409', async () => {
	const input = setup();
	await expect(post({ ...input, businessRatio: 0 })).rejects.toMatchObject({ status: 400 });
	await expect(post({ ...input, extra: true })).rejects.toMatchObject({ status: 400 });
	await expect(post({ ...input, proposalId: randomUUID() })).rejects.toMatchObject({ status: 409 });
});
