<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { page } from '$app/state';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	import { base } from '$app/paths';
	import { navGroups } from './sidebar-nav';

	const currentTitle = $derived.by(() => {
		const path =
			(page.url.pathname.startsWith(base)
				? page.url.pathname.slice(base.length)
				: page.url.pathname
			).replace(/\/$/, '') || '/';
		if (path.startsWith('/help')) return 'ヘルプ';
		if (path.startsWith('/invoice/')) return '請求書';
		return (
			navGroups.flatMap((group) => group.items).find((item) => item.href === path)?.label ??
			'e-shiwake'
		);
	});
</script>

<header
	class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
>
	<Sidebar.Trigger class="-ml-1" />
	<Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
	<div class="flex flex-1 items-center gap-2">
		<span class="font-medium">{currentTitle}</span>
	</div>
	<ThemeToggle />
</header>
