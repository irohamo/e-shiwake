<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import ReviewJournalEditor from '$lib/components/journal/ReviewJournalEditor.svelte';
	import { workflowRequest } from '$lib/storage/workflow-http';
	import { createHttpAccountingStorage } from '$lib/storage/http';
	import { TaxCategoryLabels, type Account } from '$lib/types';
	import type { Proposal } from '$lib/server/workflow-schema';
	import type { NewJournal } from '$lib/storage/accounting';
	let proposals = $state<Proposal[]>([]);
	let accounts = $state<Account[]>([]);
	let transactions = $state<
		{ id: string; date: string; amount: number; description: string; vendor: string; raw: string }[]
	>([]);
	let message = $state('');
	let busy = $state(false);
	let filter = $state('pending');
	let editing = $state<string | null>(null);
	let edited = $state<NewJournal | null>(null);
	let confirmed = $state<Record<string, boolean>>({});
	async function load() {
		try {
			[proposals, accounts, transactions] = await Promise.all([
				workflowRequest<Proposal[]>('proposals'),
				createHttpAccountingStorage().listAccounts(),
				workflowRequest<typeof transactions>('transactions')
			]);
			confirmed = {};
		} catch (e) {
			message = e instanceof Error ? e.message : '読込失敗';
		}
	}
	onMount(() => {
		void load();
	});
	async function decide(p: Proposal, action: 'approve' | 'reject' | 'update') {
		busy = true;
		message = '';
		try {
			await workflowRequest('decision', {
				id: p.id,
				version: p.version,
				action,
				...(action === 'update' ? { journal: edited } : {})
			});
			editing = null;
			edited = null;
			await load();
			message =
				action === 'approve'
					? '承認して帳簿に転記しました'
					: action === 'reject'
						? '候補を却下しました'
						: '候補を修正しました';
		} catch (e) {
			message = e instanceof Error ? e.message : '操作失敗';
		} finally {
			busy = false;
		}
	}
	const labels = {
		draft: 'Draft',
		pending: '確認待ち',
		approved: '承認済み',
		rejected: '却下済み'
	};
</script>

<svelte:head><title>仕訳レビュー | e-shiwake</title></svelte:head>
<a href="/server" class="text-sm underline">← 仕訳帳へ</a>
<header class="my-6 flex flex-wrap items-center justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold">Review Inbox</h1>
		<p class="text-sm text-muted-foreground">
			AIの説明・取引明細は未検証の資料です。承認した仕訳だけが帳簿に反映されます。
		</p>
	</div>
	<Button variant="outline" onclick={load}>再読込</Button>
</header>
<label class="text-sm"
	>表示<select bind:value={filter} class="ml-3 rounded border bg-background p-2"
		><option value="pending">確認待ち</option><option value="draft">Draft</option><option
			value="approved">承認済み</option
		><option value="rejected">却下済み</option></select
	></label
>
<p role="status" class="my-4 text-sm">{message}</p>
{#if proposals.filter((p) => p.status === filter).length === 0}<p
		class="my-6 text-muted-foreground"
	>
		該当する候補はありません。
	</p>{/if}
<div class="space-y-5">
	{#each proposals.filter((p) => p.status === filter) as p (p.id)}
		<article class="space-y-4 rounded-xl border p-4 sm:p-6">
			<div class="flex flex-wrap justify-between gap-2">
				<h2 class="text-lg font-semibold">{p.journal.description}</h2>
				<span class="text-sm"
					>{labels[p.status]} / {p.actor === 'agent' ? 'OpenClaw' : 'ユーザー'}</span
				>
			</div>
			{#if p.transactionId}{@const tx =
					p.transaction || transactions.find((t) => t.id === p.transactionId)}
				<section class="rounded-lg bg-muted p-3">
					<h3 class="font-medium">元の取引明細</h3>
					{#if tx}<p>{tx.date} / {tx.vendor} / {tx.description}</p>
						<p>¥{tx.amount.toLocaleString()}</p>
						<details>
							<summary class="text-sm">元のCSV明細を表示</summary>
							<pre class="overflow-auto text-xs break-all whitespace-pre-wrap">{tx.raw}</pre>
						</details>{:else}<p>明細が表示範囲外です。承認前に対象明細を確認してください。</p>{/if}
				</section>{/if}
			<p class="text-sm">{p.journal.date} / {p.journal.vendor || '取引先未指定'}</p>
			{#each p.journal.lines as line (line.id)}<p
					class="flex flex-wrap justify-between gap-2 text-sm"
				>
					<span
						>{line.type === 'debit' ? '借方' : '貸方'}
						{accounts.find((a) => a.code === line.accountCode)?.name || line.accountCode} / {line.taxCategory
							? TaxCategoryLabels[line.taxCategory]
							: '税区分未指定'}</span
					><span>¥{line.amount.toLocaleString()}</span>
				</p>{/each}
			<section>
				<h3 class="text-sm font-medium">提案根拠</h3>
				<p class="text-sm whitespace-pre-wrap">{p.rationale}</p>
			</section>
			{#if p.questions.length}<section>
					<h3 class="font-medium">不明点・確認事項</h3>
					{#each p.questions as q, i (i)}<p class="text-sm whitespace-pre-wrap">{q}</p>{/each}
				</section>{/if}
			{#if p.businessRatio !== undefined}<p class="text-sm">
					事業利用割合: {p.businessRatio}%（按分計算は未適用。100%以外は承認不可）
				</p>{/if}
			{#if p.confidence !== undefined}<p class="text-sm text-muted-foreground">
					AI参考信頼度: {p.confidence}%（自動承認には使用しません）
				</p>{/if}
			{#each p.annotations as note, i (i)}<p
					class="rounded bg-muted p-2 text-sm whitespace-pre-wrap"
				>
					{note.kind}: {note.text}
				</p>{/each}
			{#if ['pending', 'draft'].includes(p.status)}
				{#if editing === p.id && edited}<ReviewJournalEditor
						bind:journal={edited}
						{accounts}
					/><Button disabled={busy} onclick={() => decide(p, 'update')}
						>修正して確認待ちにする</Button
					>{:else}
					<div class="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={busy}
							onclick={() => {
								editing = p.id;
								edited = structuredClone($state.snapshot(p.journal));
							}}>修正</Button
						><Button variant="outline" disabled={busy} onclick={() => decide(p, 'reject')}
							>却下</Button
						>
					</div>
					{#if p.status === 'pending'}<label class="flex items-center gap-2 text-sm"
							><input
								type="checkbox"
								bind:checked={confirmed[p.id]}
							/>金額・科目・税区分・不明点を確認しました</label
						><Button disabled={busy || !confirmed[p.id]} onclick={() => decide(p, 'approve')}
							>承認して帳簿に反映</Button
						>{/if}
				{/if}
			{/if}
		</article>
	{/each}
</div>
