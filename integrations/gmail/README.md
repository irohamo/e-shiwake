# Dedicated Gmail evidence collector (initial hold policy)

Implementation started 2026-10-23 on hp-i3. This is **not an enabled Gmail connection or scheduler**.
This independent package uses Google's official `googleapis` client. Existing Agent tokens,
owner credentials and Codex-connected Google credentials are not reused.

## Completed boundary

- POST `/api/integrations/gmail/evidence`: dedicated bearer SHA-256 hash file only;
  no list, answer, proposal approval or DB access for this principal.
- Owner session + same-origin POST `/api/evidence/decision`: `answer`, `link`, `review`.
  GET `/api/evidence/inbox`, `/api/evidence/original?id=UUID` require owner authentication.
- SQLite additive, transactional feature migration with consistent pre-migration snapshot.
  SHA-256 blobs under `ACCOUNTING_EVIDENCE_PATH` outside repository/static; 0700/0600.
  Account/message/part uniqueness rejects changed retries. Equal bytes on different messages
  remain distinct evidence records; content duplication is a separate hold check.
- `hold-v1`: immutable review snapshots include evidence/proposal versions, original hash,
  original availability, content-duplicate and closed-year/ratio checks where linked.
  **No accounting rules are configured: every case remains needs_answer, never posted.**
  AI confidence, email text and even owner answers alone do not establish a tax rule.
  Existing manual posting transactions, stale version protection and Agent sandbox are unchanged.
- Review Inbox renders grouped owner questions as escaped text, stores versioned answers and
  re-runs review. No timeout approval or external notifications.
- One-shot bounded polling: selected user labels (AND), last 30 days, max 1..30 messages,
  24h checkpoint overlap, exclusive lock, 3 retries for 429/selected 5xx, timeouts.
  Checkpoint advances only when the entire bounded result is saved (no next page).
  Interrupted/truncated runs are idempotent; narrow the allowlist if the cap is exceeded.

## hp-i3 deployment status (2026-10-23)

Backend image `4017eece1265` has been applied with the optional override after a consistent
0600 SQLite backup. Existing accounting-table fingerprints stayed unchanged after migration.
Login/owner/intake guards and SQLite quick_check passed. No real mail/evidence was imported.
Private state directory: `/home/irohamo/.local/share/e-shiwake-gmail` (0700).
A **new** intake bearer and its separate Backend hash have already been provisioned privately;
step 5 below is complete for this host. `config.json` has an empty label allowlist deliberately.
No client.json/token.json exists yet. Actual fetch confirmed STOPPED before network work.
No collector container, periodic job, Gmail connection or positive approval rule is running.
Review UI: https://hp-i3.tail8f5301.ts.net:8443/server/review/ (tailnet/owner login only).
Use the override on future deployments as shown below; ordinary base-only Compose disables
intake authentication by omitting its hash configuration (fails closed).

## Owner preparation (all together; no secrets in chat)

1. In your own Google Cloud project, enable Gmail API and configure OAuth consent.
   Create a **Desktop app** OAuth client and download JSON. No account/project/billing
   is created by this implementation. External consent Testing can expire grants;
   use a suitable consent publishing mode for sustained personal use.
2. Create a private directory **outside Git**, e.g.
   `/home/irohamo/.local/share/e-shiwake-gmail` (0700), and put the downloaded JSON there
   as `client.json` (0600). Do not paste it, token.json or bearer tokens into chat.
3. Set `GMAIL_STATE_DIR` to that directory. In `integrations/gmail`, run `npm ci` and
   `npm run oauth`. On your own computer establish
   `ssh -L 8765:127.0.0.1:8765 irohamo@hp-i3` over Tailscale/SSH first.
   Open the **locally printed Google consent URL** in your own browser.
   The callback is `http://127.0.0.1:8765/oauth2callback`; no public listener.
   Only `gmail.readonly` is requested and the actual token scopes are checked.
   Callback state + PKCE are verified, refresh tokens stored 0600 outside Git.
4. Select explicit Gmail user-label IDs and a nonsecret mailbox alias. Create private
   `config.json`, for example:
   `{"account":"business-mailbox","labelIds":["Label_REPLACE"],"maxMessages":10,"backend":"http://127.0.0.1:3000/"}`.
   Label selection is an application filter, **not a Google scope restriction**.
   Without config/allowlist or OAuth, fetch stops without fetching mail.
5. Provision a **new** random 32-byte hex intake bearer into private `ingest-token` (0600),
   and its SHA-256 hash into repository-excluded `secrets/gmail-token.hash` (0600).
   Do not reuse owner or Agent secrets. Optional `compose.gmail.yaml` gives only the hash
   to Backend. A collector container config must use `http://accounting:3000/`; host runs use
   loopback. Compose user `node` must own/read the mounted state directory.
6. After Backend checks and backup, apply the optional override explicitly:
   `docker compose -f compose.yaml -f compose.gmail.yaml up -d --build accounting`.
   Run one bounded fetch manually first. Do not schedule until targets and failure behavior
   are verified. No cron/systemd/OpenClaw job has been added.

Review UI: existing Tailscale accounting origin + `/server/review/` (owner login required).
A live OAuth URL is intentionally not pre-generated without the owner's client file.

## Limits / pending work

- 8MiB **per original**, 12MiB dedicated intake JSON limit. All existing JSON APIs retain
  their 128KiB limit. Oversized MIME/PDF stops the run without advancing checkpoint; no
  silent omission. Large-message streaming remains a future extension.
- No OCR/PDF execution or network-following, AI extraction, invoice/order entity resolution,
  automatic journal candidate generation, matching existing bank/card transactions or validated
  positive approval rules yet. Owner can link existing proposals; initial review is all-hold.
- No `history.list` cursor: bounded rolling `messages.list` with durable completion watermark.
- Audit captures each review and answer; answer/proposal changes are re-read during review.
  A future positive rule must review and call existing WorkflowService.decide/postJournal inside
  one immediate transaction, with current version and deterministic posting id. No positive
  rule must be enabled until evidence/date/amount/tax/payment/business/dedup checks all exist.
- Migration snapshots contain private data. Existing backup encryption/retention must be applied
  operationally; this change does not claim encrypted backup or retention automation.

Official references checked 2026-10-23:
- https://developers.google.com/workspace/gmail/api/quickstart/nodejs
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://github.com/googleapis/google-api-nodejs-client
- https://developers.google.com/identity/protocols/oauth2/native-app
