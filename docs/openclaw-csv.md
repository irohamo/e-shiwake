# OpenClaw + CSV workflow (2026-10-23)

## User workflow

1. `/server/import/` で銀行・カード・売上CSVを選ぶ。UTF-8/Shift_JIS、日付/摘要/金額/取引先/明細IDの列を割り当てる。入金・出金の別列にも対応。
2. 同じ口座・カードの識別名を継続使用する。プレビューで新規/重複/内容競合を確認し、明細として保存する。この段階では帳簿は増えない。
3. 会計専用OpenClaw Agentが未分類明細と勘定科目を読み、pending候補と根拠・不明点を提出する。
4. `/server/review/` で元明細、税区分、金額、根拠、不明点を確認。必要なら修正してから承認または却下。承認transactionだけが既存JournalEntryへ転記する。
5. 試算表/PL/BSは確定帳簿から既存の計算関数で生成する。

## API and authority

`/api/agent/{resource}` は専用Bearerのみ。owner sessionとは別の認証。hash fileをDocker secretとして読み、raw keyはDBに保存しない。1分120回まで。

Read: `accounts`, `journals`, `transactions`（未分類queue）, `proposals`, `status`, `trial-balance`, `profit-loss`, `balance-sheet`。帳票には`?year=2026`、monthly PL/trial balance/journalsには`?month=2026-10`。`evidence` は未対応を明示する。

Write: `POST proposals`（Draft/Pendingだけ）、`POST annotations`（explanation/question/classification）。承認/却下/確定仕訳変更は不可。入力形式は`src/lib/server/workflow-schema.ts`とSkillの例を参照。

Owner専用: `/api/workflow/{proposals,decision,annotations,csv-preview,csv-commit}`。cookie + same Originが必須。GET `transactions`, `proposals`, `status`。Agentキーではこれらの権限を得ない。

候補はversionで排他。説明追加もversionを進め、古い画面からの承認は409。候補作成のrequestIdと承認のposting IDを一意に保持し、再送や同時操作で二重転記しない。同じ明細にactive候補は1つ。却下後は再提案できる。承認時に明細を照合済みにする。

CSV・根拠・注記はuntrusted dataとして表示し、命令として実行しない。Agentツールに承認機能が存在しないため、信頼度100や「承認済み」という原文でも帳簿へ書けない。家事按分100%以外は未対応として承認を拒否し、勝手に小数計算しない。

## CSV adapter

`csv-import.ts`は外部データの正規化専用。汎用bank/card/salesに共通の列mappingを使用。固有銀行の形式を自動判定すると保証しない。

- 1回につきUTF-8換算60KB、500行。大きいファイルは月別等に分割。
- YYYY-MM-DD / YYYY/MM/DD、整数JPY、引用符/埋め込み改行/BOM、カンマ区切り金額に対応。
- 金額1列は「正=入金」または「正=利用」を明示。入出金2列は正数の入金と出金を差し引く。同じ行で両方を正額にすることは不可。
- source + account + externalId、IDなしなら正規化日付/金額/摘要/取引先のhashで重複判定。IDなしの同一内容別取引は区別できないため固有IDを付ける。ファイル内重複は黙って落とさずエラー。
- 外部IDが同じで金額等が異なる場合は競合としてbatch全体をrollback。previewは15分有効でserverに保存し、commit時に再比較。commit再送は同じ結果。
- 原文rowは帳簿とは別のSQLite tableで保存。税区分・科目を自動確定しない。

## Schema / backup

v1 -> v2はSQLite VACUUM INTOで事前snapshotを作成し、transactionで追加tablesとschema versionを保存する。v1の帳簿を保持する。既存backup/restore CLIはv1/v2を受け付ける。復元先は新しいpathのみ、sessionは失効。

## OpenClaw installation

公式Skills仕様: https://docs.openclaw.ai/tools/skills 。使用中のバージョンのCLI `skills install --help` と同梱sandbox docsも確認する。

Skill: `integrations/openclaw/e-shiwake-accounting/`。client.mjsは固定のAPIパスしか扱わず、stdin JSONをHTTPへ送り、shellやSQLへ展開しない。

汎用Agentへhost実行Skillとして入れず、会計専用Agentのworkspace/skillsに配置する。`integrations/openclaw/accounting-agent.example.json`は会計Agentのsandbox設定。実ホストに合わせworkspaceを設定し、readonly workspace内の`.secrets/agent-token`に専用キーのみを置く。所有者secret、会計DB、Docker socket、SSH key、OpenClaw全体の設定をmountしない。

Composeの`e-shiwake-agent` networkはinternal。sandboxは同じnetworkへ参加して`http://accounting:3000`に接続し、一般Internetには出られない。Nodeはsandbox内にあり、exec/read/process以外のtoolsとelevatedを許可しない。Gateway/operator自体はtrustedで、既存の汎用Agentの権限が制限されたとは扱わない。権限検証はsandboxのmountと実アクセスで確認する。

## Scope still remaining

PDF/Gmail/ASC/Stripe連携、Local帳簿migration実行、freee用CSV export、逆仕訳・年度締めUI、完全な証憑照合は未実装。closed_yearsに登録済みの年への投稿は拒否するが、年度末締め操作UIはまだ提供しない。freee互換性は保証しない。Read APIは1回500件まで、未分類queueは処理後に次の明細を取得できる。

## Verified deployment

会計専用Agent IDは`accounting`。2026-10-23に実Gateway経由のread-only turnで、Skillを読みsandbox_execから`client.mjs status`を実行できた。新Agentのmodelを独自指定せず、既存設定を継承した。

実sandboxはUID/GID1000、read-only root、read-onlyの`/agent`と`/workspace`だけをmount。会計DB、owner secret、SSH鍵、Docker socketは存在しないことを確認。内部networkからAgent status=200、Agent帳簿POST=403、owner API GET=401、外部HTTPS接続不可を確認した。elevatedは無効、ツールはread/sandbox_exec/sandbox_processのみが実際のturnへ渡された。

既存main Agentのentry・チャネルbinding・global toolsは維持。複数Agent追加によって既存の定期処理が無効化されないよう、暗黙の担当だったmainを`agents.defaults.heartbeat.agentId`と`agents.defaults.systemAgent.agentId`で明示した。Gateway/host管理者と既存main自体をsandbox化したわけではない。

localの全782 tests、型check 0 errors/warnings、追加コードESLint、Server/Local builds、Local PWA offline reloadを確認。hp-i3の稼働imageを使う一時DBで、PC/iPhone相当幅のCSV preview/commit/reimport・候補作成・修正・承認・却下・承認前非転記・古いversionの拒否・PL/BS/試算表を検証し、関連console errorなし。iPhone実機/Safariは未検証。Browser pluginは使えるskill一覧になかったため既存Playwrightを利用した。
