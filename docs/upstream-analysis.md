# Upstream調査（2026-10-22）

調査対象: shuji-bonji/e-shiwake `2228be1b098a54ebd3c90a03a44fa55248e31d21` (MIT、LICENSE保持)。参考: e-shiwake-ai `26371e8130e749a137bef1886fcb93280fc85fbd`。

## 構造と再利用

- `src/routes`: 仕訳帳、元帳、試算表、損益、貸借、青色申告、固定資産、請求書、証憑、データ管理、チャット。
- `src/lib/types`: JournalEntry/JournalLine/Account/税区分、branded types、決算書・請求書。複合仕訳は既にlines配列で表現。
- `src/lib/utils`: trial-balance/profit-loss/balance-sheet/ledger/blue-return/depreciation/tax/business-ratio。DB非依存の関数をそのまま使用する。税・按分には既存の小数演算があるので新規サーバーAPIでは円整数以外を拒否し、按分の移植は別途丸め規則の確認が必要。
- `src/lib/db`: Dexie schema v1以降のマイグレーション、科目seed、各repository、import-export。Storage Adapterは未実装。`settings.storageMode`は証憑のIndexedDB/ファイル保存先であり、新設するlocal/serverモードとは別物。
- `src/lib/components`: shadcn/bits-ui、仕訳行、AccountSelect/TaxCategorySelect、帳票、レスポンシブsidebar。共通UI部品と科目・税区分選択を再利用。
- `src/lib/webmcp`: 型とvalidation、ブラウザ用CRUD/レポート/UIツール。直接確定帳簿への追加・削除が可能なのでAgent APIとして公開しない。集計関数とDTOを再利用し、権限は新設する。
- `src/lib/llm`: provider/config-store/agent-loop/tool-bridge/chat。ブラウザDBに設定・会話を保存。Server Modeでは無効化し、秘密鍵をこの設定へ移さない。
- `src/lib/db/import-export.ts` + `utils/zip-*`: JSON/ZIPの年度export・全件backup・archive、復元とpreview。freee用として扱わない。旧exportにはBlob実体がないため証憑の別検証が必要。
- テスト: Vitestのserver project + fake-indexeddb、client projectはbrowser-playwright。会計集計・税・repository・import/export・WebMCPに既存回帰テストあり。既存テストを保持する。
- デプロイ: adapter-static、production base `/e-shiwake`、全ページprerender、PWA Service Worker、GitHub Pages workflow。サーバーroute追加だけでは稼働しない。

## 移植時の課題と採用判断

225箇所程度のDB参照があり、repository以外にも直接Dexieを参照する。全テーブルを擬似Dexie HTTP Proxyに置換するとtransaction/liveQuery/Blob等の意味が変わる。Phase 1は限定されたStorage Adapter契約と専用画面で垂直スライスを作り、未移植routeをサーバー側で拒否する。Local Modeは既存経路のまま維持する。

## e-shiwake-ai

`packages/core`は型・計算関数、`packages/db`はbetter-sqlite3・schema・repository、`packages/mcp-server`はstdio MCP構成。READMEに「SQLiteは本番IndexedDBの複製、同期なし」のアーカイブ理由がある。SQLiteのWAL/FK・repository分離やMCPツールの分割は参考になる。一方、別coreへのコード複製、REAL金額、帳簿直接CRUD、IndexedDBとの複製構成は採用しない。SQLiteを唯一の正本にして、AIは将来の候補APIのみを利用する。

## 外部仕様の確認先

- https://github.com/shuji-bonji/e-shiwake
- https://github.com/shuji-bonji/e-shiwake-ai
- https://svelte.dev/docs/kit/adapter-node （使用するKit 2に合わせadapter-node 5系を選ぶ。6系はKit 3が必要）
- https://support.freee.co.jp/hc/ja/articles/202847320 （仕訳と取引のインポートは別。Phase 5で当時の公式仕訳テンプレートを取得し、テスト事業所に取り込むまで互換性を保証しない）
