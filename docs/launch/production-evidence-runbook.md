# MED+250 production evidence runbook

This runbook closes the 11 fail-closed production gates without weakening them or treating configuration flags as evidence. The authoritative registry is `data/launch-evidence.json`; `npm run launch:evidence:verify:live` is the final machine gate.

## Evidence handling rules

1. Never store a password, service key, personal token, OTP, prescription, customer identity, phone number, exact customer location, or unredacted account identifier in evidence.
2. Store a redacted JSON artifact under `docs/launch/evidence/` or reference an access-controlled HTTPS record. Local files outside this directory and non-JSON local evidence are rejected.
3. Generate the correct local artifact shape with `npm run launch:evidence:template -- --gate <gate-name> --type <required-type>`, complete it, then validate it with `npm run launch:evidence:artifact:verify -- --file <path> --gate <gate-name> --type <required-type>`.
4. Repository evidence must include its lowercase SHA-256 digest in the registry. Prefer `npm run launch:evidence:record -- --artifact <path>` after the artifact is final; it validates the artifact, computes the digest and refuses unsafe confirmation. If `--confirm` is used for release-bound evidence, the recorder also requires the artifact's expected and observed release revisions to match the current Git checkout. `shasum -a 256 <path>` may still be used for manual cross-checking.
5. Use only the evidence types declared in each gate's `required_evidence_types` list.
6. A gate is confirmed only by its named accountable owner. Record the approver's name, role, and timezone-qualified approval timestamp.
7. Do not copy a generic approval across gates. The acceptance criterion in each registry entry must be satisfied by the referenced evidence.
8. For access-controlled HTTPS evidence, record the named verifier, verifier role and timezone-qualified verification time in the registry evidence entry.
9. Re-run `npm run launch:evidence:verify` after every evidence edit. Run the strict command only when all owners believe the release is ready.

## Owner closure board

Run `npm run launch:closure:board` before accountable-owner execution sessions.
It writes
`desktop-output/goal-progress-2026-07-22/go-live-closure-board-2026-07-22.json`,
which is a deterministic execution aid combining gate status, missing evidence,
prepared pending artifact references, owner workstreams, blocker summaries and
safe commands. The board is deliberately not evidence and never substitutes for
row-level review, physical UAT, deployment verification or named approval.

## Current safe release state

- The Cloudflare Worker is publicly reachable at `https://med250.gikundiro.com`; all ten required routes passed live deployment verification on 2026-07-20 against revision `37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c`. The registry points to `docs/launch/evidence/domain-verification-2026-07-20.json` and `docs/launch/evidence/domain-deployment-test-2026-07-20.json`, and those artifacts now expose the expected/observed release revision as structured fields. Because the repository has advanced since that live verification, `npm run launch:go-live:status` treats this as stale release-bound evidence until the live verifier is rerun against the current release SHA and the infrastructure owner approves the gate.
- The separate public Sites hostname runs catalog-only version 13 from immutable source revision `5ef50a296941056bd17e614dff7b35290742f50a`. Its current 10-route catalogue verification receipt passes; it remains a secondary catalogue surface and is never an alternate live ordering origin.
- The public catalogue and availability-request workflow are active. The protected release evidence gate remains incomplete and must not be represented as formally approved.
- Public DNS resolves through Cloudflare. The active verification plan is `docs/launch/dns/med250-cloudflare-domain-plan.json`.
- Wrangler is authenticated to the intended deployment account, but the current OAuth session has broad account-wide write scopes. The infrastructure owner must replace it with a narrowly scoped deploy credential before confirming least privilege.
- The redacted pending account record is `docs/launch/evidence/cloudflare-account-verification-pending-2026-07-16.json`; it must remain unreferenced by the production registry until the replacement credential is verified and the infrastructure owner completes it.
- Privileged Supabase verification is available through the protected connector and the live backend contract passes.
- The Edge Function and backend-hardening gates have complete machine evidence, but still require real backend-owner approval before either gate can be confirmed.
- Supabase server-side Turnstile validation is enabled with the production widget. Missing and invalid tokens are rejected without creating users; one controlled valid-token browser test remains before the security owner can sign the gate.
- The shared Supabase project currently reports an anonymous-user rate-limit value of 30, a one-hour JWT lifetime, and refresh-token rotation enabled. These project-wide settings still require a controlled impact test and security-owner approval.
- Public owner contact channels are now explicit live configuration: `NEXT_PUBLIC_MED250_CONTACT_EMAIL`, `NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP` and `NEXT_PUBLIC_MED250_MEETING_URL`. They must be approved public channels, and `release:check:live` rejects missing or unsafe values.
- The scoped advisor audit reports zero MED+250 performance warnings. MED+250 security warnings are the documented catalogue GraphQL surface, exact authenticated RPC allowlist, and anonymous customer-sign-in requirement; the aggregate contract rejects unexpected access drift.
- All 51 duplicate-register groups remain pending named human review.

## Gate closure matrix

| Gate | Accountable owner | Required evidence | Closure procedure |
| --- | --- | --- | --- |
| `MED250_GATE_GPS_READY` | Operations | Operations snapshot + review ledger | Complete the controlled private row-level GPS ledger, approve only authoritative premises coordinates, reconcile the intended GPS-ready production scope with actual routing, then rerun strict operational health. Build the redacted launch ledger with `npm run ops:readiness:evidence:build -- --input <gps-review-result.json> --date YYYY-MM-DD`; the input must contain aggregate counts and digests only. |
| `MED250_GATE_WHATSAPP_READY` | Operations | Operations snapshot + review ledger | Complete the controlled private row-level WhatsApp ledger, verify an authorised business WhatsApp identity for every intended responder, reconcile the scope with actual routing/login, then rerun strict operational health. Build the redacted launch ledger with `npm run ops:readiness:evidence:build -- --input <whatsapp-review-result.json> --date YYYY-MM-DD`; the input must contain aggregate counts and digests only. |
| `MED250_GATE_DUPLICATE_REGISTER_REVIEWED` | Register data reviewer | Review ledger | Run `npm run data:duplicates:packet` to generate a source-comparison packet, then decide all 51 synchronized groups in `data/imports/duplicate-register-review.csv` with reviewer, timestamp and rationale; `npm run data:duplicates:verify -- --strict` must pass. Then run `npm run data:duplicates:evidence:build -- --date YYYY-MM-DD --reviewed-by "Named register data reviewer" --reviewer-role "Register data reviewer" --reviewed-at "YYYY-MM-DDTHH:mm:ss+02:00"` to generate the completed launch evidence from the strict ledger. The packet deliberately contains no decision or recommendation. |
| `MED250_GATE_SECURITY_HARDENING_DEPLOYED` | Backend owner | Deployment receipt + test record | Review the passing 2026-07-18 deployment and test artifacts for contract `2026-07-18.3`, product-image and description governance, aggregate trust metrics, advisor scope, and the complete regression suite; then record the real backend-owner approval. |
| `MED250_GATE_EDGE_FUNCTIONS_DEPLOYED` | Backend owner | Deployment receipt + test record | Review the complete 2026-07-18 Edge Function deployment and test artifacts, including the active description reviewer, denial probe, protected-access boundaries and regression coverage; then record the real backend-owner approval. If a new function revision is deployed, regenerate and bind fresh deployment/test artifacts before approval. |
| `MED250_GATE_TURNSTILE_SERVER_VERIFIED` | Security owner | Test record | Use the real production widget, create only one disposable anonymous Auth identity without sending an availability request, revoke and delete it, restore the aggregate user count and retain the redacted verifier result. Then run `npm run security:turnstile:evidence:build -- --input <turnstile-verifier-result.json> --date YYYY-MM-DD --executed-by "Named security tester" --executor-role "Security owner" --started-at "YYYY-MM-DDTHH:mm:ss+02:00" --completed-at "YYYY-MM-DDTHH:mm:ss+02:00" --no-marketplace-side-effect-confirmed` to generate the completed test artifact. |
| `MED250_GATE_AUTH_RATE_LIMITS_APPROVED` | Security owner | Signed approval + test record | Complete the controlled aggregate rate-limit test from `docs/launch/SECURITY_OWNER_REVIEW.md`; obtain shared-project impact approval, test intended customer access and excess-attempt rejection with fresh real widget responses, remove every disposable identity, and approve monitoring and rollback conditions. Then run `npm run security:auth-rate-limit:evidence:build -- --input <auth-rate-limit-result.json> --date YYYY-MM-DD --executed-by "Named security tester" --executor-role "Security owner" --started-at "YYYY-MM-DDTHH:mm:ss+02:00" --completed-at "YYYY-MM-DDTHH:mm:ss+02:00" --approved-by "Named security owner" --approved-role "Security owner" --approved-at "YYYY-MM-DDTHH:mm:ss+02:00" --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" --change-authority "Named security owner with shared-project owner notice" --rollback-criteria "Restore the prior project setting if aggregate Auth health or legitimate customer access regresses" --legitimate-peak-profile "Privacy-safe expected anonymous customer session demand for the launch window" --abuse-risk-decision "Selected limit balances launch demand with automated abuse resistance" --monitoring-decision "Aggregate Auth and Worker health monitoring remains active through launch and first review"` to generate the completed test and approval artifacts. |
| `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED` | Privacy owner | Signed approval + test record | Review `docs/launch/PRESCRIPTION_RETENTION_POLICY.md`, approve the 24-hour and 30-day rules plus incident conditions, and retain the existing controlled test record. Then run `npm run privacy:prescription-retention:evidence:build -- --date YYYY-MM-DD --approved-by "Named privacy owner" --approved-role "Privacy owner" --approved-at "YYYY-MM-DDTHH:mm:ss+02:00" --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" --legal-basis-decision "Privacy-safe legal basis decision" --controller-processor-decision "Privacy-safe controller and processor decision" --transfer-decision "Privacy-safe transfer and evidence-storage decision" --notification-decision "Privacy-safe notification assessment decision" --incident-contacts-decision "Controlled staff register contains accountable privacy and security incident roles" --retention-decision "The implemented 24-hour and 30-day prescription retention periods are accepted" --pharmacy-handling-decision "Selected pharmacy staff handling requirements are accepted" --review-conditions "Review is required after material workflow, storage, retention, incident or legal-obligation changes"` to generate the completed signed approval artifact. |
| `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED` | Infrastructure owner | Account verification + signed approval | Complete the pending account-verification and account-approval artifacts. Create a deploy credential limited to the MED+250 Worker, its route, required asset capability and read-only zone inspection; replace the local and CI credential, revoke broad release-path access, verify deployment and sign both records. |
| `MED250_GATE_DOMAIN_DNS_VERIFIED` | Infrastructure owner | Domain verification + test record | Run `npm run domain:dns:verify`, then run `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <current-sha> --evidence-output <receipt.json>`. If the receipt passes, run `npm run domain:evidence:refresh -- --deployment-evidence <receipt.json> --expected-revision git --date YYYY-MM-DD` to update the two domain artifacts and registry digests without approving the gate. Confirm DNS, TLS, routing, headers, robots and sitemap before the infrastructure owner signs the gate. |
| `MED250_GATE_PHYSICAL_UAT_PASSED` | QA owner | Signed approval + test record | Complete all 12 scenarios in `data/physical-device-uat.json` with opaque identity labels, redacted evidence and named approval. `npm run uat:verify:live` must pass and no unintended pharmacy may receive a request, message, OTP or prescription. Then run `npm run uat:evidence:build -- --date YYYY-MM-DD` to generate complete test and approval artifacts from the strict ledger before recording them in the launch registry. |

## Controlled physical-device UAT script

Use a dedicated approved pharmacy and customer test identity. Record timestamps and outcomes, but redact phone numbers, OTPs, order IDs, prescription contents and exact coordinates.

1. Confirm preview access and verify ordering remains unavailable before the controlled live test environment is enabled.
2. Deny GPS permission and verify the recovery explanation; then grant permission and verify the bounded dispatch area.
3. Create an order containing both ordinary and prescription-required products; verify missing prescription enforcement and private upload handling.
4. Confirm only eligible pharmacies receive the request and an unrelated pharmacy cannot read it.
5. Send and verify one real WhatsApp pharmacy OTP; prove wrong, expired and reused codes are rejected without exposing the code in logs.
6. Confirm every requested item, quantity, price, fulfilment method and readiness time; test an allowed compatible substitute and reject an incompatible substitute.
7. Verify the customer sees no pharmacy contact before selection, then sees only the selected pharmacy's governed WhatsApp and MoMo details.
8. Verify WhatsApp and MoMo handoffs require explicit customer action and MED+250 does not claim custody of payment.
9. Test cancellation before selection, completion after selection and 24-hour expiry. Verify closure notifications and prescription access boundaries.
10. Inspect the aggregate operational-health snapshot and privacy-safe Worker logs. Confirm no phone, product, order, pharmacy, prescription or exact-location identifiers are present.
11. Have the QA owner sign the test record with their role and a timezone-qualified timestamp.

## Final release sequence

1. `npm run launch:evidence:status`
2. `npm run launch:evidence:verify`
3. `npm run launch:go-live:status`
4. `npm run data:duplicates:verify -- --strict`
5. `npm run uat:verify:live`
6. `npm run backend:verify`
7. `npm run backend:verify:description-reviewer -- --product-id PRODUCT_ID --expected-updated-at EXACT_INSPECT_UPDATED_AT --evidence-output docs/launch/evidence/product-description-reviewer-verification-YYYY-MM-DD.json`
8. `npm run ops:health:strict`
9. `npm run release:check:live`
10. Approve the protected `med250-production` GitHub environment and dispatch the manual workflow with the exact live confirmation phrase.
11. `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <exact-lowercase-40-character-git-sha>`

For `npm run release:check:live` and the protected GitHub workflow, set `MED250_DESCRIPTION_REVIEWER_PROBE_PRODUCT_ID` and `MED250_DESCRIPTION_REVIEWER_PROBE_EXPECTED_UPDATED_AT` to the exact freshly inspected row version. Store `MED250_ADMIN_TOKEN` only as the protected environment secret. The two probe values are release evidence inputs and must be refreshed whenever that product version changes; an empty or stale value fails closed.

### Routing-owner safety rule

`med250.gikundiro.com` is owned by the direct Cloudflare Worker route declared in `wrangler.jsonc`. Do not attach the same hostname to a Sites project or another Worker. The retired `med250.rw` Sites plan is retained only as historical evidence and is not part of the active production verification path.

The existing `med250-rwanda.ikanisa.chatgpt.site` hostname may remain only as a catalog-only secondary surface. Build it with `npm run build:sites`, verify it with `npm run sites:verify:catalog`, and never use it as deployment or browser evidence for the canonical live ordering origin.

If any command fails, keep public ordering and indexing disabled and return the responsible gate to `pending` or `rejected` until new evidence exists.
