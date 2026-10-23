<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { base } from '$app/paths';
	import { useSidebar } from '$lib/components/ui/sidebar/context.svelte';
	import type { NavGroup } from './sidebar-nav';

	interface Props {
		group: NavGroup;
		pathname: string;
	}

	let { group, pathname }: Props = $props();
	const sidebar = useSidebar();
	function isCurrent(href: string) {
		return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
	}
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>
		<group.icon class="size-4" />
		{group.label}
	</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<Sidebar.Menu>
			{#each group.items as item (item.href)}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton isActive={isCurrent(item.href)}>
						{#snippet child({ props })}
							<a
								href="{base}{item.href}"
								{...props}
								aria-current={isCurrent(item.href) ? 'page' : undefined}
								onclick={() => sidebar.setOpenMobile(false)}
							>
								<item.icon class="size-4" />
								<span>{item.label}</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/each}
		</Sidebar.Menu>
	</Sidebar.GroupContent>
</Sidebar.Group>
