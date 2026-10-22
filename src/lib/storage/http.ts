import type { AccountingStorage } from './accounting';

export function createHttpAccountingStorage(fetcher: typeof fetch = fetch): AccountingStorage {
	async function request<T>(resource: string, body?: unknown): Promise<T> {
		const response = await fetcher(`/api/accounting/${resource}`, {
			method: body ? 'POST' : 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: body ? { 'content-type': 'application/json' } : {},
			body: body ? JSON.stringify(body) : undefined
		});
		if (!response.ok) {
			if (response.status === 401)
				throw new Error('セッションが切れました。再ログインしてください。');
			const data = await response.json();
			throw new Error(data.message || '保存・読込に失敗しました');
		}
		return response.json();
	}
	return {
		listAccounts: () => request('accounts'),
		listJournals: () => request('journals'),
		createJournal: async (journal, requestId) => {
			const result = await request<{ id: string }>('journals', { journal, requestId });
			return result.id;
		}
	};
}
