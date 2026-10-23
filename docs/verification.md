# Phase 0 / Phase 1 verification

2026-10-22、人工データのみで検証。実際の会計データ・メール・証憑は未投入。

| 対象                              | 結果                      | 証拠・境界                                                                     |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| 変更前のupstreamテスト            | 37 files / 757 tests PASS | 既存会計・Dexie・import/export・WebMCPのbaseline                               |
| 変更後の全unit tests              | 41 files / 769 tests PASS | 上記維持 + SQLite/認証/JSON上限/Local adapter/復元CLI                          |
| svelte-check                      | 0 errors / 0 warnings     | TypeScript/Svelte                                                              |
| 追加ファイルのESLint + diff check | PASS                      | repo全体の既存lint違反を除く変更範囲                                           |
| Server build                      | PASS                      | adapter-node、Kit 2のまま                                                      |
| Local build                       | PASS                      | adapter-static、PWA 231 cache entries                                          |
| Local実ブラウザ                   | PASS                      | 仕訳帳起動、IndexedDB初期化、SW制御、offline reload                            |
| Server E2E                        | PASS                      | Chromium desktop 1440x1000 / mobile 390x844、独立した2 browser contexts        |
| 永続化・共有                      | PASS                      | UIから保存 → 第2browser再読込、別接続/restart後の同一仕訳                      |
| 会計                              | PASS                      | 貸借一致・複合仕訳・整数JPY・存在科目・日付検査、既存試算表関数                |
| 再送                              | PASS                      | requestId同内容は同ID、別内容409。CSV重複検出の代用ではない                    |
| 原子性                            | PASS                      | audit失敗を注入し、header/lines/audit全部rollback                              |
| アクセス制御                      | PASS                      | 未認証/Bearerだけでは401、更新PUT405、別Origin403、logout後401                 |
| 大きい本文                        | PASS                      | Content-Lengthとstream両方の制限、413後も正常に別requestを処理                 |
| SQLite backup/restore             | PASS                      | WAL online snapshot、integrity/FK、別path復元、session失効、上書き拒否         |
| dependency audit                  | 0 vulnerabilities         | production + development、確認時点のregistry結果。cookie/parser overrideを含む |
| Debian 13 Docker                  | PASS                      | hp-i3で非root/read-only root、volume永続化、loopback publish                   |
| Tailscale HTTPS                   | PASS                      | 実URLへ2browser login/read/logout、Secure/HttpOnly/Strict cookie、帳簿0件      |

Browser pluginは利用可能なskill一覧になかったため、既存Playwrightを使用。console/pageerrorに関連エラーなし、desktop/mobileスクリーンショットを確認。iPhone実機/Safariの動作確認ではない。

## 残る未検証・未実装

承認/却下/逆仕訳/年度締め、OpenClaw専用Agent API/MCP、既存全画面のServer移植、証憑とLocal→Server migration、CSV import、freee export/実際のimport/試算表照合はPhase 2以降。これらの互換性や運用完成を保証しない。

今回のServer帳簿は人間が新規保存する仕訳のみで、編集/削除APIなし。既存Localの全画面を個別に手動検証したわけではないが、757件の既存テスト・static build・起動画面・offline reloadを維持した。サーバー再起動のテストはアプリ/コンテナ単位であり、hp-i3のOS自体のreboot試験はしていない。

## 依存更新

既存Kit 2の範囲内で監査修正版を適用。Vitest/browser-playwrightを同じ4.1.12へ、sharpを0.35.5系へ。Kitのcookie依存は0.7.2系、typographyのparser依存は7.1.7系へoverride。これらを外す場合はauditと両モードbuild/回帰を再実行する。Kit 3への全面移行は行っていない。

## 再実行

```sh
npm ci
npm test
npm run check
PUBLIC_ACCOUNTING_MODE=server npm run build
node scripts/server-smoke.mjs
npm run build
```

Server E2Eには`npx playwright install chromium`で対応ブラウザが必要。ローカルloopbackへのlistenとブラウザ起動が許可された環境で実行する。
