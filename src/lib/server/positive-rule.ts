import { createHash } from 'node:crypto';
import type { EvidenceService } from './evidence';
import type { ProposalInput } from './workflow-schema';
export interface PositiveRule {
	auto?: boolean;
	debit?: string;
	businessRatio?: number;
	sender?: string;
	subjectIncludes?: string;
	skip?: boolean;
	review?: boolean;
}
export interface VendorRules {
	version: number;
	defaultTaxRate?: 10;
	vendors: Record<string, PositiveRule>;
}
function headers(raw: Buffer) {
	const boundary = raw.indexOf('\r\n\r\n');
	if (boundary < 0 || boundary > 65536) return null;
	const unfolded = raw
		.subarray(0, boundary)
		.toString('utf8')
		.replace(/\r\n[ \t]+/g, ' ');
	const result: Record<string, string> = {};
	const authenticationResults: string[] = [];
	for (const line of unfolded.split('\r\n')) {
		const at = line.indexOf(':');
		if (at < 1) return null;
		const key = line.slice(0, at).toLowerCase();
		if (['from', 'subject', 'message-id'].includes(key) && key in result) return null;
		const value = line.slice(at + 1).trim();
		if (key === 'authentication-results') authenticationResults.push(value);
		result[key] = value;
	}
	result.subject = (result.subject || '')
		.replace(/\?=\s+=\?/g, '?==?')
		.replace(/=\?(utf-8|us-ascii)\?([bq])\?([^?]*)\?=/gi, (_m, _c, encoding, value) => {
			if (encoding.toLowerCase() === 'b') return Buffer.from(value, 'base64').toString('utf8');
			return Buffer.from(
				value
					.replace(/_/g, ' ')
					.replace(/=([0-9A-F]{2})/gi, (_m: string, h: string) =>
						String.fromCharCode(parseInt(h, 16))
					),
				'binary'
			).toString('utf8');
		});
	return {
		from: result.from,
		subject: result.subject,
		'message-id': result['message-id'],
		authenticationResults
	};
}
// Authentication-Results is supplied by the trusted mailbox collector, not verified
// cryptographically here. DKIM-Signature alone never proves a successful check.
// Parse the complete field before considering any pass result. Delimiters inside
// quoted strings/comments are data, never additional authentication clauses.
function authenticationClauses(input: string) {
	let at = 0;
	let invalid = false;
	function cfws() {
		const start = at;
		while (at < input.length) {
			if (/[ \t]/.test(input[at])) {
				at++;
			} else if (input[at] === '(') {
				at++;
				let depth = 1;
				while (at < input.length && depth) {
					const ch = input[at++];
					if (ch === '\\') {
						if (at === input.length) invalid = true;
						else at++;
					} else if (ch === '(') depth++;
					else if (ch === ')') depth--;
				}
				if (depth) invalid = true;
			} else break;
		}
		return at > start;
	}
	function take(pattern: RegExp): string | null {
		const match = input.slice(at).match(pattern);
		if (!match) return null;
		at += match[0].length;
		return match[0].toLowerCase();
	}
	function value(): string | null {
		if (input[at] !== '"') return take(/^[^\s=;()"\\]+/);
		at++;
		let decoded = '';
		while (at < input.length) {
			const ch = input[at++];
			if (ch === '"') return decoded.toLowerCase();
			if (ch === '\\') {
				if (at === input.length) return null;
				decoded += input[at++];
			} else decoded += ch;
		}
		return null;
	}
	// Headers are already unfolded. Reject control characters, including bare CR/LF.
	for (const ch of input) {
		const code = ch.charCodeAt(0);
		if ((code < 32 && code !== 9) || code === 127) return null;
	}
	cfws();
	if (value() === null) return null; // authserv-id; no allowlist existed here.
	if (cfws() && input[at] !== ';') {
		if (!take(/^[0-9]+/)) return null;
		cfws();
	}
	const clauses: { method: string; result: string; properties: Map<string, string> }[] = [];
	while (at < input.length && !invalid) {
		if (input[at++] !== ';') return null;
		cfws();
		const method = take(/^[a-z][a-z0-9_-]*/i);
		if (!method) return null;
		cfws();
		if (method === 'none') return !invalid && !clauses.length && at === input.length ? [] : null;
		// Method versions remain unsupported for positive matching.
		let version = '';
		if (input[at] === '/') {
			at++;
			cfws();
			const number = take(/^[0-9]+/);
			if (!number) return null;
			version = '/' + number;
			cfws();
		}
		if (input[at++] !== '=') return null;
		cfws();
		const result = take(/^[a-z][a-z0-9_-]*/i);
		if (!result) return null;
		const properties = new Map<string, string>();
		while (at < input.length) {
			const separated = cfws();
			if (at === input.length || input[at] === ';') break;
			if (!separated) return null;
			let key = take(/^[a-z][a-z0-9_-]*/i);
			if (!key) return null;
			cfws();
			if (input[at] === '.') {
				at++;
				cfws();
				const property = take(/^[a-z][a-z0-9_-]*/i);
				if (!property) return null;
				key += '.' + property;
				cfws();
			} else if (key !== 'reason') return null;
			if (input[at++] !== '=' || properties.has(key)) return null;
			cfws();
			const parsed = value();
			if (parsed === null) return null;
			properties.set(key, parsed);
		}
		clauses.push({ method: method + version, result, properties });
	}
	return invalid || !clauses.length ? null : clauses;
}
export function senderDkimPass(results: string[], domain: string) {
	return results.some((result) => {
		const clauses = authenticationClauses(result);
		return (
			clauses?.some(({ method, result, properties }) => {
				if (method !== 'dkim' || result !== 'pass') return false;
				// Prefer the actual signing domain. An explicit mismatching header.d cannot
				// be rescued by header.i. Exact alignment deliberately excludes subdomains.
				const signingDomain = properties.get('header.d');
				if (signingDomain !== undefined) return signingDomain === domain;
				const identity = properties.get('header.i');
				return (
					identity !== undefined &&
					/^[^@]*@[^@]+$/.test(identity) &&
					identity.slice(identity.lastIndexOf('@') + 1) === domain
				);
			}) ?? false
		);
	});
}
// Called only inside EvidenceService.review's transaction, after original/hash checks.
export function autoApproveEvidence(
	e: EvidenceService,
	id: string,
	rules: VendorRules | undefined,
	checks: Record<string, unknown>
) {
	if (
		rules?.version !== 1 ||
		!rules.vendors ||
		checks.original !== true ||
		checks.contentDuplicate ||
		checks.closedYear
	)
		return null;
	const evidence = e.db.prepare('SELECT * FROM gmail_evidence WHERE id=?').get(id) as {
		proposal_id: string | null;
		account: string;
		message_id: string;
	};
	if (!evidence.proposal_id) return null;
	const p = e.db.prepare('SELECT * FROM proposals WHERE id=?').get(evidence.proposal_id) as {
		version: number;
		status: string;
		journal: string;
		rationale: string;
		questions: string;
		business_ratio: number;
	};
	if (p.status !== 'pending' || p.business_ratio !== 100 || JSON.parse(p.questions).length)
		return null;
	const journal = JSON.parse(p.journal) as ProposalInput['journal'];
	const key = journal.vendor.trim().toLowerCase();
	const rule = rules.vendors[key];
	if (
		rule?.auto !== true ||
		rule.skip ||
		rule.review ||
		!rule.sender ||
		!rule.subjectIncludes ||
		!rule.debit
	)
		return null;
	let metadata;
	try {
		metadata = JSON.parse(p.rationale);
	} catch {
		return null;
	}
	if (
		metadata.rule !== key ||
		metadata.originalMime !== true ||
		metadata.evidenceId !== id ||
		metadata.source !== evidence.account ||
		typeof metadata.messageId !== 'string' ||
		createHash('sha256').update(metadata.messageId).digest('hex') !== evidence.message_id
	)
		return null;
	const original = e.original(id);
	if (original.mime !== 'message/rfc822') return null;
	const h = headers(original.data);
	if (
		!h ||
		h['message-id'] !== metadata.messageId ||
		h.subject !== journal.description ||
		!h.subject.includes(rule.subjectIncludes)
	)
		return null;
	const from = h.from?.match(/^(?:[^<>]*<)?([^<>\s,;]+@[^<>\s,;]+)>?$/)?.[1].toLowerCase();
	if (!from || from !== rule.sender.toLowerCase()) return null;
	const senderDomain = from.slice(from.lastIndexOf('@') + 1);
	checks.senderDkimPass = senderDkimPass(h.authenticationResults, senderDomain);
	if (!checks.senderDkimPass) return null;
	if (journal.lines.length !== 2) return null;
	const debit = journal.lines.find((l) => l.type === 'debit');
	const credit = journal.lines.find((l) => l.type === 'credit');
	// Preserve the extracted rate; only an explicitly unknown receipt rate uses the owner default.
	const taxRate = metadata.taxRate === null ? (rules.defaultTaxRate ?? 10) : metadata.taxRate;
	const tax =
		taxRate === 10
			? 'purchase_10'
			: taxRate === 8
				? 'purchase_8'
				: taxRate === 0
					? 'out_of_scope'
					: null;
	if (
		!debit ||
		!credit ||
		!tax ||
		debit.accountCode !== rule.debit ||
		credit.accountCode !== '3003' ||
		debit.amount !== credit.amount ||
		!Number.isSafeInteger(debit.amount) ||
		debit.amount <= 0 ||
		debit.taxCategory !== tax ||
		credit.taxCategory !== 'out_of_scope'
	)
		return null;
	const result = e.workflow.decide(
		evidence.proposal_id,
		p.version,
		'approve',
		undefined,
		'backend-policy'
	);
	e.workflow.audit('backend-policy', 'proposal.auto-approve', evidence.proposal_id, {
		policy: 'positive-rule-v1',
		rule: key,
		evidenceId: id,
		evidenceHash: e.row(id).hash,
		proposalVersion: p.version,
		journalId: result.journalId
	});
	return { rule: key, journalId: result.journalId, proposalVersion: p.version };
}
