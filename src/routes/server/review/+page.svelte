<script lang="ts">
	import { isBusinessRatioConsistent } from '$lib/utils/business-ratio';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import ReviewJournalEditor from '$lib/components/journal/ReviewJournalEditor.svelte';
	import { workflowRequest } from '$lib/storage/workflow-http';
	import { createHttpAccountingStorage } from '$lib/storage/http';
	import { TaxCategoryLabels, type Account } from '$lib/types';
	import type { Proposal } from '$lib/server/workflow-schema';
	import type { NewJournal } from '$lib/storage/accounting';
	let evidence = $state<
		{
			id: string;
			hash: string;
			version: number;
			proposal_id: string | null;
			questions: { id: string; version: number; text: string; answer: string | null }[];
		}[]
	>([]);
	let answers = $state<Record<string, string>>({});
	let links = $state<Record<string, string>>({});
	async function evidenceAction(body: unknown) {
		if (busy || loading) return;
		message = '';
		error = '';
		busy = true;
		try {
			const r = await fetch('/api/evidence/decision', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) throw new Error('証憑操作に失敗しました。再読込してください');
			if (await load()) message = '証憑の操作を保存しました。最新の内容を確認してください。';
		} catch (e) {
			error =
				e instanceof Error ? e.message : '操作に失敗しました。再読込してからやり直してください。';
		} finally {
			busy = false;
		}
	}
	let proposals = $state<Proposal[]>([]);
	let accounts = $state<Account[]>([]);
	let transactions = $state<
		{ id: string; date: string; amount: number; description: string; vendor: string; raw: string }[]
	>([]);
	let message = $state('');
	let busy = $state(false);
	let loading = $state(true);
	let error = $state('');
	let filter = $state('pending');
	let editing = $state<string | null>(null);
	let edited = $state<NewJournal | null>(null);
	async function load() {
		loading = true;
		error = '';
		try {
			const [nextProposals, nextAccounts, nextTransactions, response] = await Promise.all([
				workflowRequest<Proposal[]>('proposals'),
				createHttpAccountingStorage().listAccounts(),
				workflowRequest<typeof transactions>('transactions'),
				fetch('/api/evidence/inbox')
			]);
			if (!response.ok) throw new Error('証憑を読み込めませんでした。再読込してください。');
			const nextEvidence = await response.json();
			proposals = nextProposals;
			accounts = nextAccounts;
			transactions = nextTransactions;
			evidence = nextEvidence;
			return true;
		} catch (e) {
			error = e instanceof Error ? e.message : '読み込めませんでした。再読込してください。';
			return false;
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
	});
	async function decide(p: Proposal, action: 'approve' | 'reject' | 'update') {
		if (busy || loading) return;
		busy = true;
		message = '';
		error = '';
		try {
			await workflowRequest('decision', {
				id: p.id,
				version: p.version,
				action,
				...(action === 'update' ? { journal: edited } : {})
			});
			editing = null;
			edited = null;
			const refreshed = await load();
			message =
				action === 'approve'
					? '承認して帳簿に転記しました'
					: action === 'reject'
						? '候補を却下しました'
						: '候補を修正しました';
			if (!refreshed) message += ' 最新の一覧を取得できませんでした。再読込してください。';
		} catch (e) {
			error =
				e instanceof Error ? e.message : '操作に失敗しました。再読込してからやり直してください。';
		} finally {
			busy = false;
		}
	}
	const labels = {
		draft: '下書き',
		pending: '確認待ち',
		approved: '承認済み',
		rejected: '却下済み'
	};
</script>

<svelte:head><title>仕訳レビュー | e-shiwake</title></svelte:head>

<header class="my-6 flex flex-wrap items-center justify-between gap-3">
	<div>
		<h1 class="text-2xl font-bold">承認待ちの仕訳</h1>
		<p class="text-sm text-muted-foreground">
			AIの説明・取引明細は未検証の資料です。承認した仕訳だけが帳簿に反映されます。
		</p>
	</div>
	<Button variant="outline" disabled={busy || loading} onclick={() => load()}>再読込</Button>
</header>

<p class="mb-4 text-sm text-muted-foreground">
	確認待ち {proposals.filter((p) => p.status === 'pending').length}件 ·
	<a href="#evidence-inbox" class="underline">証憑 {evidence.length}件を確認</a>
</p>
<label class="text-sm"
	>表示<select bind:value={filter} class="ml-3 rounded border bg-background p-2"
		><option value="pending">確認待ち</option><option value="draft">下書き</option><option
			value="approved">承認済み</option
		><option value="rejected">却下済み</option></select
	></label
>
<p role="status" class="my-4 text-sm">{message}</p>
{#if error}<div
		role="alert"
		class="my-4 rounded-lg border border-destructive p-3 text-sm text-destructive"
	>
		{error} 操作前に「再読込」で最新の内容を確認してください。
	</div>{/if}
{#if loading}<p role="status" class="my-6 text-muted-foreground">候補・証憑を読み込み中…</p>{/if}
{#if !loading && !error && proposals.filter((p) => p.status === filter).length === 0}<p
		class="my-6 text-muted-foreground"
	>
		{labels[
			filter as keyof typeof labels
		]}の候補はありません。CSVから取り込んだ明細は、AIが候補を作成するとここに表示されます。
	</p>{/if}
<div class="space-y-5">
	{#each proposals.filter((p) => p.status === filter) as p (p.id)}
		{@const applied = p.journal.lines.find((line) => line._businessRatioApplied)}
		<article
			aria-label={`仕訳候補：${p.journal.description}`}
			class="space-y-4 rounded-xl border bg-card p-4 [overflow-wrap:anywhere] sm:p-6"
		>
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
					><span class="shrink-0 font-mono tabular-nums">¥{line.amount.toLocaleString()}</span>
				</p>{/each}
			<section>
				<h3 class="text-sm font-medium">提案根拠</h3>
				<p class="text-sm whitespace-pre-wrap">{p.rationale}</p>
			</section>
			{#if p.questions.length}<section>
					<h3 class="font-medium">不明点・確認事項</h3>
					{#each p.questions as q, i (i)}<p class="text-sm whitespace-pre-wrap">{q}</p>{/each}
				</section>{/if}
			{#if applied && isBusinessRatioConsistent(p.journal.lines)}
				<p class="text-sm">
					事業利用割合: {applied._businessRatio}%（元の金額 {applied._originalAmount}円、計上額 {applied.amount}円、按分適用済み）
				</p>
			{:else if p.businessRatio !== undefined}
				<p class="text-sm">
					事業利用割合: {p.businessRatio}%{p.businessRatio !== 100
						? '（按分計算は未適用。100%以外は承認不可）'
						: ''}
				</p>
			{/if}
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
					/><Button disabled={busy || loading} onclick={() => decide(p, 'update')}
						>修正して確認待ちにする</Button
					>
					<Button
						variant="ghost"
						disabled={busy || loading}
						onclick={() => {
							editing = null;
							edited = null;
						}}>修正をキャンセル</Button
					>{:else}
					<div class="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={busy || loading}
							onclick={() => {
								editing = p.id;
								edited = structuredClone($state.snapshot(p.journal));
							}}>修正</Button
						><Button
							variant="outline"
							disabled={busy || loading}
							onclick={() => decide(p, 'reject')}>却下</Button
						>
					</div>
					{#if p.status === 'pending'}<Button
							disabled={busy || loading}
							onclick={() => decide(p, 'approve')}>承認して帳簿に反映</Button
						>{/if}
				{/if}
			{/if}
		</article>
	{/each}
</div>

<details id="evidence-inbox" class="my-6 space-y-3 rounded-xl border p-4">
	<summary class="cursor-pointer py-2 font-semibold">Gmail証憑の確認（{evidence.length}件）</summary
	>
	<p>証憑は未検証の資料です。未定義ルールは保留し、回答や無回答だけで承認しません。</p>
	{#each evidence as e (e.id)}
		<article class="space-y-2 rounded border p-3">
			<p>証憑 <span class="break-all">{e.id}</span> / 第{e.version}版</p>
			<a class="underline" href={'/api/evidence/original?id=' + e.id}>原本をダウンロード</a>
			<p class="text-xs break-all">SHA-256: {e.hash}</p>
			<label
				>関連候補<select
					class="mt-2 block w-full rounded border bg-background p-2"
					bind:value={links[e.id]}
					><option value="">選択してください</option
					>{#each proposals.filter( (p) => ['pending', 'draft'].includes(p.status) ) as p (p.id)}<option
							value={p.id}>{p.journal.date} / {p.journal.description}</option
						>{/each}</select
				></label
			>
			<Button
				disabled={busy || loading || !links[e.id]}
				onclick={() =>
					evidenceAction({ action: 'link', id: e.id, version: e.version, proposalId: links[e.id] })}
				>候補に紐付けて再レビュー</Button
			>
			{#each e.questions as q (q.id)}
				<p class="whitespace-pre-wrap">{q.text}</p>
				{#if q.answer}<p class="whitespace-pre-wrap">
						回答: {q.answer}
					</p>{:else if q.version === e.version}
					<label class="block"
						>根拠を含む回答<textarea
							class="block w-full rounded border p-2"
							maxlength="4000"
							bind:value={answers[q.id]}
						></textarea></label
					>
					<Button
						disabled={busy || loading || !answers[q.id]?.trim()}
						onclick={() =>
							evidenceAction({
								action: 'answer',
								questionId: q.id,
								version: e.version,
								text: answers[q.id]
							})}>回答を保存して再レビュー</Button
					>
				{:else}<p>古い質問（現在のversionの質問へ回答してください）</p>{/if}
			{/each}
		</article>
	{/each}
	{#if evidence.length === 0}<p>登録された証憑はありません。</p>{/if}
</details>
