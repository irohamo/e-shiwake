<script lang="ts">
	import type { HTMLTableAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLTableAttributes> = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (横スクロール領域をキーボードでも操作できるようにする) -->
<div
	data-slot="table-container"
	role="region"
	aria-label="帳簿の表（左右にスクロールできます）"
	tabindex="0"
	class="relative w-full overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
>
	<table
		bind:this={ref}
		data-slot="table"
		class={cn('w-full caption-bottom text-sm tabular-nums', className)}
		{...restProps}
	>
		{@render children?.()}
	</table>
</div>
