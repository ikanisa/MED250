# MED+250 Owner Execution Packet

- Classification: execution aid only; not evidence, approval, or production authorization
- Prepared: 24 July 2026
- Audited application-code revision: `c38ef94a78ad7402e8732bd56e660c4c64b23240`
- Production origin: `https://med-250.com`
- Public catalogue: Sites version 15 in `catalog` mode

## Current release posture

Production is correctly **NO-GO**. The application candidate, production build,
catalogue build, dependency audits, performance budget, and automated
regression suites pass. The direct production Worker still exposes revision
`468a3003e3b27c0f42a4ee089c8dae38028c1740`, not the candidate.

The remaining work requires accountable owners and an approved isolated
Supabase staging target. Read-only management access to the configured shared
project is now available; it does not authorize production mutation. GitHub
billing is not part of this release path.

| Workstream | Accountable owner | Exact remaining input | Ready execution artifact |
|---|---|---|---|
| Source authority | Named MED+250 data owner | Restore original private bundle or sign a bounded replacement decision | `data/source-authority-decision.json` and `SOURCE_RETENTION_AUTHORITY_DECISION_2026-07-24.md` |
| Duplicate register | Named register data reviewer | 51 authoritative decisions | `duplicate-register-review-packet-2026-07-24.json` |
| Product content | Named regulatory or clinical data reviewer | 72 authoritative decisions | `data/imports/product-content-review-pending-2026-07-18.json` |
| Operations | Named MED+250 operations owner | Controlled GPS and WhatsApp review results | `operations-readiness-packet-2026-07-24.json` |
| Backend | Named MED+250 backend owner | Approve an isolated staging target, staging execution and later production promotion | `supabase-deployment-gap-2026-07-24.json` and candidate hashes below |
| Security | Named MED+250 security owner | Production Turnstile and rate-limit controlled tests and approval | `launch-evidence-handoff-2026-07-24.json` |
| Privacy | Named MED+250 privacy owner | Signed prescription-retention decision | `launch-evidence-handoff-2026-07-24.json` |
| Infrastructure | Named infrastructure owner | Least-privilege Cloudflare review and later exact-revision approval | `go-live-closure-board-2026-07-24.json` |
| Rendered production audit | Named QA executor and QA owner | Rerun 16 desktop/mobile scenarios on `med-250.com` for the exact candidate revision and approve the privacy-safe evidence | `data/audit-browser-evidence.json` |
| QA | Named QA executor and QA owner | 12 physical-device executions and approval | `physical-device-uat-packet-2026-07-24.json` |

## 1. Source authority

Open `SOURCE_RETENTION_AUTHORITY_DECISION_2026-07-24.md`. The data owner must
select restore, bounded replacement, or rejection. A reconstructed baseline
must never be relabelled as the lost original.

The machine-verifiable pending record is:

`data/source-authority-decision.json`

Check its exact committed source bindings:

```sh
npm run data:source-authority:verify
```

If the original bundle is restored, record the named owner's decision while
supplying the private bundle path only through the process:

```sh
MED250_SOURCE_RETENTION_BUNDLE=/private/restored-bundle \
npm run data:source-authority:record -- \
  --decision restore_original \
  --decided-by "Named MED+250 data owner" \
  --role "Catalogue provenance and retention owner" \
  --decided-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --rationale "Substantive exact-bundle restoration decision" \
  --evidence-reference "Controlled source authority record reference" \
  --storage-label "Approved durable evidence store label" \
  --storage-verification-reference "Controlled custody receipt reference" \
  --confirm
```

Acceptance: every manifest entry and aggregate digest verifies, durable storage
is named and approved, and no private bytes are committed to Git.

For a bounded replacement, use `--decision approve_replacement` with all the
same owner/storage fields plus substantive `--permitted-uses`,
`--prohibited-uses`, `--retention-and-review`, `--correction-process`, and
`--future-provenance-rules` fields. The recorder verifies SHA-256
`5cad7067c8d904454f66f7e8a2d7bc276d72ac645bc2acdb30fc8a52642a6395`
and preserves `is_original: false`.

After either approved path:

```sh
npm run data:source-authority:verify:strict
```

If and only if the owner approved the bounded replacement, rebind the still
fully pending 72-entry review packet to the exact replacement SHA-256 before
recording product decisions:

```sh
npm run data:content-review:generate -- \
  --dataset outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json \
  --output data/imports/product-content-review-pending-2026-07-18.json \
  --force
```

This intentionally changes the packet's source identity to the approved new
baseline. It must never retain the missing original path or digest after that
replacement decision.

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
  --dataset "<approved-source-dataset-path>" \
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

Read-only management inspection now reaches the configured shared production
project and confirms that the MED+250 schema is present. It also confirms:

- the remote migration history stops at MED+250 migration
  `20260718134000`; candidate `20260723120000` is not deployed;
- deployed `dawanear-pharmacy-verify-otp` version 12 still uses the
  pre-hardening identity and membership path;
- its deployed shared origin list still contains the retired hostname; and
- no isolated staging project or development branch has been verified.

The privacy-safe snapshot is
`supabase-deployment-gap-2026-07-24.json`. Management visibility is not
deployment approval. The backend owner must:

1. approve or provide an isolated MED+250 staging project or development branch;
2. authorize the exact migration and Edge Function bundle for staging only;
3. approve the staging negative-test and rollback results; and
4. explicitly authorize promotion of the same immutable artifacts to the
   shared production project only after every other prerequisite is complete.

Exact candidate artifacts:

- Migration: `supabase/migrations/20260723120000_marketplace_go_live_hardening.sql`;
  SHA-256 `b5b0b8abf07c921ab36f08553e4cef73dd6cf84a0ff111236cc9a3190ed42e15`.
- Edge Function: `supabase/functions/dawanear-pharmacy-verify-otp/index.ts`;
  SHA-256 `9047fb567051efc8f2ec43ae8c27751e33a3f13b10463723641585ae1737e9a9`.
- Shared authentication boundary:
  `supabase/functions/_shared/dawanear-pharmacy-auth.ts`; SHA-256
  `c5e689207b035706f8cb63cbc5af690f489995b3afc8afaef4a1c2cdd37143be`.
- Exact two-file function bundle SHA-256:
  `c6674d06e29eac14def4aa9a2088a5dc20802a416c83c29bd7d410d5c3c7861f`.
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

## 5. Rendered production audit — 16 scenarios

The retained 16-scenario, 56-capture browser run is historical evidence from
`med250.gikundiro.com` at revision
`5ef50a296941056bd17e614dff7b35290742f50a`. It must not be relabelled or
approved as evidence for `med-250.com`.

After the exact candidate revision is deployed, rerun every governed desktop
and mobile scenario on `https://med-250.com`, capture new privacy-safe
screenshots, bind fresh deployment and catalogue receipts, and obtain named QA
approval. Then run:

```sh
npm run audit:browser-evidence:verify
npm run audit:browser-evidence:verify:live
```

Acceptance: the strict verifier reports 16/16 scenarios and 56/56 captures
passed, the evidence origin is `https://med-250.com`, the evidence and live
deployment revisions equal the exact candidate Git SHA, and named QA approval
is present.

## 6. Physical-device UAT — 12 scenarios

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

## 7. Eleven launch gates

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

## 8. Exact-revision production verification

Only after all prior sections pass, deploy the approved immutable application
revision through the local free-only release path. GitHub must remain a free
source host only: do not enable a billed plan, paid Actions capacity, paid
deployment service, or billing-recovery workflow for this release. Then:

This is a permanent owner constraint, not a temporary cost preference. Do not
upgrade the GitHub account for MED+250. If included free Actions minutes are
unavailable, exhausted, or uncertain, leave the optional manual workflows
disabled and use the local release commands. Verify the repository guard with
`npm run github:free-only:verify`.

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
