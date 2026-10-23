# Host expense intake

`~/.local/bin/eshiwake-expense-ingest < receipt.json`

JSON fields: `source` (`icloud` or `gmail`), stable `messageId`, ISO `receivedAt`,
`vendor`, `date` (YYYY-MM-DD), integer JPY `amount` including tax,
`taxRate` (0/8/10, or null/omitted when unstated; defaults to 10%), optional `invoiceNo`, `subject`, optional `raw` (base64 MIME).
Without raw MIME, a clearly labelled payload snapshot is retained and a review
question is added. This is not an original receipt.

Credentials are consumed privately from the owner-configured Agent and Gmail
intake token files. Never log either file. Host HTTP is restricted to loopback;
HTTPS is supported with ESHIWAKE_URL. The existing Agent client already defaults
to loopback and the host token path.

Rules: ~/.config/e-shiwake/vendor-rules.json; vendor keys match exactly after
trim/lowercase. Unknown vendors use fallbackDebit and always need review.
3003 is always credited. Known business expenses have businessRatio 100.
Apple Developer Program is distinct from personal entertainment subscriptions.

UUIDv5 uses the DNS namespace over source + NUL + messageId. Both journal line
IDs are deterministic. Evidence keys use source + SHA256(messageId) + raw.
Retrying the same payload is safe after partial failure; changed content on the
same key conflicts. The server's unique requestId protects proposal creation.
Evidence linking is idempotent and cannot replace an existing link.

Audit: ~/.local/state/e-shiwake/expense-audit.jsonl (private, no body or tokens).
`auto:true` permits server-side approval only with the owner-enabled positive
policy, an exact sender match and an aligned DKIM pass in Authentication-Results,
plus all receipt, metadata, accounting and deduplication checks. Other items stay
in manual review at /server/review. See POSITIVE-RULE-REVIEW.md for trust limits.

Owner decision (2026-10-23): likely tax-exempt with no invoice registration.
Unstated receipt rates use `defaultTaxRate: 10` (`purchase_10`), without a tax-rate
question. Explicit 0/8/10 rates always win. Original metadata retains null for an
unstated rate. Other review conditions remain in effect.
