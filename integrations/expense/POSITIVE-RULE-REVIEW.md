# Positive expense rule policy

The owner approved merge and deployment on 2026-10-23.
`compose.expense-policy.yaml` remains an explicit, separate opt-in override.

The server reads its own read-only vendor rules file. Agent-provided `auto` flags
cannot enable approval. Missing/unreadable config leaves hold-v1 active.
Rules need version 1, auto:true, debit, sender and subjectIncludes; skip/review
rules cannot approve. Google Cloud and povo have sender/subject conditions from
the owner's instructions. Dev SaaS without verified sender/subject conditions
stays in review until the owner supplies those conditions.

Approval requires original MIME hash integrity, no duplicate content, an open
year, pending status, businessRatio 100, no questions, exact vendor rule match,
matching original Message-ID/From/Subject, a DKIM pass for the exact sender domain
in Authentication-Results (header.d, or header.i when header.d is absent),
matching source/evidence metadata,
two balanced integer lines, rule debit, 3003 credit and consistent tax category.
It posts through the normal workflow and adds proposal.auto-approve audit with
policy version, rule, evidence ID/hash, proposal version and posted journal ID.
Audit failure rolls the approval back. The actor is backend-policy.

Authentication-Results must come from trustworthy mailbox originals provided by
an authenticated collector. The backend checks the recorded DKIM result; it does
not independently validate DKIM signatures or the provenance of that header.
DKIM-Signature alone, missing/failed DKIM, SPF alone, unaligned signing domains,
and malformed/ambiguous result clauses remain in review. Multiple result headers
and folded headers are supported. Exact domain alignment excludes subdomains.

The policy assumes correctly extracted date, tax and amount. It checks entry
structure and metadata binding but does not independently extract receipt values.
Currency is JPY; missing raw MIME, uncertain items, unknown vendors and partial
business use require owner review. Existing pending proposals are not processed
on startup; deployment does not automatically review or approve them.

Owner decision (2026-10-23): an unstated receipt rate (metadata taxRate null)
uses vendor-rules.json `defaultTaxRate: 10`, or 10 when omitted. Explicit receipt
rates 0/8/10 take precedence. Missing/invalid metadata still prevents automatic
approval. This is an accounting input default, not a determination of tax status.
