# MED+250 live catalogue readiness

Captured: 2026-07-18 11:58 CAT (Africa/Kigali)  
Production catalogue: `https://uskfnszcdqpcfrhjxitl.supabase.co`  
Governed source: `data/product-sitemap-index.json`  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`

## Outcome

The live catalogue no longer has an API-level 24-product ceiling. A source-bound verifier fetched all 39 live pages in deterministic A–Z order, reached products 25 and 120 plus the final row, and found no duplicate or missing governed product IDs. All four advertised departments return non-zero live populations.

The run is intentionally failed, not accepted. Production still returns 4,659 rows instead of the governed 4,657: the two previously identified non-product records remain live. Exact ingredient search and typo recovery pass, but the required French and Kinyarwanda common-use queries return no results. These are deployment gaps, not documentation gaps.

## Evidence

The durable [live catalogue receipt](live-baseline-2026-07-18/11-live-catalogue-verification.json) binds the run to the complete governed source index, every response-page digest, sampled search results, and the verifier source digest. It records no credentials and retains no complete response bodies.

| Check | Result |
| --- | --- |
| Full pagination | 39/39 pages captured; 4,659 unique IDs; zero duplicates |
| Product 25 | `AMZ-B0CNG8CRRD` reached |
| Product 120 | `rwanda-fda-hm-0247` reached |
| Final product | `rwanda-fda-hm-1580` reached |
| Governed source reconciliation | Failed: 4,659 live vs 4,657 governed; no governed IDs missing |
| Unexpected live IDs | `AMZ-032380909X`, `AMZ-B01K1S6AHM` |
| Medicines | 2,459 |
| Beauty & Personal Care | 990 |
| Baby | 423 |
| Health & Household | 787 |
| `paracetamol` | 135 relevant results |
| `zinc` | 58 relevant results |
| `omeprazole` | 46 relevant results |
| `brinzolamde` typo | 3 relevant Brinzolamide results |
| French common-use query | Failed: 0 results |
| Kinyarwanda common-use query | Failed: 0 results |

## Implemented remediation

- `scripts/verify-live-catalogue.mjs` checks every page, stable totals, uniqueness, exact source membership, department population, product 25/product 120/final-row reach, and the required search set. It can atomically retain a body-free receipt.
- `supabase/migrations/20260718121000_restore_multilingual_marketplace_search.sql` restores approved French and Kinyarwanda query normalization at the public marketplace RPC while preserving source-ranked filtering and both public search contracts.
- The protected production workflow now blocks before deployment unless the production catalogue matches the governed source and every required query passes. Its post-deployment check requires the exact Git SHA in the live release header.

## Remaining closure

1. Apply the existing non-product retirement migration and the multilingual search migration through the governed Supabase process.
2. Rerun `npm run catalogue:verify:live` and retain a passing receipt with exactly 4,657 source-matched IDs and all six search cases passing.
3. Bind the passing catalogue receipt and desktop/mobile browser evidence to the exact protected deployment Git SHA.
