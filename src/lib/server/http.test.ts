import { it, expect } from 'vitest';
import { readJson } from './http';
it('rejects oversized streamed JSON without Content-Length and invalid input', async () => {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('x'.repeat(131073)));
			controller.close();
		}
	});
	const request = new Request('http://localhost', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: stream,
		duplex: 'half'
	} as RequestInit);
	await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
	await expect(
		readJson(new Request('http://localhost', { method: 'POST', body: '{}' }))
	).rejects.toMatchObject({ status: 415 });
	await expect(
		readJson(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '['
			})
		)
	).rejects.toMatchObject({ status: 400 });
	expect(
		await readJson(
			new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"ok":true}'
			})
		)
	).toEqual({ ok: true });
});
