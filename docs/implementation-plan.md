# Implementation plan / handoff

## 今回: Phase 0 + Phase 1

- [x] upstream/旧AI版の構造・再利用・危険な同期構成を調査
- [x] 設計・移行計画を記録
- [x] upstreamテストbaseline → Storage契約・SQLite/API/Auth → Server UI → Compose
- [x] 単体・API・複数ブラウザ・永続化・Local build/PWAオフライン回帰を検証（`docs/verification.md`）

## Phase 2

候補/質問/説明/evidence参照schemaとversion、状態遷移service、承認時の一意なposting、同時承認の排他、却下、監査、逆仕訳、年度締め。Review Inboxは元明細/証憑/提案/根拠/税区分/按分を並べる。既存の確定仕訳に対する直接update/deleteは公開しない。draftが全レポートに混入しないことをtest。

## Phase 3

既存OpenClawをDocker socket・会計secret・DB volumeへアクセスできないOSユーザー/実行環境に分離し、拒否を実機で検証する。所有者cookieと独立したhash保存Agent token + scope。read: 科目/帳簿/候補/証憑metadata/未分類/照合/月次/集計、write: 候補/説明/分類提案/確認事項のみ。MCP SDKまたはOpenClaw skillはHTTPを呼びDBをmountしない。WebMCPのドメインDTO・集計を共有し、既存CRUD権限は継承しない。untrusted documentのprompt injection fixture、確定帳簿変更禁止test。

## Phase 4

銀行/カード/売上CSV adapters、文字コードと列mapping、preview/batch/fingerprint、PDF private storage + hash + authenticated stream、金額/取引先/日付検索。Gmail/ASC/Stripeはprovider adapter境界のみ先行設計。源泉徴収・未入金・手数料・返金は個別の明細と照合関係、曖昧な税務は人間へ確認。上記migration計画を実装しfailure injection test。

## Phase 5

当時のfreee公式「仕訳」テンプレートを保存しversion/hash/取得日を記録。科目/税区分mapping、複合仕訳/文字コード/CSV escaping/年度/締め検査、export history/再出力警告、freee側試算表比較。sandboxまたはテスト事業所でimport結果を確認するまで互換性未保証。最終申告提出は本人。

## 継続作業の原則

Local既存routeを移植するたびStorage契約を小さく拡張し、DB直参照を除去し、browser testを追加してからServer routeのallowlistへ追加。DB schema変更はversioned migrationとして既存データをbackup後に適用する。実データ/鍵/証憑/DBはGit禁止。

## 2026-10-23追加実装

Phase 2の最小レビュー（Draft/Pending/Approved/Rejected、修正・監査・同時操作防止）、Phase 3の制限付きAgent APIと専用sandbox Agent、Phase 4の汎用CSV preview/import/重複検査を実装。逆仕訳・年度締めUI・PDF・Local migration・freee export等は未実装。実際の境界と検証は`docs/openclaw-csv.md`を参照。
