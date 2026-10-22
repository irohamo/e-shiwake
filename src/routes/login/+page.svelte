<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	let password = $state('');
	let message = $state('');
	let busy = $state(false);
	async function login(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = '';
		try {
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password })
			});
			password = '';
			if (!response.ok) {
				message = (await response.json()).message || 'ログインできませんでした';
				return;
			}
			await goto('/server');
		} catch {
			message = '接続できませんでした';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>ログイン | e-shiwake Server</title></svelte:head>
<div class="mx-auto mt-16 max-w-sm rounded-xl border bg-card p-6 shadow-sm">
	<p class="text-sm text-muted-foreground">e-shiwake / Server Mode</p>
	<h1 class="my-3 text-2xl font-bold">帳簿にログイン</h1>
	<p class="mb-6 text-sm text-muted-foreground">Tailscale経由で自分の帳簿へ接続します。</p>
	<form onsubmit={login} class="space-y-4">
		<label for="password" class="text-sm font-medium">パスワード</label>
		<Input
			id="password"
			type="password"
			autocomplete="current-password"
			bind:value={password}
			required
		/>
		<Button type="submit" disabled={busy} class="w-full">{busy ? '確認中…' : 'ログイン'}</Button>
		<p role="alert" class="text-sm text-destructive">{message}</p>
	</form>
</div>
