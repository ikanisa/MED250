# MED+250 production-readiness handoff

Date: 2026-07-16
Public origin: https://med250.gikundiro.com
Decision: conditional hold pending accountable evidence

## Current outcome

The complete machine-executable implementation and verification scope is passing. The public MED+250 catalogue is live, the current seven-route deployment verifies successfully, the Supabase contract is at `2026-07-16.10`, all six reviewed Edge Functions are deployed and protected, prescription cleanup is scheduled, the central catalogue model is enforced, and product imagery now fails closed unless exact reuse rights are explicitly verified by the constraint, RLS, service RPC, publisher preflight, independent runtime trigger, and protected DDL boundary.

The strict production release cannot yet be honestly marked complete. Its remaining work consists of accountable human approvals, authoritative data decisions, credential rotation evidence, controlled security tests, and physical-device UAT. These are release evidence requirements, not unresolved application defects.

## Verified product model

- 4,680 source products: 2,480 Rwanda FDA medicine records plus 2,200 approved Amazon-first consumer products.
- 4,659 active/orderable records: 2,459 current medicines plus 2,200 approved consumer products.
- 2,405 consumer candidates were reviewed; 205 were rejected.
- All 25 requested Amazon category/subcategory pairs are covered.
- Central indicative prices exist for 128 products and display as “From RWF …” when available.
- Amazon-derived prices: zero.
- Pharmacy-specific catalogue prices: zero.
- Public stock records: unsupported.
- Pharmacies are the only fulfilment sellers. Product records, taxonomy, and indicative pricing remain central.
- Missing values remain blank. Empty medicine subcategories and other empty labels are dynamically hidden.
- Product imagery is verified-only and optional; missing imagery does not produce a fabricated product image or placeholder claim.
- The public product-image Storage bucket is empty; 51 retained unverified database rows are unapproved and hidden.

## Automated verification

| Check | Result |
| --- | --- |
| Integrated `npm run release:check` | Passed |
| Automated Node tests | 164 passed, 0 failed |
| Complete Node and pinned Python dependency audits | Zero known vulnerabilities; 10 Python pins checked against OSV |
| Lint | Passed |
| Catalogue import validation | Passed |
| Catalogue quality | Passed |
| Python pharmacy, source-enrichment, and image-pipeline tests | 43 passed, 0 failed |
| Performance budgets | Passed |
| Wrangler strict dry-run | Passed |
| Production Cloudflare build/dry-run | Passed |
| Live seven-route deployment verification | Passed |
| Production DNS agreement | Passed |
| Git whitespace check | Passed |

Current transfer measurements are 204,821 bytes of JavaScript, 26,637 bytes of CSS, and 99,302 bytes for marketplace JavaScript. All are within the enforced budgets.

## Live operating snapshot

- 769 active pharmacies.
- 93 pharmacies with governed GPS readiness.
- 300 pharmacies with WhatsApp coverage.
- 338 enabled governed WhatsApp login contacts.
- 340 pharmacies with governed phone coverage after removing 25 quarantined browser-observation candidates.
- 300 dispatch-ready pharmacies.
- Zero recent WhatsApp verification delivery failures in the captured 24-hour window.
- Zero strict operational-health findings in the captured production snapshot.

The operations counts do not replace review-ledger approval. Coordinates and contacts must remain source-backed and explicitly reviewed.

The refreshed Supabase audit reports database SSL enforcement active, all six reviewed MED+250 Edge Functions active at their expected versions, zero MED+250 performance warnings, and no unexpected backend-contract access. Turnstile rejects missing and invalid tokens without changing the aggregate Auth-user count. The valid-widget test and approval of the project-wide anonymous-user limit remain controlled security-owner tasks.

The prepared data-reuse ledger now inventories nine active source classes and binds them to 32 SHA-256 digests. It verifies that Amazon is used only for taxonomy and product-reference research, Amazon prices are absent, and the 128 populated central indicative prices come only from directly observed Rwanda catalogue references. The ledger remains pending because the data owner must resolve three provenance gaps and make the licence, publication, retention, refresh and withdrawal decisions.

## Strict release gaps

`npm run launch:evidence:verify:live` correctly reports 15 pending gates. Some already have complete technical evidence but still require accountable approval.

| Area | Exact remaining work | Owner |
| --- | --- | --- |
| GPS and WhatsApp | Complete authoritative review ledgers and approve the intended production pharmacy set | Operations |
| Pharmacy procedures | Sign dispatch, escalation, expiry, cancellation, prescription, and incident procedures | Operations lead |
| Regulatory model | Approve the Rwanda marketplace model and applicable conditions | Legal/compliance |
| Source reuse | Complete `docs/launch/evidence/data-reuse-review-ledger-pending-2026-07-16.json`, resolve three snapshot/retention gaps, and approve reuse/publication of all nine active source classes | Data owner |
| Duplicate registers | Decide all 51 groups in the synchronized review ledger | Regulatory data reviewer |
| Credentials | Rotate exposed Supabase/database/personal credentials and retain redacted receipts | Security owner |
| Backend/Edge evidence | Name and timestamp the backend approval; technical evidence is already complete | Backend owner |
| Turnstile | Complete one real-token, non-ordering, disposable-anonymous-user positive-path browser test | Security owner |
| Anonymous auth | Approve limits after controlled intended-use and abuse tests | Security owner |
| Prescription retention | Sign the implemented 24-hour/30-day policy; cleanup test evidence is complete | Privacy owner |
| Cloudflare | Replace broad OAuth with a least-privilege MED+250 deploy credential and approve the account record | Infrastructure owner |
| Domain | Name and timestamp infrastructure approval; DNS and deployment evidence is complete | Infrastructure owner |
| Physical UAT | Execute and approve all 12 scenarios with controlled identities and redacted evidence | QA owner |

The duplicate review packet is generated by `npm run data:duplicates:packet`. It contains all 51 synchronized groups and deliberately contains no automatic decision or recommendation.

## Required closure sequence

After the owners provide real evidence and approvals:

1. `npm run launch:evidence:verify:live`
2. `npm run data:duplicates:verify -- --strict`
3. `npm run uat:verify:live`
4. `npm run backend:verify`
5. `npm run ops:health:strict`
6. `npm run release:check:live`
7. `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live`

Do not convert pending gates to confirmed without matching evidence, named approvers, roles, timezone-qualified timestamps, and valid artifact hashes.
