<script lang="ts">
	import { page } from '$app/state';
	const links = [
		{ href: '/server', label: '仕訳入力・一覧' },
		{ href: '/server/review', label: '承認待ち' },
		{ href: '/server/import', label: 'CSV取り込み' }
	];
	const pathname = $derived(page.url.pathname.replace(/\/$/, ''));
</script>

<nav aria-label="帳簿メニュー" class="mb-6 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 text-sm">
	{#each links as link (link.href)}
		<a
			href={link.href}
			aria-current={pathname === link.href ? 'page' : undefined}
			class="flex min-h-11 items-center justify-center rounded-lg px-2 py-2 text-center font-medium hover:bg-background focus-visible:outline-2 focus-visible:outline-ring"
			class:bg-background={pathname === link.href}
			class:shadow-sm={pathname === link.href}>{link.label}</a
		>
	{/each}
</nav>
