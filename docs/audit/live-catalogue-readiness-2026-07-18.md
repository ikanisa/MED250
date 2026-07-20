# MED+250 live catalogue readiness

Captured: 2026-07-18 16:35 CAT (Africa/Kigali)
Production catalogue: `https://uskfnszcdqpcfrhjxitl.supabase.co`  
Governed source: `data/product-sitemap-index.json`  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`
Verified release revision: `5ef50a296941056bd17e614dff7b35290742f50a`

## Outcome

The live catalogue no longer has an API-level 24-product ceiling. A source-bound verifier fetched all 39 live pages in deterministic A–Z order, reached products 25 and 120 plus the final row, and found no duplicate, missing, or unexpected governed product IDs. All four advertised departments return non-zero live populations.

The production run passes at exactly 4,657 source-matched products. The two governed non-product exclusions are absent from the public population, and all six required search cases—including the French and Kinyarwanda common-use queries—return relevant results. The passing catalogue receipt and the passing 10-route deployment receipt are bound to the immutable production release revision shown above.

## Evidence

The durable [live catalogue receipt](live-baseline-2026-07-18/15-live-catalogue-verification-5ef50a.json) binds the run to the complete governed source index, every response-page digest, sampled search results, and the verifier source digest. It records no credentials and retains no complete response bodies.

| Check | Result |
| --- | --- |
| Full pagination | 39/39 pages captured; 4,657 unique IDs; zero duplicates |
| Product 25 | `AMZ-B0CNG8CRRD` reached |
| Product 120 | `rwanda-fda-hm-0247` reached |
| Final product | `rwanda-fda-hm-1580` reached |
| Governed source reconciliation | Passed: 4,657 live vs 4,657 governed; no missing or unexpected IDs |
| Unexpected live IDs | None |
| Medicines | 2,459 |
| Beauty & Personal Care | 990 |
| Baby | 421 |
| Health & Household | 787 |
| `paracetamol` | 135 relevant results |
| `zinc` | 58 relevant results |
| `omeprazole` | 46 relevant results |
| `brinzolamde` typo | 3 relevant Brinzolamide results |
| French common-use query | 135 relevant results |
| Kinyarwanda common-use query | 135 relevant results |

## Implemented remediation

- `scripts/verify-live-catalogue.mjs` checks every page, stable totals, uniqueness, exact source membership, department population, product 25/product 120/final-row reach, and the required search set. It can atomically retain a body-free receipt.
- `supabase/migrations/20260718121000_restore_multilingual_marketplace_search.sql` restores approved French and Kinyarwanda query normalization at the public marketplace RPC while preserving source-ranked filtering and both public search contracts.
- The protected production workflow now blocks before deployment unless the production catalogue matches the governed source and every required query passes. Its post-deployment check requires the exact Git SHA in the live release header.

## Browser evidence and remaining closure

The shared browser ledger now passes all 16 desktop and mobile scenarios with 56 immutable captures, including the department, catalogue-boundary, controlled failure/retry/recovery, search, navigation-restoration, request-journey, related-product, and representative product-content checks. The controlled run is complete, but the ledger remains pending overall because no independent human approval has been recorded.

1. Obtain the named QA approval and record the real approver role and timestamp; machine verification and captured screenshots do not substitute for independent acceptance.
2. Keep the completed session, exact release, receipt hashes, and immutable capture digests unchanged through that review.
