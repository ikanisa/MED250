# MED+250 Owner Execution Packet

- Classification: execution aid only; not evidence, approval, or production authorization
- Prepared: 24 July 2026
- Application release candidate: `c38ef94a78ad7402e8732bd56e660c4c64b23240`
- Production origin: `https://med-250.com`
- Public catalogue: Sites version 15 in `catalog` mode

## Current release posture

Production is correctly **NO-GO**. The application candidate, production build,
catalogue build, dependency audits, performance budget, and automated
regression suites pass. The direct production Worker still exposes revision
`468a3003e3b27c0f42a4ee089c8dae38028c1740`, not the candidate.

The remaining work requires accountable owners or MED+250 Supabase project
access. GitHub billing is not part of this release path.

| Workstream | Accountable owner | Exact remaining input | Ready execution artifact |
|---|---|---|---|
| Source authority | Named MED+250 data owner | Restore original private bundle or sign a bounded replacement decision | `SOURCE_RETENTION_AUTHORITY_DECISION_2026-07-24.md` |
| Duplicate register | Named register data reviewer | 51 authoritative decisions | `duplicate-register-review-packet-2026-07-24.json` |
| Product content | Named regulatory or clinical data reviewer | 72 authoritative decisions | `data/imports/product-content-review-pending-2026-07-18.json` |
| Operations | Named MED+250 operations owner | Controlled GPS and WhatsApp review results | `operations-readiness-packet-2026-07-24.json` |
| Backend | Named MED+250 backend owner | Accessible staging and production Supabase projects | Migration and Edge Function hashes below |
| Security | Named MED+250 security owner | Production Turnstile and rate-limit controlled tests and approval | `launch-evidence-handoff-2026-07-24.json` |
| Privacy | Named MED+250 privacy owner | Signed prescription-retention decision | `launch-evidence-handoff-2026-07-24.json` |
| Infrastructure | Named infrastructure owner | Least-privilege Cloudflare review and later exact-revision approval | `go-live-closure-board-2026-07-24.json` |
| QA | Named QA executor and QA owner | 12 physical-device executions and approval | `physical-device-uat-packet-2026-07-24.json` |

## 1. Source authority

Open `SOURCE_RETENTION_AUTHORITY_DECISION_2026-07-24.md`. The data owner must
select restore, bounded replacement, or rejection. A reconstructed baseline
must never be relabelled as the lost original.

If the original bundle is restored:

```sh
npm run data:source-retention:verify
```

Acceptance: every manifest entry and aggregate digest verifies, durable storage
is named and approved, and no private bytes are committed to Git.

## 2. Duplicate register — 51 decisions

Reviewer context:

`desktop-output/goal-progress-2026-07-24/duplicate-register-review-packet-2026-07-24.json`

Governed decision ledger:

`data/imports/duplicate-register-review.csv`

Allowed decisions are:

- `accepted_source_duplicate` only when authoritative evidence confirms the
  records are valid and distinct despite sharing the official identifier; or
- `blocked_source_correction` when an authoritative correction is still
  required.

Every non-pending row requires the reviewer name, timezone-qualified timestamp,
and substantive rationale. Do not delete or merge source rows merely to pass.

```sh
npm run data:duplicates:verify -- --strict
npm run data:duplicates:evidence:build -- \
  --date YYYY-MM-DD \
  --reviewed-by "Named register data reviewer" \
  --reviewer-role "Register data reviewer" \
  --reviewed-at "YYYY-MM-DDTHH:mm:ss+02:00"
```

Acceptance: 51 reviewed, zero pending, zero blocked corrections.

## 3. Product content — 72 decisions

The next decision-neutral source comparison is available with:

```sh
npm run data:content-review:next
```

Record one accountable decision at a time:

```sh
npm run data:content-review:decide -- \
  --key "<exact-key-from-next>" \
  --decision "<allowed-decision>" \
  --reviewer "Named regulatory or clinical reviewer" \
  --reviewer-role "Regulatory or clinical data reviewer" \
  --reviewed-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --evidence-url "https://authoritative-source.example/exact-record" \
  --note "Substantive source-bound rationale"
```

The current population is 40 duplicate-title groups, 24 missing medicine
generics, and eight short or pack-like titles. A correction-required decision
remains blocking until the authoritative source is corrected, reimported, and
the packet is regenerated.

```sh
npm run data:content-review:verify -- --strict
```

Acceptance: 72 reviewed, zero pending, zero correction-required.

## 4. Supabase hardening deployment

The currently authenticated Supabase account does not contain the MED+250
project. It lists only IKANISA, FANZONE, and FANAFRIKA. The backend owner must:

1. grant this operator access to an isolated MED+250 staging project;
2. provide the staging project reference through the authenticated Supabase
   CLI session, not in this repository;
3. approve staging execution; and
4. only later grant access to the MED+250 production project
   `uskfnszcdqpcfrhjxitl`.

Exact candidate artifacts:

- Migration: `supabase/migrations/20260723120000_marketplace_go_live_hardening.sql`;
  SHA-256 `b5b0b8abf07c921ab36f08553e4cef73dd6cf84a0ff111236cc9a3190ed42e15`.
- Edge Function: `supabase/functions/dawanear-pharmacy-verify-otp/index.ts`;
  SHA-256 `9047fb567051efc8f2ec43ae8c27751e33a3f13b10463723641585ae1737e9a9`.
- Backend invariant verifier: `scripts/backend-contract-invariants.mjs`;
  SHA-256 `6e9de5ee9be424975d6f73b10d0b765e7dfa4421c9eac1f67f6b8774386f19bd`.

Staging sequence:

```sh
supabase link --project-ref <MED250_STAGING_PROJECT_REF>
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy dawanear-pharmacy-verify-otp \
  --project-ref <MED250_STAGING_PROJECT_REF>
npm run backend:verify
npm run ops:health:strict
```

The backend owner must then retain redacted receipts and execute negative
tests for:

- duplicate phone-to-pharmacy binding;
- cross-tenant membership;
- revoked and suspended authority;
- concurrent identity binding and revocation locks;
- customer and pharmacy offer-item ownership;
- public description-table privileges;
- governed description projection;
- the `rwanda-fda-hm-1594` media hold; and
- rollback to the pre-migration staging snapshot.

Do not promote to production until the staging receipts are approved and every
other production gate is ready.

## 5. Physical-device UAT — 12 scenarios

Execution packet:

`desktop-output/goal-progress-2026-07-24/physical-device-uat-packet-2026-07-24.json`

Governed ledger:

`data/physical-device-uat.json`

The named QA executor must use physical representative devices and real
assistive technology. Evidence must be redacted and must not include phone
numbers, OTPs, order identifiers, prescription contents, exact coordinates, or
credentials.

```sh
npm run uat:verify:live
npm run uat:evidence:build -- --date YYYY-MM-DD
```

Acceptance: 12 passed, zero pending, failed, blocked, or invalid; named QA-owner
approval recorded with timezone-qualified timestamps.

## 6. Eleven launch gates

Current-revision workbooks:

- `launch-evidence-handoff-2026-07-24.json`: 15 missing evidence artifacts,
  all 15 represented by prepared pending templates;
- `launch-approval-packet-2026-07-24.json`: zero evidence-complete gates ready
  for approval; the domain approval is blocked by stale live-revision evidence;
  and
- `go-live-closure-board-2026-07-24.json`: all 11 gates, seven owner
  workstreams, zero confirmed gates, ten gates with complete pending workbooks,
  one stale-release gate, and exact guarded commands.

The two backend gates must not be approved from the older 18 July receipts
after this candidate introduced the 23 July migration and revised OTP
function. Those historical receipts have been removed from the current gate
manifest. Complete the four new 24 July pending deployment/test workbooks,
replace them with validated staging and production evidence, and only then
request backend-owner approval.

```sh
npm run launch:evidence:verify
npm run launch:go-live:status
```

Final acceptance:

```sh
npm run launch:evidence:verify:live
npm run release:check:live
```

These commands must report 11 confirmed gates and `productionReady: true`.

## 7. Exact-revision production verification

Only after all prior sections pass, deploy the approved immutable application
revision through the local free-only release path. GitHub must remain a free
source host only: do not enable a billed plan, paid Actions capacity, paid
deployment service, or billing-recovery workflow for this release. Then:

```sh
npm run deployment:verify -- \
  --url https://med-250.com \
  --mode live \
  --expected-revision c38ef94a78ad7402e8732bd56e660c4c64b23240 \
  --evidence-output desktop-output/goal-progress-2026-07-24/domain-deployment-receipt.json
```

Refresh domain evidence and record named infrastructure approval only if every
route reports the exact revision.

## Safety boundary

This packet does not authorize a production deployment or any human,
regulatory, clinical, privacy, security, infrastructure, or QA approval.
Never fabricate names, roles, timestamps, device results, source decisions, or
deployment receipts.
