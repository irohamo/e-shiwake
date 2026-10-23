<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AccountSelect from '$lib/components/journal/AccountSelect.svelte';
	import TaxCategorySelect from '$lib/components/journal/TaxCategorySelect.svelte';
	import { createHttpAccountingStorage } from '$lib/storage/http';
	import { generateTrialBalance } from '$lib/utils/trial-balance';
	import { validateJournal } from '$lib/utils/journal-validation';
	import type { Account, JournalEntry, JournalLine } from '$lib/types';
	const storage = createHttpAccountingStorage();
	let accounts = $state<Account[]>([]);
	let journals = $state<JournalEntry[]>([]);
	let date = $state(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }));
	let description = $state('');
	let vendor = $state('');
	let lines = $state<JournalLine[]>([]);
	let message = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let requestId = '';
	const validation = $derived(validateJournal({ lines }));
	const balance = $derived(generateTrialBalance(journals, accounts));
	const canSave = $derived(
		validation.isValid &&
			description.trim().length > 0 &&
			lines.every((l) => Number.isSafeInteger(l.amount) && l.amount >= 0)
	);
	function newLine(type: 'debit' | 'credit'): JournalLine {
		return { id: crypto.randomUUID(), type, accountCode: '', amount: 0, taxCategory: 'na' };
	}
	function reset() {
		lines = [newLine('debit'), newLine('credit')];
		description = '';
		vendor = '';
		requestId = crypto.randomUUID();
	}
	async function refresh() {
		loading = true;
		try {
			[accounts, journals] = await Promise.all([storage.listAccounts(), storage.listJournals()]);
		} catch (e) {
			message = e instanceof Error ? e.message : '読込失敗';
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		reset();
		void refresh();
	});
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!canSave || busy) return;
		busy = true;
		message = '';
		try {
			await storage.createJournal(
				{ date, vendor, description, lines, evidenceStatus: 'none', attachments: [] },
				requestId
			);
			reset();
			message = '仕訳を保存しました。一覧で内容を確認できます。';
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : '保存失敗';
		} finally {
			busy = false;
		}
	}
	async function logout() {
		const response = await fetch('/api/auth/logout', { method: 'POST' });
		if (response.ok) await goto('/login');
	}
</script>

<svelte:head><title>仕訳帳 | e-shiwake Server</title></svelte:head>
<header class="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
	<div>
		<p class="text-sm text-muted-foreground">e-shiwake / サーバーの帳簿</p>
		<h1 class="text-2xl font-bold">仕訳帳</h1>
	</div>
	<div class="flex gap-2">
		<Button variant="outline" onclick={refresh} disabled={loading}>再読込</Button><Button
			variant="ghost"
			onclick={logout}>ログアウト</Button
		>
	</div>
</header>
<p class="mb-6 text-sm text-muted-foreground">
	保存した仕訳はサーバーの帳簿に反映されます。AIの提案は「承認待ち」で内容を確認してから承認してください。
</p>
<div class="mb-6 grid gap-4 sm:grid-cols-3">
	<div class="rounded-xl border p-4">
		<p class="text-sm text-muted-foreground">保存済み仕訳</p>
		<p class="mt-2 text-2xl font-semibold">{journals.length} 件</p>
	</div>
	<div class="rounded-xl border p-4">
		<p class="text-sm text-muted-foreground">全年度 借方合計</p>
		<p class="mt-2 text-2xl font-semibold">¥{balance.totalDebit.toLocaleString('ja-JP')}</p>
	</div>
	<div class="rounded-xl border p-4">
		<p class="text-sm text-muted-foreground">試算表</p>
		<p class="mt-2 text-2xl font-semibold">{balance.isBalanced ? '貸借一致' : '不一致'}</p>
	</div>
</div>
<section class="mb-8 rounded-xl border bg-card p-4 sm:p-6">
	<h2 class="mb-4 text-lg font-semibold">新しい仕訳</h2>
	<form onsubmit={save} class="space-y-4">
		<fieldset disabled={busy || loading} class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-3">
				<label class="space-y-2 text-sm"
					>取引日<Input type="date" bind:value={date} required /></label
				>
				<label class="space-y-2 text-sm"
					>取引先（任意）<Input bind:value={vendor} maxlength={500} /></label
				>
				<label class="space-y-2 text-sm"
					>摘要（必須）<Input
						placeholder="例：事務用品を購入"
						bind:value={description}
						required
						maxlength={2000}
					/></label
				>
			</div>
			{#each lines as line, i (line.id)}
				<div
					class="grid items-end gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-[5rem_minmax(0,1fr)_9rem_9rem_4rem]"
				>
					<label class="text-sm"
						>貸借<select
							aria-label={`行${i + 1} 貸借`}
							bind:value={line.type}
							class="mt-2 w-full rounded border bg-background p-2"
							><option value="debit">借方</option><option value="credit">貸方</option></select
						></label
					>
					<div>
						<p class="mb-2 text-sm">勘定科目</p>
						<AccountSelect
							{accounts}
							value={line.accountCode}
							onchange={(code) => (line.accountCode = code)}
						/>
					</div>
					<label class="space-y-2 text-sm"
						>金額（円）<Input
							aria-label={`行${i + 1} 金額`}
							type="number"
							min="0"
							max="1000000000000"
							step="1"
							bind:value={line.amount}
							required
						/></label
					>
					<div>
						<p class="mb-2 text-sm">税区分</p>
						<TaxCategorySelect
							value={line.taxCategory}
							onchange={(value) => (line.taxCategory = value)}
							compact={false}
						/>
					</div>
					<Button
						type="button"
						variant="ghost"
						aria-label={`行${i + 1} 削除`}
						disabled={lines.length <= 2}
						onclick={() => (lines = lines.filter((l) => l.id !== line.id))}>削除</Button
					>
				</div>
			{/each}
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					onclick={() => (lines = [...lines, newLine('debit')])}
					disabled={lines.length >= 100}>行を追加</Button
				><span class="self-center text-sm"
					>借方 ¥{validation.debitTotal.toLocaleString()} / 貸方 ¥{validation.creditTotal.toLocaleString()}</span
				>
			</div>
			<Button type="submit" disabled={!canSave || busy || loading}
				>{busy ? '保存中…' : '確認して保存'}</Button
			>
		</fieldset>
		<p role="status" class="text-sm whitespace-pre-wrap">{message}</p>
		{#if !canSave && !loading}<p class="text-sm text-muted-foreground">
				摘要・勘定科目を入力し、借方と貸方の金額を一致させると保存できます。
			</p>{/if}
	</form>
</section>
<section>
	<h2 class="mb-4 text-lg font-semibold">保存済み仕訳（{journals.length}件）</h2>
	{#if loading}<p>読込中…</p>{:else if journals.length === 0}<p class="text-muted-foreground">
			仕訳はまだありません。上の「新しい仕訳」から入力するか、「CSV取り込み」で明細を取り込んでください。
		</p>{/if}
	<div class="space-y-3">
		{#each journals as journal (journal.id)}
			<article class="rounded-xl border p-4">
				<div class="mb-2 flex flex-wrap justify-between gap-2">
					<h3 class="font-medium">{journal.description}</h3>
					<span class="text-sm text-muted-foreground"
						>{journal.date} / {journal.vendor || '取引先未指定'}</span
					>
				</div>
				{#each journal.lines as line (line.id)}<p class="flex justify-between gap-3 text-sm">
						<span
							>{line.type === 'debit' ? '借方' : '貸方'}
							{accounts.find((a) => a.code === line.accountCode)?.name}</span
						><span class="shrink-0 font-mono tabular-nums"
							>¥{line.amount.toLocaleString('ja-JP')}</span
						>
					</p>{/each}
			</article>
		{/each}
	</div>
</section>
