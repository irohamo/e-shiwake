// Run against a SERVER build. Creates a temporary synthetic book, never production data.
import { chromium, request } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(), 'eshiwake-e2e-'));
const origin = 'http://127.0.0.1:3107';
const password = randomBytes(24).toString('hex');
const salt = randomBytes(16).toString('hex');
const secret = join(dir, 'password.hash');
writeFileSync(secret, `${salt}:${scryptSync(password, salt, 64).toString('hex')}`, { mode: 0o600 });
let server;
let browser;
const logs = [];
function start() {
	server = spawn(process.execPath, ['build'], {
		env: {
			...process.env,
			PUBLIC_ACCOUNTING_MODE: 'server',
			ACCOUNTING_MODE: 'server',
			ACCOUNTING_DB_PATH: join(dir, 'book.sqlite'),
			ACCOUNTING_PASSWORD_HASH_FILE: secret,
			ORIGIN: origin,
			HOST: '127.0.0.1',
			PORT: '3107'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout.on('data', (data) => logs.push(String(data)));
	server.stderr.on('data', (data) => logs.push(String(data)));
}
async function stop() {
	if (!server || server.exitCode !== null) return;
	const done = new Promise((resolve) => server.once('exit', resolve));
	server.kill('SIGTERM');
	await done;
}
async function ready() {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(origin + '/login')).status === 200) return;
		} catch {}
		if (server.exitCode !== null) throw new Error(logs.join(''));
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('Server did not become ready: ' + logs.join(''));
}
try {
	start();
	await ready();
	const anonymous = await request.newContext({ baseURL: origin });
	assert.equal((await anonymous.get('/api/accounting/journals')).status(), 401);
	assert.equal((await anonymous.get('/data/')).status(), 404);
	assert.equal(
		(
			await anonymous.post('/api/accounting/journals', {
				headers: { origin, authorization: 'Bearer agent-token' },
				data: {}
			})
		).status(),
		401
	);
	assert.equal(
		(
			await anonymous.post('/api/auth/login', {
				headers: { origin: 'https://attacker.invalid' },
				data: { password }
			})
		).status(),
		403
	);
	assert.equal(
		(
			await anonymous.post('/api/auth/login', { headers: { origin }, data: { password: 'wrong' } })
		).status(),
		401
	);
	browser = await chromium.launch({ headless: true });
	const first = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	const second = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true
	});
	const errors = [];
	for (const context of [first, second])
		context.on('page', (p) => {
			p.on('pageerror', (error) => errors.push(error.message));
			p.on('console', (msg) => {
				if (msg.type() === 'error') errors.push(msg.text());
			});
		});
	async function login(context) {
		const page = await context.newPage();
		await page.goto(origin + '/server');
		assert.match(page.url(), /login/);
		await page.getByLabel('パスワード').fill(password);
		await page.getByRole('button', { name: 'ログイン', exact: true }).click();
		await page.waitForURL('**/server/');
		await page.getByText('仕訳はまだありません。').waitFor();
		return page;
	}
	const a = await login(first);
	const b = await login(second);
	assert.match(await a.title(), /仕訳帳/);
	await a.getByLabel('摘要', { exact: true }).fill('E2E 複合仕訳');
	await a.getByLabel('取引先', { exact: true }).fill('合成テスト');
	await a.getByRole('combobox').filter({ hasText: '勘定科目を選択' }).first().click();
	await a.getByRole('button', { name: '現金', exact: true }).click();
	await a.getByRole('combobox').filter({ hasText: '勘定科目を選択' }).first().click();
	await a.getByRole('button', { name: '売上高', exact: true }).click();
	await a.getByLabel('行1 金額', { exact: true }).fill('1000');
	await a.getByLabel('行2 金額', { exact: true }).fill('1000');
	await a.getByRole('button', { name: '確認して保存' }).click();
	await a.getByText('仕訳をSQLiteに保存しました').waitFor();
	await b.getByRole('button', { name: '再読込', exact: true }).click();
	await b.getByRole('heading', { name: 'E2E 複合仕訳', exact: true }).waitFor();
	assert.equal(
		await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		true
	);
	assert.equal(await a.evaluate(async () => indexedDB.databases().then((d) => d.length)), 0);
	assert.equal(await b.evaluate(async () => indexedDB.databases().then((d) => d.length)), 0);
	const api = first.request;
	assert.equal((await api.get(origin + '/api/accounting/trial-balance')).status(), 200);
	const balance = await (await api.get(origin + '/api/accounting/trial-balance')).json();
	assert.equal(balance.totalDebit, 1000);
	assert.equal(balance.isBalanced, true);
	const journal = {
		date: '2026-10-22',
		vendor: 'API',
		description: '複合',
		evidenceStatus: 'none',
		attachments: [],
		lines: [
			{ id: randomUUID(), type: 'debit', accountCode: '1001', amount: 900 },
			{ id: randomUUID(), type: 'debit', accountCode: '1005', amount: 100 },
			{ id: randomUUID(), type: 'credit', accountCode: '4001', amount: 1000 }
		]
	};
	const payload = { journal, requestId: randomUUID() };
	const post = (data) =>
		api.post(origin + '/api/accounting/journals', { headers: { origin }, data });
	assert.equal((await post(payload)).status(), 201);
	assert.equal((await post(payload)).status(), 201);
	assert.equal(
		(await post({ ...payload, journal: { ...journal, description: 'different' } })).status(),
		409
	);
	assert.equal(
		(
			await post({
				...payload,
				requestId: randomUUID(),
				journal: { ...journal, date: '2026-02-30' }
			})
		).status(),
		400
	);
	assert.equal(
		(
			await api.put(origin + '/api/accounting/journals', { headers: { origin }, data: payload })
		).status(),
		405
	);
	assert.equal(
		(
			await api.post(origin + '/api/accounting/journals', {
				headers: { origin: 'https://attacker.invalid' },
				data: payload
			})
		).status(),
		403
	);
	assert.equal(
		(
			await api.post(origin + '/api/accounting/journals', {
				headers: { origin },
				data: { oversized: 'a'.repeat(140000) }
			})
		).status(),
		413
	);
	assert.equal(
		(await api.get(origin + '/api/accounting/journals')).headers()['cache-control'],
		'no-store'
	);
	await stop();
	start();
	await ready();
	await b.reload();
	await b.getByRole('heading', { name: 'E2E 複合仕訳', exact: true }).waitFor();
	assert.equal((await (await api.get(origin + '/api/accounting/journals')).json()).length, 2);
	if (process.env.SCREENSHOT_DIR) {
		mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
		await a.reload();
		await a.getByRole('heading', { name: 'E2E 複合仕訳', exact: true }).waitFor();
		await a.screenshot({
			path: join(process.env.SCREENSHOT_DIR, 'server-desktop.png'),
			fullPage: true
		});
		await b.screenshot({
			path: join(process.env.SCREENSHOT_DIR, 'server-mobile.png'),
			fullPage: true
		});
	}
	await b.getByRole('button', { name: 'ログアウト' }).click();
	await b.waitForURL('**/login/');
	assert.equal((await second.request.get(origin + '/api/accounting/journals')).status(), 401);
	assert.deepEqual(errors, []);
	await anonymous.dispose();
	console.log(
		'PASS: login, responsive UI, two independent browsers, no IndexedDB, restart persistence, compound journal, idempotency, authorization, CSRF, body limits, logout, console health'
	);
} finally {
	if (browser) await browser.close();
	await stop();
	rmSync(dir, { recursive: true, force: true });
}
