# MED+250 public trust-metrics readiness report

Report date: 2026-07-18  
Status: **privacy-safe local implementation complete; operations approval and live production evidence pending**

## Outcome

The storefront can now publish two narrowly defined service signals without inventing availability, ratings, stock, or pharmacy rankings:

1. the current count of pharmacies that pass the central dispatch-eligibility function; and
2. the median time to the first complete availability confirmation for qualifying requests.

Both values fail closed. Migration `20260718083000_public_trust_metrics.sql` creates no approval rows, and the homepage renders no trust-signal section when the RPC returns null values or cannot be reached.

## Governance and suppression contract

| Signal | Source | Population/window | Publication threshold | Freshness | Additional gate |
| --- | --- | --- | --- | --- | --- |
| Ready pharmacies | `dawanear_private.dawanear_pharmacy_is_dispatch_eligible(uuid)` | Entire current eligible population; no sample window | At least one eligible pharmacy | Current snapshot timestamp returned | Unexpired operations approval for `ready_pharmacy_count` |
| Typical first confirmation | First complete `submitted` or `selected` confirmation for a dispatched request with at least one recipient | Rolling 90 days | At least 30 qualifying requests across at least three Rwanda calendar days | Latest qualifying confirmation no older than 14 days | Unexpired operations approval for `typical_response_time` |

The response value is the discrete p50 (median), rounded to whole minutes with a one-minute floor. Confirmations before broadcast or more than 24 hours after broadcast are excluded. The public output includes its source, percentile, published sample size, rolling window, latest observation timestamp, and maximum staleness. Suppressed sample counts are not returned.

## Approval boundary

Approvals live in `public.dawanear_public_metric_approvals`, which has row-level security enabled and no `anon` or `authenticated` table access. Only `service_role` can manage it. An approved row requires:

- the exact metric key;
- reviewer identity;
- an evidence reference;
- approval timestamp; and
- a future expiry timestamp.

The public fixed-shape RPC can be called by anonymous and authenticated storefront sessions, but returns aggregate JSON only. It never returns the approval record, pharmacy/customer identifiers, locations, contact data, prescription/health data, or a suppressed sample count.

Approval must follow a production-data review and may not be inserted merely to demonstrate the interface. Withdrawal or expiry immediately suppresses the corresponding value on the next uncached homepage request.

## Storefront behavior

`lib/public-trust-metrics.ts` validates the RPC schema and privacy flags at the public Supabase boundary. Any request failure, unexpected hostname, malformed timestamp, incomplete evidence fields, mismatched population count, unsupported source, or privacy-flag failure becomes `null`.

`app/marketplace.tsx` renders only non-null metrics. The ready count is described as readiness to **receive requests**, not product availability. The response measure is labeled as a typical first confirmation, with the median sample, window, and latest date visible. If both metrics are suppressed, no empty container, placeholder number, or fallback claim is shown.

## Automated evidence

`tests/public-trust-metrics.test.mjs` covers:

- no approval;
- zero eligible pharmacies;
- nearby and national-fallback responders through the same eligibility boundary;
- 29-request small sample;
- a 30-request single-day burst;
- a 30-request stale sample;
- an approved, fresh 30-request p50;
- approval-table/RPC privileges;
- release-contract allowlisting for exactly one aggregate anonymous definer and one service-only table;
- absence of identifiers from serialized public output;
- strict storefront parsing and optional rendering copy.

Validation completed locally:

- `node --test tests/public-trust-metrics.test.mjs` — 12/12 passed;
- `npm run lint` — passed;
- `npm run build:production` — passed; and
- targeted production/database/rendered checks — 55/55 passed; and
- `npm test` — 222/222 passed in the serialized full suite; and
- `python3 -m unittest tests/test_enrich_product_images.py` — 125/125 passed after the deployment-contract version was advanced.

## Remaining closure

1. Apply the migration to the intended Supabase project and verify the deployed RPC through the anonymous key.
2. Observe real request traffic until the response threshold and freshness conditions pass; do not seed or backfill synthetic production observations.
3. Have pharmacy operations review the exact eligible-pharmacy population and response distribution, attach dated evidence, approve with an expiry, and approve the public wording.
4. Capture desktop/mobile browser evidence for the approved state and for withdrawal/expiry suppression.
5. Implement feedback collection only after consent, abuse controls, moderation, dispute handling, privacy review, and an owner-approved operating procedure exist.
6. Keep pharmacy reliability ratings/rankings deferred until their separate methodology, minimum volume, appeals process, and legal/operations approvals are complete.
