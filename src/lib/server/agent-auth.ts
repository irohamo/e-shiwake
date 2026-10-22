import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function authenticateAgent(header: string | null, hashFile: string | undefined) {
	if (!hashFile || !header?.startsWith('Bearer ')) return false;
	const token = header.slice(7);
	if (!/^[a-f0-9]{64}$/.test(token)) return false;
	const hash = readFileSync(hashFile, 'utf8').trim();
	if (!/^[a-f0-9]{64}$/.test(hash)) return false;
	return timingSafeEqual(Buffer.from(hash, 'hex'), createHash('sha256').update(token).digest());
}
