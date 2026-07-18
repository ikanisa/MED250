# MED+250 product-content quality report

Report date: 2026-07-18  
Research snapshot: 2026-07-15  
Status: **requires governed review; Goal 8 is not closed**

Two traceable source rows subsequently identified as books rather than pharmacy products are now governed exclusions (`AMZ-032380909X` and `AMZ-B01K1S6AHM`). The 4,680 figure below remains the immutable source-snapshot population; the publishable catalogue contains 4,657 products after these exclusions and the existing 21 non-requestable medicine rows.

This artifact is reproducible with:

```sh
npm run data:content-quality-report -- --as-of 2026-07-18
```

## Governed owner-review packet

[`data/imports/product-content-review-pending-2026-07-18.json`](../../data/imports/product-content-review-pending-2026-07-18.json) now binds all 72 review entries to the exact research-snapshot digest: 40 duplicate medicine-title groups covering 88 rows, 24 medicines without recorded generic/ingredient text, and 8 short or pack-like title candidates. It preserves the registration, strength, form, pack, manufacturer, authorization-holder, lifecycle, and source fields needed for accountable review without supplying a clinical inference, merge recommendation, or prefilled approval.

`npm run data:content-review:verify` rejects source drift, population drift, altered evidence, unsupported decisions, incomplete accountability metadata, and summary mismatches. The strict form used by the live release gate also rejects pending reviews and unresolved source corrections. Regeneration is deliberately destructive to decisions and requires an explicit `--force` flag.

Run `npm run data:content-review:next` to display exactly one pending source-bound entry and only the decisions allowed for its finding type. After inspecting the exact Rwanda FDA record, record that one outcome with `npm run data:content-review:decide -- --key "<packet key>" --decision "<allowed decision>" --reviewer "<name>" --reviewer-role "<role>" --reviewed-at "<ISO 8601 timestamp with timezone>" --evidence-url "<authoritative Rwanda FDA HTTPS URL>" --note "<substantive rationale>"`. The decision command locks the packet, revalidates the complete source binding before the edit, writes through an atomic replacement, and refuses to overwrite a completed decision unless `--replace` is supplied after the exact evidence is rechecked.

## Title quality

| Measure | Evidence |
| --- | ---: |
| Catalogue products assessed | 4,680 |
| Blank official titles | 0 |
| Short or pack-like titles requiring review | 8 |
| Customer display titles transformed | 3,647 |
| Customer display titles over 120 characters | 0 |
| Official source titles over 180 characters | 458 |
| Duplicate normalized title groups | 40 |
| Rows in duplicate title groups | 88 |

The customer surface now uses a bounded, sentence-cased title while retaining the exact official catalogue name separately when presentation differs. Duplicate medicine titles are not silently deleted: they can represent distinct registrations and require source review.

## Customer display-title lengths

| Length | Products |
| --- | ---: |
| 0–60 characters | 3,431 |
| 61–90 characters | 568 |
| 91–120 characters | 681 |

## Content gaps

| Gap | Rows |
| --- | ---: |
| Medicine rows without generic/ingredient text | 24 |
| Consumer rows without a separate generic field | 2,200 |
| Rows without a dedicated description field | 4,680 |
| Generic values duplicating taxonomy | 0 |
| Rows without a source-snapshot image URL | 4,680 |

Consumer product names can contain descriptive source text, but that is not treated as an approved reusable description. Source-snapshot image absence is also not evidence about the separate governed live image pipeline.

## Fail-closed description publication

`supabase/migrations/20260718133000_govern_public_product_descriptions.sql` implements the description schema without seeding or inventing any copy. A public description now requires:

- 40–2,000 characters of reviewed source text;
- an HTTPS source, source name, and SHA-256 of the exact reviewed source content;
- a substantive reuse basis plus a durable rights-decision reference and explicit verified-rights state;
- an approved or not-required clinical review state;
- a substantive review rationale, named reviewer, reviewer role, and timezone-qualified review timestamp; and
- explicit publication approval.

Drafts remain private. Removing approval removes the description from the public catalogue. Changing approved wording or evidence while retaining approval requires a newer review timestamp. The production backend contract is now `2026-07-18.3` and fails on missing controls, incomplete approved evidence, public draft leakage, approved descriptions missing from the public projection, or any approval or withdrawal that bypasses the immutable single-product review ledger.

`tests/product-descriptions-sql.test.mjs` executes the migration and proves complete publication, incomplete-evidence rejection, stale-review rejection, private drafts, and withdrawal.

## Single-product review workflow

`supabase/migrations/20260718143000_govern_product_description_reviews.sql` makes the database contract operational without adding any content. It adds a service-only, optimistic-locking function for exactly one product and an immutable evidence ledger. A deferred database constraint rejects direct approval or withdrawal writes that do not have the matching audit event in the same transaction. The aggregate backend contract is now `2026-07-18.3`; it additionally verifies the deny-by-default review table, immutable trigger, privileged function boundary, mandatory audit constraint, and zero approved descriptions without a matching current approval event.

The protected Edge reviewer and `npm run ops:product-descriptions` expose only `inspect`, `approve`, and `withdraw`. Approval requires a reviewed description file and the exact source file; the operator tool computes the source SHA-256 from those bytes instead of accepting a manually typed digest. It also requires explicit reuse-rights confirmation, a durable rights reference, a clinical-review state, named reviewer and role, a timezone-qualified review timestamp, and the exact `updated_at` copied from a fresh inspection. No batch action exists.

The owner workflow is:

```sh
npm run ops:product-descriptions -- inspect --product-id <product-id>
npm run ops:product-descriptions -- approve --product-id <product-id> --expected-updated-at <inspect timestamp> --description-file <reviewed text file> --source-file <exact source bytes> --source-name <name> --source-url <https-url> --rights-basis <basis> --rights-reference <durable reference> --rights-verified yes --clinical-review-status <approved|not_required> --reviewed-by <name> --reviewed-role <role> --reviewed-at <timestamp with timezone> --review-note <rationale>
npm run ops:product-descriptions -- withdraw --product-id <product-id> --expected-updated-at <inspect timestamp> --reviewed-by <name> --reviewed-role <role> --reviewed-at <timestamp with timezone> --review-note <reason>
```

`tests/product-description-review-workflow.test.mjs` proves atomic approval, stale-inspection rejection, mandatory workflow enforcement, immediate public withdrawal, immutable two-event history, and service-only privileges. `tests/product-description-admin.test.mjs` proves exact-byte hashing, explicit rights confirmation, bounded single-product payloads, protected transport, and the absence of batch publication.

## Deployment evidence for the protected reviewer

`npm run backend:verify:description-reviewer` now performs a non-mutating release probe. It verifies the aggregate database contract, requires an unauthenticated request to fail with HTTP 403, performs one authenticated `inspect`, checks the exact product version, and requires the deployed reviewer to advertise the same backend contract plus its own reviewer contract. The optional JSON receipt retains no response body, raw product identifier, credential, description, review note, or other draft content; it records only contract versions, status codes, the hash of the product identifier, the expected and observed `updated_at`, bounded response size, and verifier digest.

After deploying the two migrations and reviewer, copy the exact `updated_at` from a fresh inspection and run:

```sh
npm run backend:verify:description-reviewer -- --product-id PRODUCT_ID --expected-updated-at EXACT_INSPECT_UPDATED_AT --evidence-output docs/launch/evidence/product-description-reviewer-verification-YYYY-MM-DD.json
```

`tests/product-description-reviewer-deployment.test.mjs` proves the read-only payload, anonymous denial, database/reviewer contract binding, exact-product/version checks, strict Supabase-origin validation, process-only credentials, and body-free evidence shape. This verifier does not deploy the function, approve content, or close the accountable-owner gate by itself.

## Required owner decisions and evidence

1. Complete the 40 duplicate-title decisions in the source-bound owner packet without merging distinct registrations solely because their display titles match.
2. Complete the 24 missing-generic and 8 short-title decisions using authoritative evidence; do not infer ingredients from adjacent fields or similarly named products.
3. Deploy the description migration and protected reviewer, run the body-free deployment verifier against a freshly inspected product, then use the single-product workflow to approve which exact source text may be reused, record the required rights and clinical evidence, and populate the fail-closed description schema; current approved dedicated-description coverage is zero.
4. Reconcile this source report with the governed live image report rather than inferring image coverage from the research workbook.
5. Run `npm run data:content-review:verify -- --strict`, import any approved corrections into a new governed snapshot, and capture browser evidence that concise display titles and exact official names remain readable at required breakpoints.
