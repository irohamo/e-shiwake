import { page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ReviewPage from './+page.svelte';
import { workflowRequest } from '$lib/storage/workflow-http';
import type { Proposal } from '$lib/server/workflow-schema';

vi.mock('$lib/storage/workflow-http', () => ({ workflowRequest: vi.fn() }));
vi.mock('$lib/storage/http', () => ({
	createHttpAccountingStorage: () => ({ listAccounts: async () => [] })
}));

let proposals: Proposal[];
let changeOtherVersion = false;
beforeEach(() => {
	changeOtherVersion = false;
	proposals = ['候補A', '候補B'].map((description, i) => ({
		id: `proposal-${i}`,
		version: 1,
		status: 'pending',
		actor: 'owner',
		journal: {
			date: '2026-10-23',
			description,
			vendor: '',
			evidenceStatus: 'none',
			attachments: [],
			lines: [
				{ id: 'debit', type: 'debit', accountCode: '100', amount: 1000, taxCategory: 'na' },
				{ id: 'credit', type: 'credit', accountCode: '200', amount: 1000, taxCategory: 'na' }
			]
		},
		rationale: '内容を確認してください',
		questions: [],
		annotations: [],
		createdAt: '2026-10-23'
	}));
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('[]', { status: 200 }))
	);
	vi.mocked(workflowRequest).mockImplementation(async (resource, body) => {
		if (resource === 'proposals') return structuredClone(proposals);
		if (resource === 'transactions') return [];
		if (resource === 'decision') {
			const decision = body as { id: string; action: string };
			const proposal = proposals.find((p) => p.id === decision.id)!;
			proposal.status = 'approved';
			if (changeOtherVersion) proposals[1].version++;
			return { ok: true };
		}
		throw new Error('Unexpected request');
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('承認待ちの確認操作', () => {
	it('未確認では承認できず、別候補の承認後も同じ版の確認を保持する', async () => {
		render(ReviewPage);
		const a = page.getByRole('article', { name: '仕訳候補：候補A' });
		const b = page.getByRole('article', { name: '仕訳候補：候補B' });
		await expect.element(a.getByRole('button', { name: '承認して帳簿に反映' })).toBeDisabled();
		await a.getByRole('checkbox').click();
		await b.getByRole('checkbox').click();
		await a.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect.element(a).not.toBeInTheDocument();
		await expect.element(b.getByRole('checkbox')).toBeChecked();
		await expect.element(b.getByRole('button', { name: '承認して帳簿に反映' })).toBeEnabled();
		await page.getByRole('button', { name: '再読込' }).click();
		await expect.element(b.getByRole('checkbox')).not.toBeChecked();
	});
	it('版が変わった候補は再確認を必要とする', async () => {
		changeOtherVersion = true;
		render(ReviewPage);
		const a = page.getByRole('article', { name: '仕訳候補：候補A' });
		const b = page.getByRole('article', { name: '仕訳候補：候補B' });
		await a.getByRole('checkbox').click();
		await b.getByRole('checkbox').click();
		await a.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect.element(a).not.toBeInTheDocument();
		await expect.element(b.getByRole('checkbox')).not.toBeChecked();
		await expect.element(b.getByRole('button', { name: '承認して帳簿に反映' })).toBeDisabled();
	});
	it('読込失敗を空状態と区別し、再読込で復帰できる', async () => {
		vi.mocked(workflowRequest).mockRejectedValueOnce(new Error('接続を確認してください'));
		render(ReviewPage);
		await expect.element(page.getByRole('alert')).toHaveTextContent('接続を確認してください');
		await expect
			.element(page.getByText('確認待ちの候補はありません。', { exact: false }))
			.not.toBeInTheDocument();
		await page.getByRole('button', { name: '再読込' }).click();
		await expect
			.element(page.getByRole('article', { name: '仕訳候補：候補A' }))
			.toBeInTheDocument();
		await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
	});
});
