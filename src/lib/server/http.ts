import { error } from '@sveltejs/kit';
/** Read a bounded body even if Content-Length is absent or forged. */
export async function readJson(request: Request, maxBytes = 128 * 1024): Promise<unknown> {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		error(415, 'JSONのみ受け付けます');
	const length = request.headers.get('content-length');
	if (length && /^\d+$/.test(length) && Number(length) > maxBytes) error(413, '本文が大きすぎます');
	const reader = request.body?.getReader();
	if (!reader) error(400, '本文がありません');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			reader.releaseLock();
			error(413, '本文が大きすぎます');
		}
		chunks.push(value);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		error(400, '不正なJSONです');
	}
}
