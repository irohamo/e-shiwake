<script lang="ts">
	import { parse } from 'csv-parse/browser/esm/sync';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { workflowRequest } from '$lib/storage/workflow-http';
	let file = $state<File | null>(null);
	let encoding = $state('utf-8');
	let csv = $state('');
	let headers = $state<string[]>([]);
	let source = $state<'bank' | 'card' | 'sales'>('bank');
	let account = $state('');
	let direction = $state<'signed' | 'expense' | 'income'>('signed');
	let mapping = $state({
		date: '',
		description: '',
		amount: '',
		inflow: '',
		outflow: '',
		vendor: '',
		externalId: ''
	});
	let preview = $state<{
		id: string;
		counts: { new: number; duplicate: number; conflict: number };
		rows: { date: string; description: string; amount: number; result: string }[];
	} | null>(null);
	let message = $state('');
	let busy = $state(false);
	async function decode() {
		preview = null;
		message = '';
		if (!file) return;
		try {
			if (file.size > 60000) throw new Error('60KB以下のCSVに分割してください');
			csv = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer());
			const rows = parse(csv, { bom: true, skip_empty_lines: true, to: 1 }) as string[][];
			headers = rows[0] || [];
			if (!headers.length) throw new Error('ヘッダーがありません');
			const choose = (names: string[]) => headers.find((h) => names.includes(h)) || '';
			mapping = {
				date: choose(['date', '日付', '取引日', '利用日']),
				description: choose(['description', '摘要', '内容', '利用先']),
				amount: choose(['amount', '金額', '利用金額']),
				inflow: choose(['入金', '入金額', 'お預入金額']),
				outflow: choose(['出金', '出金額', 'お引出金額']),
				vendor: choose(['vendor', '取引先']),
				externalId: choose(['externalId', '明細ID', 'ID'])
			};
		} catch (e) {
			csv = '';
			headers = [];
			message = e instanceof Error ? e.message : '読込失敗';
		}
	}
	async function showPreview() {
		busy = true;
		message = '';
		preview = null;
		try {
			preview = await workflowRequest('csv-preview', { csv, source, account, direction, mapping });
		} catch (e) {
			message = e instanceof Error ? e.message : '解析失敗';
		} finally {
			busy = false;
		}
	}
	async function commit() {
		if (!preview) return;
		busy = true;
		try {
			const result = await workflowRequest<{ inserted: number; skipped: number }>('csv-commit', {
				id: preview.id
			});
			message = `${result.inserted}件を取り込み、重複${result.skipped}件をスキップしました。仕訳はまだ作成していません。`;
			preview = null;
		} catch (e) {
			message = e instanceof Error ? e.message : '取込失敗';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>CSV取り込み | e-shiwake</title></svelte:head>
<a href="/server" class="text-sm underline">← 仕訳帳へ</a>
<h1 class="my-6 text-2xl font-bold">CSV取り込み</h1>
<p class="mb-6 text-sm text-muted-foreground">
	銀行・カード・売上の明細を取り込みます。帳簿への反映は、OpenClawの候補をReview
	Inboxで確認・承認した後です。
</p>
<div class="space-y-4 rounded-xl border p-4 sm:p-6">
	<label class="block text-sm"
		>CSVファイル（60KB・500行まで）<input
			class="mt-2 block max-w-full"
			type="file"
			accept=".csv,text/csv"
			onchange={(e) => {
				file = e.currentTarget.files?.[0] || null;
				void decode();
			}}
		/></label
	>
	<label class="block text-sm"
		>文字コード<select
			bind:value={encoding}
			onchange={decode}
			class="ml-2 rounded border bg-background p-2"
			><option value="utf-8">UTF-8</option><option value="shift_jis">Shift_JIS</option></select
		></label
	>
	<p class="text-sm">
		日付はYYYY-MM-DDまたはYYYY/MM/DD、金額は整数円です。入金・出金が別列の場合は金額列を空にして、それぞれの列を選択してください。
	</p>
	<label class="block text-sm"
		>明細の種類<select bind:value={source} class="ml-2 rounded border bg-background p-2"
			><option value="bank">銀行</option><option value="card">クレジットカード</option><option
				value="sales">売上</option
			></select
		></label
	>
	<label class="block text-sm"
		>口座・カードの識別名<Input
			bind:value={account}
			placeholder="例: 事業用普通預金"
			maxlength={100}
		/></label
	>
	<label class="block text-sm"
		>金額の向き<select
			bind:value={direction}
			class="ml-2 max-w-full rounded border bg-background p-2"
			><option value="signed">正数=入金・負数=出金</option><option value="expense"
				>正数=利用・出金（負数は返金）</option
			><option value="income">正数=売上（負数は返金）</option></select
		></label
	>
	<p class="text-sm">
		識別名は毎回同じ名前を使ってください。同日・同額・同内容の別取引には、異なる明細IDを指定してください。
	</p>
	{#if headers.length}<div class="grid gap-3 sm:grid-cols-2">
			{#each [{ key: 'date', label: '日付の列' }, { key: 'description', label: '摘要の列' }, { key: 'amount', label: '金額の列' }, { key: 'inflow', label: '入金の列（別列の場合）' }, { key: 'outflow', label: '出金の列（別列の場合）' }, { key: 'vendor', label: '取引先の列（任意）' }, { key: 'externalId', label: '明細IDの列（推奨）' }] as field (field.key)}
				<label class="block text-sm"
					>{field.label}<select
						aria-label={field.label}
						bind:value={mapping[field.key as keyof typeof mapping]}
						class="mt-2 w-full rounded border bg-background p-2"
						><option value="">選択してください</option>{#each headers as h (h)}<option value={h}
								>{h}</option
							>{/each}</select
					></label
				>
			{/each}
		</div>{/if}
	<Button
		disabled={busy ||
			!csv ||
			!account ||
			!mapping.date ||
			!mapping.description ||
			(!mapping.amount && !mapping.inflow && !mapping.outflow)}
		onclick={showPreview}>取り込みプレビュー</Button
	>
</div>
<p role="status" class="my-4 text-sm">{message}</p>
{#if preview}
	<section class="space-y-4 rounded-xl border p-4">
		<h2 class="text-lg font-semibold">プレビュー</h2>
		<p>
			新規 {preview.counts.new}件 / 重複 {preview.counts.duplicate}件 / 内容競合 {preview.counts
				.conflict}件
		</p>
		<div class="max-h-96 overflow-auto">
			{#each preview.rows as row, i (i)}<div class="border-b py-2 text-sm">
					<p>{row.date} / {row.description}</p>
					<p>
						¥{row.amount.toLocaleString()} / {row.result === 'new'
							? '新規'
							: row.result === 'duplicate'
								? '重複'
								: '内容競合'}
					</p>
				</div>{/each}
		</div>
		<Button disabled={busy || preview.counts.conflict > 0} onclick={commit}
			>確認して明細を取り込む</Button
		>
	</section>
{/if}
