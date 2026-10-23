import { autoApproveEvidence, type VendorRules } from './positive-rule';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import {
	mkdirSync,
	chmodSync,
	readFileSync,
	writeFileSync,
	lstatSync,
	realpathSync
} from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { ConflictError, type SqliteAccountingStorage } from './sqlite';
import { WorkflowService } from './workflow';
export const evidenceSchema = z
	.object({
		account: z.string().min(1).max(200),
		messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
		partId: z.string().regex(/^[a-zA-Z0-9_.-]{1,200}$/),
		mime: z.enum(['message/rfc822', 'application/pdf']),
		content: z
			.string()
			.min(4)
			.max(11184812)
			.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
		receivedAt: z.iso.datetime()
	})
	.strict();
type Row = { id: string; hash: string; version: number; proposal_id: string | null; mime: string };
export class EvidenceService {
	readonly root: string;
	readonly workflow: WorkflowService;
	constructor(
		readonly storage: SqliteAccountingStorage,
		root: string,
		readonly positiveRules?: VendorRules
	) {
		if (!isAbsolute(root)) throw new Error('Absolute private evidence path required');
		const target = resolve(root);
		if (target === process.cwd() || target.startsWith(process.cwd() + sep))
			throw new Error('Evidence must be outside repository');
		mkdirSync(target, { recursive: true, mode: 0o700 });
		if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target)
			throw new Error('Symlink evidence directory forbidden');
		chmodSync(target, 0o700);
		this.root = target;
		this.workflow = new WorkflowService(storage);
	}
	get db() {
		return this.storage.db;
	}
	row(id: string) {
		const r = this.db.prepare('SELECT * FROM gmail_evidence WHERE id=?').get(id) as Row | undefined;
		if (!r) throw new ConflictError('証憑がありません');
		return r;
	}
	original(id: string) {
		const r = this.row(id);
		const data = readFileSync(join(this.root, r.hash));
		if (createHash('sha256').update(data).digest('hex') !== r.hash)
			throw new ConflictError('原本ハッシュ不一致');
		return { data, mime: r.mime };
	}
	ingest(value: unknown) {
		const p = evidenceSchema.parse(value);
		const data = Buffer.from(p.content, 'base64');
		if (data.length > 8 * 1024 * 1024 || data.toString('base64') !== p.content)
			throw new ConflictError('原本サイズまたはエンコード不正');
		const hash = createHash('sha256').update(data).digest('hex');
		return this.db
			.transaction(() => {
				const old = this.db
					.prepare('SELECT * FROM gmail_evidence WHERE account=? AND message_id=? AND part_id=?')
					.get(p.account, p.messageId, p.partId) as Row | undefined;
				if (old) {
					if (old.hash !== hash || old.mime !== p.mime)
						throw new ConflictError('同じメールpartの内容が異なります');
					this.original(old.id);
					return { id: old.id, duplicate: true };
				}
				const path = join(this.root, hash);
				try {
					writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
					if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash)
						throw new ConflictError('原本ハッシュ不一致');
				}
				const id = randomUUID();
				this.db
					.prepare('INSERT INTO gmail_evidence VALUES(?,?,?,?,?,?,?,?,NULL,1)')
					.run(id, p.account, p.messageId, p.partId, hash, p.mime, data.length, p.receivedAt);
				this.workflow.audit('gmail-ingest', 'evidence.ingest', id, { hash, extractor: 'none-v1' });
				this.review(id, 1);
				return { id, duplicate: false };
			})
			.immediate();
	}
	list() {
		return this.db
			.prepare('SELECT * FROM gmail_evidence ORDER BY received_at DESC LIMIT 500')
			.all()
			.map((r) => {
				const row = r as Row;
				return {
					...row,
					questions: this.db
						.prepare('SELECT * FROM evidence_questions WHERE evidence_id=? ORDER BY rowid')
						.all(row.id),
					reviews: this.db
						.prepare(
							'SELECT * FROM evidence_reviews WHERE evidence_id=? ORDER BY rowid DESC LIMIT 10'
						)
						.all(row.id)
				};
			});
	}
	review(id: string, version: number) {
		return this.db
			.transaction(() => {
				const r = this.row(id);
				if (r.version !== version) throw new ConflictError('証憑は変更済みです');
				const checks: Record<string, unknown> = {
					knownRule: false,
					reason: 'no-approved-accounting-rules',
					evidenceHash: r.hash
				};
				try {
					this.original(id);
					checks.original = true;
				} catch {
					checks.original = false;
				}
				checks.contentDuplicate = !!this.db
					.prepare('SELECT 1 FROM gmail_evidence WHERE hash=? AND id<>?')
					.get(r.hash, id);
				const p = r.proposal_id
					? (this.db
							.prepare('SELECT version,journal,business_ratio FROM proposals WHERE id=?')
							.get(r.proposal_id) as {
							version: number;
							journal: string;
							business_ratio: number | null;
						})
					: undefined;
				if (p) {
					const j = JSON.parse(p.journal);
					checks.closedYear = !!this.db
						.prepare('SELECT 1 FROM closed_years WHERE year=?')
						.get(Number(j.date.slice(0, 4)));
					checks.businessRatio = p.business_ratio;
				}
				const approved = autoApproveEvidence(this, id, this.positiveRules, checks);
				if (approved) {
					const reviewId = randomUUID();
					this.db
						.prepare('INSERT INTO evidence_reviews VALUES(?,?,?,?,?,?,?,?)')
						.run(
							reviewId,
							id,
							version,
							approved.proposalVersion,
							'positive-rule-v1',
							'approved',
							JSON.stringify({ ...checks, rule: approved.rule }),
							new Date().toISOString()
						);
					this.workflow.audit('backend-policy', 'evidence.review', id, {
						reviewId,
						policy: 'positive-rule-v1',
						result: 'approved',
						...approved
					});
					return {
						id: reviewId,
						result: 'approved' as const,
						checks: { ...checks, rule: approved.rule } as Record<string, unknown>
					};
				}
				const reviewId = randomUUID();
				this.db
					.prepare('INSERT INTO evidence_reviews VALUES(?,?,?,?,?,?,?,?)')
					.run(
						reviewId,
						id,
						version,
						p?.version ?? null,
						'hold-v1',
						'needs_answer',
						JSON.stringify(checks),
						new Date().toISOString()
					);
				if (
					!this.db
						.prepare('SELECT 1 FROM evidence_questions WHERE evidence_id=? AND version=?')
						.get(id, version)
				)
					this.db
						.prepare('INSERT INTO evidence_questions VALUES(?,?,?,?,NULL,NULL)')
						.run(
							randomUUID(),
							id,
							version,
							'事業用途・科目・税区分・按分・金額/日付・請求/支払状態とその根拠をまとめて確認してください。未定義ルールは回答後も保留します。'
						);
				this.workflow.audit('backend-policy', 'evidence.review', id, {
					reviewId,
					policy: 'hold-v1',
					result: 'needs_answer',
					proposalVersion: p?.version,
					checks
				});
				return { id: reviewId, result: 'needs_answer' as const, checks };
			})
			.immediate();
	}
	link(id: string, version: number, proposalId: string, actor: 'owner' | 'agent' = 'owner') {
		return this.db
			.transaction(() => {
				const r = this.row(id);
				if (r.version !== version) throw new ConflictError('証憑は変更済みです');
				if (r.proposal_id) throw new ConflictError('証憑は既にリンク済みです');
				if (
					!this.db
						.prepare("SELECT 1 FROM proposals WHERE id=? AND status IN ('pending','draft')")
						.get(proposalId)
				)
					throw new ConflictError('有効な候補がありません');
				this.db
					.prepare('UPDATE gmail_evidence SET proposal_id=?,version=version+1 WHERE id=?')
					.run(proposalId, id);
				this.workflow.audit(actor, 'evidence.link', id, { proposalId });
				return this.review(id, version + 1);
			})
			.immediate();
	}
	answer(questionId: string, version: number, text: string) {
		return this.db
			.transaction(() => {
				const q = this.db.prepare('SELECT * FROM evidence_questions WHERE id=?').get(questionId) as
					{ evidence_id: string; version: number; answer: string | null } | undefined;
				if (
					!q ||
					q.answer !== null ||
					q.version !== version ||
					this.row(q.evidence_id).version !== version
				)
					throw new ConflictError('質問は回答済みか古くなっています');
				this.db
					.prepare('UPDATE evidence_questions SET answer=?,answered_at=? WHERE id=?')
					.run(text, new Date().toISOString(), questionId);
				this.db
					.prepare('UPDATE gmail_evidence SET version=version+1 WHERE id=?')
					.run(q.evidence_id);
				this.workflow.audit('owner', 'evidence.answer', q.evidence_id, {
					questionId,
					version,
					text
				});
				return this.review(q.evidence_id, version + 1);
			})
			.immediate();
	}
}
