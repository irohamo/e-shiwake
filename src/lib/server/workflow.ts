import { createHash, randomUUID } from 'node:crypto';
import { ConflictError, type SqliteAccountingStorage } from './sqlite';
import { parseCsv } from './csv-import';
import {
	proposalSchema,
	type Proposal,
	type ProposalInput,
	type CsvInput,
	type ImportedTransaction
} from './workflow-schema';
import type { NewJournal } from '$lib/storage/accounting';
interface Transaction extends ImportedTransaction {
	id: string;
	journal_id: string | null;
}
export class WorkflowService {
	constructor(readonly storage: SqliteAccountingStorage) {}
	get db() {
		return this.storage.db;
	}
	audit(actor: string, action: string, id: string, detail: unknown) {
		this.db
			.prepare('INSERT INTO audit_log(at,actor,action,entity_id,detail) VALUES(?,?,?,?,?)')
			.run(new Date().toISOString(), actor, action, id, JSON.stringify(detail));
	}
	listTransactions(unclassified = false) {
		return this.db
			.prepare(
				`SELECT id,date,amount,description,vendor,source,account,external_id AS externalId,journal_id AS journalId,raw,
 EXISTS(SELECT 1 FROM proposals p WHERE p.transaction_id=transactions.id AND p.status IN ('draft','pending')) AS proposed
 FROM transactions ${unclassified ? "WHERE journal_id IS NULL AND NOT EXISTS(SELECT 1 FROM proposals p WHERE p.transaction_id=transactions.id AND p.status IN ('draft','pending'))" : ''} ORDER BY date DESC,id LIMIT 500`
			)
			.all();
	}
	listProposals(): Proposal[] {
		const rows = this.db
			.prepare(
				"SELECT * FROM proposals ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,created_at DESC,id LIMIT 500"
			)
			.all() as Record<string, unknown>[];
		return rows.map((r) => ({
			id: String(r.id),
			version: Number(r.version),
			status: r.status as Proposal['status'],
			actor: String(r.actor),
			journal: JSON.parse(String(r.journal)),
			transaction: r.transaction_id
				? (this.db
						.prepare('SELECT id,date,amount,description,vendor,raw FROM transactions WHERE id=?')
						.get(r.transaction_id as string) as Proposal['transaction'])
				: undefined,
			transactionId: r.transaction_id ? String(r.transaction_id) : undefined,
			rationale: String(r.rationale),
			questions: JSON.parse(String(r.questions)),
			businessRatio: r.business_ratio == null ? undefined : Number(r.business_ratio),
			confidence: r.confidence == null ? undefined : Number(r.confidence),
			postedJournalId: r.posted_journal_id ? String(r.posted_journal_id) : undefined,
			createdAt: String(r.created_at),
			annotations: this.db
				.prepare(
					'SELECT kind,text,actor,at FROM proposal_annotations WHERE proposal_id=? ORDER BY id'
				)
				.all(r.id as string) as Proposal['annotations']
		}));
	}
	createProposal(value: ProposalInput, actor: 'owner' | 'agent') {
		const input = proposalSchema.parse(value);
		const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
		return this.db
			.transaction(() => {
				const previous = this.db
					.prepare('SELECT id,request_hash FROM proposals WHERE request_id=?')
					.get(input.requestId) as { id: string; request_hash: string } | undefined;
				if (previous) {
					if (previous.request_hash !== hash)
						throw new ConflictError('候補の再送IDが別の内容に使われています');
					return previous.id;
				}
				for (const line of input.journal.lines)
					if (!this.db.prepare('SELECT 1 FROM accounts WHERE code=?').get(line.accountCode))
						throw new ConflictError('未登録の勘定科目です');
				if (input.transactionId) {
					const transaction = this.db
						.prepare('SELECT journal_id FROM transactions WHERE id=?')
						.get(input.transactionId) as { journal_id: string | null } | undefined;
					if (!transaction || transaction.journal_id)
						throw new ConflictError('明細がないか転記済みです');
					if (
						this.db
							.prepare(
								"SELECT 1 FROM proposals WHERE transaction_id=? AND status IN ('draft','pending','approved')"
							)
							.get(input.transactionId)
					)
						throw new ConflictError('この明細には既に有効な候補があります');
				}
				const id = randomUUID();
				this.db
					.prepare('INSERT INTO proposals VALUES(?,1,?,?,?,?,?,?,?,?,NULL,?,?,?)')
					.run(
						id,
						input.status,
						actor,
						input.transactionId ?? null,
						JSON.stringify(input.journal),
						input.rationale,
						JSON.stringify(input.questions),
						input.businessRatio ?? null,
						input.confidence ?? null,
						new Date().toISOString(),
						input.requestId,
						hash
					);
				this.audit(actor, 'proposal.create', id, input);
				return id;
			})
			.immediate();
	}
	decide(
		id: string,
		version: number,
		action: 'approve' | 'reject' | 'update',
		journal?: NewJournal
	) {
		return this.db
			.transaction(() => {
				const p = this.db.prepare('SELECT * FROM proposals WHERE id=?').get(id) as
					| {
							version: number;
							status: string;
							journal: string;
							transaction_id: string | null;
							business_ratio: number | null;
					  }
					| undefined;
				if (!p || p.version !== version || !['draft', 'pending'].includes(p.status))
					throw new ConflictError('候補は変更済みです。再読込してください');
				if (action === 'update') {
					if (!journal) throw new ConflictError('修正内容が必要です');
					// Full schema/account validation is repeated at posting; unknown accounts cannot be posted.
					const parsed = proposalSchema.shape.journal.parse(journal);
					this.db
						.prepare("UPDATE proposals SET journal=?,status='pending',version=version+1 WHERE id=?")
						.run(JSON.stringify(parsed), id);
					this.audit('owner', 'proposal.update', id, parsed);
					return { id };
				}
				if (action === 'approve') {
					if (p.status !== 'pending')
						throw new ConflictError('Draftを修正・確認待ちにしてから承認してください');
					if (p.business_ratio !== null && p.business_ratio !== 100)
						throw new ConflictError(
							'家事按分を含む候補は、計算済み仕訳の扱いを確認するまで承認できません'
						);
					const entry = JSON.parse(p.journal) as NewJournal;
					const journalId = this.storage.postJournal(entry, id);
					if (p.transaction_id) {
						const result = this.db
							.prepare('UPDATE transactions SET journal_id=? WHERE id=? AND journal_id IS NULL')
							.run(journalId, p.transaction_id);
						if (result.changes !== 1) throw new ConflictError('明細は既に転記済みです');
					}
					this.db
						.prepare(
							"UPDATE proposals SET status='approved',posted_journal_id=?,version=version+1 WHERE id=?"
						)
						.run(journalId, id);
					this.audit('owner', 'proposal.approve', id, { journalId });
					return { id, journalId };
				}
				this.db
					.prepare("UPDATE proposals SET status='rejected',version=version+1 WHERE id=?")
					.run(id);
				this.audit('owner', 'proposal.reject', id, {});
				return { id };
			})
			.immediate();
	}
	annotate(proposalId: string, kind: string, text: string, actor: 'owner' | 'agent') {
		return this.db
			.transaction(() => {
				if (
					!this.db
						.prepare("SELECT 1 FROM proposals WHERE id=? AND status IN ('draft','pending')")
						.get(proposalId)
				)
					throw new ConflictError('候補がないか確定済みです');
				this.db
					.prepare(
						'INSERT INTO proposal_annotations(proposal_id,kind,text,actor,at) VALUES(?,?,?,?,?)'
					)
					.run(proposalId, kind, text, actor, new Date().toISOString());
				this.db.prepare('UPDATE proposals SET version=version+1 WHERE id=?').run(proposalId);
				this.audit(actor, 'proposal.annotate', proposalId, { kind, text });
			})
			.immediate();
	}
	compare(row: ImportedTransaction) {
		const previous = this.db
			.prepare('SELECT * FROM transactions WHERE fingerprint=?')
			.get(row.fingerprint) as Transaction | undefined;
		if (!previous) return 'new';
		return previous.date === row.date &&
			previous.amount === row.amount &&
			previous.description === row.description &&
			previous.vendor === row.vendor
			? 'duplicate'
			: 'conflict';
	}
	preview(input: CsvInput) {
		const rows = parseCsv(input);
		const id = randomUUID();
		const counts = { new: 0, duplicate: 0, conflict: 0 };
		const items = rows.map((row) => {
			const result = this.compare(row);
			counts[result]++;
			return { ...row, result };
		});
		this.db
			.prepare('DELETE FROM import_previews WHERE expires_at<? AND committed_at IS NULL')
			.run(Date.now());
		this.db
			.prepare('INSERT INTO import_previews VALUES(?,?,?,NULL)')
			.run(id, JSON.stringify(rows), Date.now() + 15 * 60 * 1000);
		return { id, counts, rows: items };
	}
	commitPreview(id: string) {
		return this.db
			.transaction(() => {
				const preview = this.db.prepare('SELECT * FROM import_previews WHERE id=?').get(id) as
					{ data: string; expires_at: number; committed_at: string | null } | undefined;
				if (!preview) throw new ConflictError('プレビューがありません');
				if (preview.committed_at)
					return this.db.prepare('SELECT * FROM import_batches WHERE id=?').get(id);
				if (preview.expires_at < Date.now())
					throw new ConflictError('プレビューの有効期限が切れました');
				const rows = JSON.parse(preview.data) as ImportedTransaction[];
				let inserted = 0;
				let skipped = 0;
				for (const row of rows) {
					const state = this.compare(row);
					if (state === 'conflict')
						throw new ConflictError('既存の明細IDと内容が異なります。取込を中止しました');
					if (state === 'duplicate') {
						skipped++;
						continue;
					}
					this.db
						.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)')
						.run(
							randomUUID(),
							row.fingerprint,
							row.date,
							row.amount,
							row.description,
							row.vendor,
							row.source,
							row.account,
							row.externalId,
							JSON.stringify(row.raw),
							id
						);
					inserted++;
				}
				const at = new Date().toISOString();
				this.db
					.prepare('INSERT INTO import_batches VALUES(?,?,?,?)')
					.run(id, at, inserted, skipped);
				this.db.prepare('UPDATE import_previews SET committed_at=? WHERE id=?').run(at, id);
				this.audit('owner', 'csv.import', id, { inserted, skipped });
				return { id, at, inserted, skipped };
			})
			.immediate();
	}
	status() {
		const count = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
		return {
			pending: count("SELECT COUNT(*) n FROM proposals WHERE status='pending'"),
			draft: count("SELECT COUNT(*) n FROM proposals WHERE status='draft'"),
			unclassified: count(
				"SELECT COUNT(*) n FROM transactions t WHERE journal_id IS NULL AND NOT EXISTS(SELECT 1 FROM proposals p WHERE p.transaction_id=t.id AND p.status IN ('draft','pending'))"
			),
			unreconciled: count('SELECT COUNT(*) n FROM transactions WHERE journal_id IS NULL')
		};
	}
}
