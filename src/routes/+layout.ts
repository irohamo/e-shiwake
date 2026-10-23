// プリレンダリング + SSR
// IndexedDB アクセスは onMount 内で行うため SSR でも問題なし
export const prerender = !__ACCOUNTING_SERVER__;
export const ssr = true;
export const trailingSlash = 'always';
