# Local → Server migration

Phase 1では実行可能なmigration endpointを提供しない。既存の全年度ZIPバックアップを保管し、Local DBを削除しない。通常のServer仕訳保存APIは証憑/独自科目等を含む旧backupの代用ではない。

Phase 4で次の手順を実装する。

1. Local側の既存backup exporterから全年度JSON/ZIPを生成。原本の複製とSHA-256を保管。
2. JSON version/schema、金額整数、借貸一致、科目/証憑/請求書参照、重複ID・fingerprint、Blob有無を検査。既存サーバーDBと比較した件数/競合/不備/期首残高をpreview。取込対象外項目を黙って破棄しない。
3. preview結果と入力hash・サーバーrevisionを紐付け、期限付きのmigration planを作成。ユーザーが確認。
4. SQLite online backup APIでDBスナップショット、証憑のmanifestとファイルをbackup。backup失敗時は取込禁止。
5. BEGIN IMMEDIATEでrevisionを再確認し、全件をtransactionで保存。既存IDが同内容ならskip、異内容なら中止。科目・年度・参照整合性と取込前後の試算表を比較。
6. 不一致はrollback。成功はbatch/入力hash/件数/試算表/実行者をauditへ保存。同batchの再実行を禁止。
7. 本人がブラウザ2つで照合してからServer運用へ切替。Local原本はread-only backupとして残す。双方向同期とオフライン編集は提供しない。

## Server backup/restore

`scripts/server-backup.mjs` はSQLite backup APIでWALを含む整合snapshotを生成する。停止中の単純なdbファイルコピーに頼らない。restoreはCompose停止後、別パスへ復元しintegrity_check/FKと試算表を検証してからDB_PATHを切替。旧DBを保持し失敗時は元pathへ戻す。鍵はDBとは別に安全にbackup。Phase 1で証憑実体は存在しない。Phase 4で証憑とDBの一致manifestを追加する。
