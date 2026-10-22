# Architecture

## 決定

既存SvelteKit 2 + TypeScriptを維持し、ビルド時 `PUBLIC_ACCOUNTING_MODE=server` でadapter-node、既定localでadapter-staticを選択する。両モードを同じoriginに載せ替えない（既存PWAキャッシュとの混同を防ぐ）。サーバー起動時も同じmodeを渡し、不一致は503で停止する。

Server Modeは単一SvelteKitプロセス + SQLite (better-sqlite3)。ORMは最小契約のSQLが小さいため導入しない。Zodで境界を検証し、円は安全整数のみ、合計はBigIntで検証してから既存の集計関数へ渡す。DBはINTEGER、FK・WAL・busy_timeout、transactionで仕訳ヘッダー/明細/監査ログを同時保存する。SQLiteは正本、ブラウザキャッシュ/IndexedDBを帳簿書き込み元にしない。

`AccountingStorage`は科目一覧・仕訳一覧・人間の仕訳保存の狭い契約。Local Adapterは既存repositoryへdelegation、HTTP AdapterはAPI、SQLite Adapterはbackend専用。既存全機能のadapter化を済ませたとは扱わない。Phase 1 Server UIは共通Button/Input/科目選択/税区分選択部品を利用。旧root layoutのDB初期化/チャット/WebMCP/PWAはserverで実行せず、未移植routeを拒否する。

## 信頼境界

Web UIは単一所有者用パスワードログイン。パスワードはscrypt hashをsecret fileで読み、ランダムsession tokenはHttpOnly/SameSite=Strict cookie、DBにはhashと有効期限のみ保存。HTTPSではSecure。ログインは回数制限、APIは認証・same-origin検査・JSON限定・サイズ上限、すべてno-store。APIにAgent権限はまだ存在せず、Bearer鍵を使って確定仕訳を書けない。OpenClawへ所有者password/session/DB volumeを渡さない。

Composeは127.0.0.1だけにpublish、Tailscale ServeのHTTPS経由で使用。OpenClawは別プロセス/コンテナでDB mountなし。インターネット向けreverse proxyやポート公開は禁止。証憑はPhase 1非対応でAPIは添付ありを拒否する。

## 帳簿と候補

Phase 1は人間の新規確定仕訳のみ。更新/削除APIを設けず監査ログを残す。Phase 2で候補を別テーブルに保持し Draft → Pending Review → Approved / Rejected とする。承認transactionのみが帳簿へ転記。Reversedは元仕訳の削除でなく逆仕訳のリンク。締め年度を全書き込み経路で検査。AI信頼度は表示用。証憑・メール・説明は常にuntrusted data、tool権限やsystem指示に変換しない。

## 今後の境界

ImportAdapterはexternal transactionを生成しprovider/account/externalIdまたはcanonical fingerprintで一意化。原文・証憑hashと取込batchを保持し、売掛/源泉/手数料/返金/入金照合を別項目にする。不明な税務判断は質問として残す。ExportAdapterは年度/科目/税区分mapping/versionを記録し、export batchと仕訳IDで再出力を警告する。freee側の再importをCSVだけで強制防止できるとはしない。

## Phase 1時点のOS権限の境界

会計は別コンテナで、OpenClawへDB volume/API認証情報を接続していない。ただし今回確認した既存OpenClawはDocker操作権限を持つホストユーザーのuser serviceで稼働している。別プロセス・別コンテナだけでは、このユーザーによるDocker経由のDB/secretアクセスをOS権限で遮断できない。Agent用のOSユーザー/実行環境を分離し、Docker socket・会計secret・DB volumeへの権限を外す作業はPhase 3で実施する。現時点でOpenClawの権限隔離まで完了したとはしない。
