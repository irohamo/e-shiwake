# Server operations (Phase 1)

## Build / test

Node 24.22.1以上の24 LTSを使用。

```sh
npm ci
npm test
npm run check
PUBLIC_ACCOUNTING_MODE=server npm run build
node scripts/server-smoke.mjs
# 別途、Localの静的/PWA buildを検証
npm run build
```

最後のbuildによって出力先buildが置き換わる。server起動前はserver buildを再実行する。ServerとLocalには別originを使用。modeはビルド時固定で実行時ACCOUNTING_MODEと一致必須。

## Debian 13 deployment

```sh
mkdir -p secrets backups
chmod 700 secrets backups
# 対話入力はshell historyへ残さない。実際のpasswordをコマンドへ直接書かない。
read -rs -p 'Owner password (16+ chars): ' owner_password
printf '%s' "$owner_password" | node scripts/create-password-hash.mjs > secrets/owner-password.hash
unset owner_password
chmod 600 secrets/owner-password.hash
cp .env.example .env
# .envのORIGINを自分のtailnet HTTPS originへ設定
# UID1000(node)がsecretを読み、volumeへ書けることを確認

docker compose up -d --build
# Tailscale Serveは既存設定・443利用を確認し、専用ポートで設定する。
# 例: tailscale serve --bg --https=8443 http://127.0.0.1:3000
# この場合ORIGINは https://HOST.TAILNET.ts.net:8443
```

Composeはloopbackにのみ公開し、コンテナは非root・capなし・read-only root。DBはnamed volume。HTTPSのTailscale URLでログインする。OpenClawにはowner secret/cookie/volumeを渡さない。Phase 3以前はAgent APIなし。所有者は新規仕訳のみ保存可。証憑・旧Local管理画面はServerで404になる。

## Backup / restore

```sh
# ホストへbackupを取り出す。ファイル名は毎回新しくする。
docker compose exec accounting node scripts/server-backup.mjs /data/accounting.sqlite /data/backup-YYYYMMDD.sqlite
docker compose cp accounting:/data/backup-YYYYMMDD.sqlite ./backups/backup-YYYYMMDD.sqlite
chmod 600 ./backups/backup-YYYYMMDD.sqlite
```

別の暗号化保管先へ複製し、定期的に復元演習する。バックアップには金融情報とsession hashを含む。パスワードhashは別途安全に保管する。

復元は`docker compose stop accounting`後に行い、現在DBとWAL/SHMを保管してから別パスへbackupをコピーする。integrity_check/foreign_key_check/試算表を確認して新DBを使用する。sessionテーブルは復元時に削除して再ログインさせる。ライブDBだけの上書きやWALを残したままの置換は禁止。証憑整合検証はPhase 4の課題。新しいpathへの復元は `node scripts/server-restore.mjs BACKUP NEW_DESTINATION` を利用できる（既存ファイルの上書き拒否、整合性・借貸・schema検査、session失効）。

## API

- POST `/api/auth/login` JSON `{password}`: 所有者session cookieを発行、有効8時間、10回/分の全体制限。
- POST `/api/auth/logout`: session失効。
- GET `/api/accounting/accounts`, `/journals`, `/trial-balance`: 要session。
- POST `/api/accounting/journals`: `{requestId: UUID, journal: NewJournal}`。同じrequestId+同じ内容は同一ID。違う内容は409。整数円・実在科目・借貸一致が必須。証憑/按分/請求書リンクはPhase 1で拒否。

変更はすべてOrigin一致が必須。APIキーやBearerでの所有者操作は不可。cookie/sessionを持たないOpenClawからのアクセスは401。TLS外のHTTPはlocalhost開発/SSH tunnel検証のみ。

## 提案の質問解消（所有者API）

POST `/api/workflow/resolve-question` は所有者sessionと同一Originが必須。
`{id, version, question, answer, journal}` を渡すと、指定した未解決質問だけを除去し、
修正済みjournal・回答annotation・監査記録を同一トランザクションで保存する。
version競合・質問不存在は409。提案はpendingのままで、証憑再レビュー・自動承認・転記は行わない。
