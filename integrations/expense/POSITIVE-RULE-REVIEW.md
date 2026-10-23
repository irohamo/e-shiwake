# Positive rule branch: owner review required

This implementation has NOT been deployed. `compose.expense-policy.yaml` is an
explicit, separate opt-in override and has not been applied. No merge was made.

The server reads its own read-only vendor rules file. Agent-provided `auto` flags
cannot enable approval. Missing/unreadable config leaves hold-v1 active.
Rules need version 1, auto:true, debit, sender and subjectIncludes; skip/review
rules cannot approve. Google Cloud and povo have sender/subject conditions from
the owner's instructions. Dev SaaS without verified sender/subject conditions
stays in review until the owner supplies those conditions.

Approval requires original MIME hash integrity, no duplicate content, an open
year, pending status, businessRatio 100, no questions, exact vendor rule match,
matching original Message-ID/From/Subject, matching source/evidence metadata,
two balanced integer lines, rule debit, 3003 credit and consistent tax category.
It posts through the normal workflow and adds proposal.auto-approve audit with
policy version, rule, evidence ID/hash, proposal version and posted journal ID.
Audit failure rolls the approval back. The actor is backend-policy.

Limitations to review before deployment: MIME From is not cryptographic sender
authentication; this assumes the authenticated collector supplies trustworthy
originals and correctly extracted date, tax and amount. The policy checks entry
structure and metadata binding but does not independently extract receipt
amount/date or verify DKIM. Do not deploy it as protection against a compromised
collector. Currency is JPY; missing raw MIME, uncertain items, unknown vendors,
and partial business use require owner review.

No auto policy code exists in the currently running container image. The
production E2E therefore intentionally creates a pending proposal.
