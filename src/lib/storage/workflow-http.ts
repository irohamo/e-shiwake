export async function workflowRequest<T>(resource: string, body?: unknown): Promise<T> {
	const response = await fetch(`/api/workflow/${resource}`, {
		method: body ? 'POST' : 'GET',
		cache: 'no-store',
		headers: body ? { 'content-type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!response.ok) {
		const result = await response.json();
		throw new Error(result.message || '処理に失敗しました');
	}
	return response.json();
}
