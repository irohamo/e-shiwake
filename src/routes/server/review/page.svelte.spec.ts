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
beforeEach(() => {
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
			return { ok: true };
		}
		throw new Error('Unexpected request');
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('承認待ちの操作', () => {
	it('チェックボックスなしで承認でき、残った候補もボタンだけで承認できる', async () => {
		render(ReviewPage);
		const a = page.getByRole('article', { name: '仕訳候補：候補A' });
		const b = page.getByRole('article', { name: '仕訳候補：候補B' });
		await expect.element(a.getByRole('button', { name: '承認して帳簿に反映' })).toBeEnabled();
		await expect.element(page.getByRole('checkbox')).not.toBeInTheDocument();
		await a.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect.element(a).not.toBeInTheDocument();
		expect(workflowRequest).toHaveBeenCalledWith('decision', {
			id: 'proposal-0',
			version: 1,
			action: 'approve'
		});
		await b.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect.element(b).not.toBeInTheDocument();
		expect(workflowRequest).toHaveBeenCalledWith('decision', {
			id: 'proposal-1',
			version: 1,
			action: 'approve'
		});
	});
	it('再読込後は最新の版を承認リクエストに送信する', async () => {
		render(ReviewPage);
		const b = page.getByRole('article', { name: '仕訳候補：候補B' });
		await expect.element(b).toBeInTheDocument();
		proposals[1].version = 2;
		await page.getByRole('button', { name: '再読込' }).click();
		await b.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect.element(b).not.toBeInTheDocument();
		expect(workflowRequest).toHaveBeenCalledWith('decision', {
			id: 'proposal-1',
			version: 2,
			action: 'approve'
		});
	});
	it('承認APIの検証エラーを表示し、候補を承認済みにしない', async () => {
		render(ReviewPage);
		const a = page.getByRole('article', { name: '仕訳候補：候補A' });
		await expect.element(a).toBeInTheDocument();
		vi.mocked(workflowRequest).mockRejectedValueOnce(new Error('事業利用割合を確認してください'));
		await a.getByRole('button', { name: '承認して帳簿に反映' }).click();
		await expect
			.element(page.getByRole('alert'))
			.toHaveTextContent('事業利用割合を確認してください');
		await expect.element(a).toBeInTheDocument();
		await expect.element(a.getByRole('button', { name: '承認して帳簿に反映' })).toBeEnabled();
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
