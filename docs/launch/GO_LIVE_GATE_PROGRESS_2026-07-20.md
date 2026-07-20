# MED+250 go-live gate progress — 2026-07-20

This note tracks progress toward confirming the 11 remaining production launch gates in `data/launch-evidence.json`. It is not an approval artifact. A gate is production-ready only when `npm run launch:evidence:verify:live` passes and the gate has all required evidence plus a named accountable owner approval.

## Current machine status

- `npm run launch:go-live:status` now reports the consolidated 11-gate readiness picture and exits non-zero until the launch is truly ready.
- `npm run launch:evidence:verify` passes with 11 structurally valid gates.
- `npm run launch:evidence:verify:live` fails closed because all 11 gates are still `pending`.
- `npm run domain:dns:verify` passes for `med250.gikundiro.com`.
- `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision 37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c` passed all 10 required live routes on 2026-07-20.
- `npm run data:duplicates:verify -- --strict` fails because all 51 duplicate-register groups are still pending named review.
- `npm run uat:verify:live` fails because all 12 physical-device scenarios and required executor/approver metadata are still pending.

## Local progress completed

1. Refreshed the production-domain evidence from the current live revision:
   - `docs/launch/evidence/domain-verification-2026-07-20.json`
   - `docs/launch/evidence/domain-deployment-test-2026-07-20.json`
2. Updated `data/launch-evidence.json` so `MED250_GATE_DOMAIN_DNS_VERIFIED` points to the July 20 evidence and matching SHA-256 digests.
3. Updated the production evidence runbook and owner completion kit to use 11 gates, the current live revision, and the refreshed domain artifacts.
4. Renamed the duplicate-register launch owner from “regulatory data reviewer” to “register data reviewer” so this gate is clearly a source-register quality review, not a regulatory approval.
5. Regenerated a deterministic owner handoff at `desktop-output/goal-progress-2026-07-20/launch-evidence-handoff-2026-07-20.json`.
6. Added `scripts/report-go-live-readiness.mjs` plus `npm run launch:go-live:status` and `npm run launch:go-live:status:json` to classify each gate as confirmed, approval-pending, or prepared-evidence-pending.
7. Added `scripts/create-physical-uat-packet.mjs` plus `npm run uat:packet`; generated `desktop-output/goal-progress-2026-07-20/physical-device-uat-packet-2026-07-20.json` for the 12-scenario physical-device run.
8. Added `scripts/record-launch-evidence.mjs` plus `npm run launch:evidence:record` so completed artifacts can be validated, hashed, recorded and optionally confirmed without hand-editing the registry.
9. Added `scripts/create-launch-approval-packet.mjs` plus `npm run launch:approval:packet`; generated `desktop-output/goal-progress-2026-07-20/launch-approval-packet-2026-07-20.json` for the three evidence-complete approval-pending gates.
10. Added `scripts/create-operations-readiness-packet.mjs` plus `npm run ops:readiness:packet`; generated `desktop-output/goal-progress-2026-07-20/operations-readiness-packet-2026-07-20.json` for the 769-row GPS and WhatsApp operations review.

## Gate status by accountable owner

| Gate | Current state | Remaining requirement |
| --- | --- | --- |
| `MED250_GATE_GPS_READY` | Operations snapshot exists; review ledger missing from registry; 769-row operations packet generated. | Complete the prepared GPS readiness review ledger and obtain operations approval. |
| `MED250_GATE_WHATSAPP_READY` | Operations snapshot exists; review ledger missing from registry; 769-row operations packet generated. | Complete the prepared WhatsApp readiness review ledger and obtain operations approval. |
| `MED250_GATE_DUPLICATE_REGISTER_REVIEWED` | Prepared review-ledger artifact exists; strict verifier fails with 51 pending rows. | A named register data reviewer must decide all 51 groups in `data/imports/duplicate-register-review.csv`, rerun strict verification, complete the ledger, and approve the gate. |
| `MED250_GATE_SECURITY_HARDENING_DEPLOYED` | Required deployment and test artifacts are present. | Backend owner must review the machine evidence and add real approval metadata. |
| `MED250_GATE_EDGE_FUNCTIONS_DEPLOYED` | Required deployment and test artifacts are present. | Backend owner must review the Edge Function evidence and add real approval metadata. |
| `MED250_GATE_TURNSTILE_SERVER_VERIFIED` | Negative-path checks are documented; positive-path test artifact remains pending. | Security owner must run the real production widget positive-path test with a disposable anonymous identity and complete the test record. |
| `MED250_GATE_AUTH_RATE_LIMITS_APPROVED` | Prepared test and approval artifacts exist; both remain pending. | Security owner must run the controlled rate-limit test, approve project-wide impact, and sign the gate. |
| `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED` | Controlled cleanup test artifact exists; signed approval missing. | Privacy owner must approve the retention policy and complete the signed approval artifact. |
| `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED` | Prepared account-verification and approval artifacts exist; both remain pending. | Infrastructure owner must verify intended account/route ownership, least-privilege deployment credentials, protected environment setup, and sign the gate. |
| `MED250_GATE_DOMAIN_DNS_VERIFIED` | Required domain and test artifacts are present and refreshed on 2026-07-20. | Infrastructure owner must review current Cloudflare account/route context and sign the gate. |
| `MED250_GATE_PHYSICAL_UAT_PASSED` | Prepared test and approval artifacts exist; strict UAT ledger has 12 pending scenarios; a July 20 execution packet is generated. | QA owner must execute all physical-device scenarios with opaque approved test identities, complete the test record, and sign the gate. |

## Next safe execution order

1. Complete duplicate-register decisions first; this is fully repo-driven once a named reviewer is available.
2. Complete GPS and WhatsApp record-level ledgers from the controlled private operations source.
3. Run Turnstile and auth-rate-limit controlled security tests in a short approved window.
4. Complete Cloudflare account verification and infrastructure owner approval.
5. Obtain backend and privacy approvals for evidence that is already machine-complete.
6. Execute physical-device UAT last against the current live revision after the upstream evidence is stable.
7. Set each corresponding `MED250_GATE_*` CI variable to `confirmed` only after the registry gate is confirmed with valid evidence.
