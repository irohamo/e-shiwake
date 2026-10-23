import { readFileSync } from 'node:fs';
import type { VendorRules } from './positive-rule';
import { env } from '$env/dynamic/private';
import { getStorage } from './runtime';
import { EvidenceService } from './evidence';
export function getEvidence() {
	if (!env.ACCOUNTING_EVIDENCE_PATH) throw new Error('Private evidence storage is not configured');
	let rules: VendorRules | undefined;
	if (env.ACCOUNTING_EXPENSE_RULES_FILE) {
		try {
			rules = JSON.parse(readFileSync(env.ACCOUNTING_EXPENSE_RULES_FILE, 'utf8'));
		} catch {
			rules = undefined;
		} // Fail closed: keep evidence in manual review.
	}
	return new EvidenceService(getStorage(), env.ACCOUNTING_EVIDENCE_PATH, rules);
}
