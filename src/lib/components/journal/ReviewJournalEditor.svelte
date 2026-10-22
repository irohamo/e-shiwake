<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AccountSelect from './AccountSelect.svelte';
	import TaxCategorySelect from './TaxCategorySelect.svelte';
	import type { Account } from '$lib/types';
	import type { NewJournal } from '$lib/storage/accounting';
	let { journal = $bindable(), accounts }: { journal: NewJournal; accounts: Account[] } = $props();
</script>

<div class="space-y-3 rounded-lg border p-3">
	<label class="block text-sm">取引日<Input type="date" bind:value={journal.date} /></label>
	<label class="block text-sm">取引先<Input bind:value={journal.vendor} /></label>
	<label class="block text-sm">摘要<Input bind:value={journal.description} /></label>
	{#each journal.lines as line, i (line.id)}
		<div class="grid gap-2 rounded bg-muted/40 p-3 sm:grid-cols-4">
			<label class="text-sm"
				>貸借<select
					aria-label={`候補 行${i + 1} 貸借`}
					bind:value={line.type}
					class="w-full rounded border bg-background p-2"
					><option value="debit">借方</option><option value="credit">貸方</option></select
				></label
			>
			<div>
				<p class="text-sm">勘定科目</p>
				<AccountSelect
					{accounts}
					value={line.accountCode}
					onchange={(v) => (line.accountCode = v)}
				/>
			</div>
			<label class="text-sm"
				>金額<Input
					aria-label={`候補 行${i + 1} 金額`}
					type="number"
					min="0"
					step="1"
					bind:value={line.amount}
				/></label
			>
			<div>
				<p class="text-sm">税区分</p>
				<TaxCategorySelect
					value={line.taxCategory}
					onchange={(v) => (line.taxCategory = v)}
					compact={false}
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				disabled={journal.lines.length <= 2}
				onclick={() => (journal.lines = journal.lines.filter((l) => l.id !== line.id))}
				>この行を削除</Button
			>
		</div>
	{/each}
	<Button
		type="button"
		variant="outline"
		disabled={journal.lines.length >= 100}
		onclick={() =>
			(journal.lines = [
				...journal.lines,
				{ id: crypto.randomUUID(), type: 'debit', accountCode: '', amount: 0, taxCategory: 'na' }
			])}>明細行を追加</Button
	>
</div>
