# MED+250 accountable-owner completion kit

This kit is the shortest safe path from the current verified implementation to a genuinely approved production release. It does not authorize Codex, an engineer, or an automated test to sign for an accountable owner.

## Start here

Run:

```sh
npm run launch:evidence:status
npm run launch:go-live:status
npm run launch:closure:board
npm run launch:approval:packet
npm run --silent launch:evidence:handoff > /tmp/med250-owner-evidence-handoff.json
npm run audit:browser-evidence:verify
npm run audit:closure:status
```

`npm run launch:closure:board` writes a deterministic owner work board to
`desktop-output/goal-progress-2026-07-22/go-live-closure-board-2026-07-22.json`.
It combines the current go-live status, evidence handoff, duplicate-register
state and physical-device UAT state into one execution queue. It is not evidence
and does not approve anything.

The handoff command produces one deterministic packet for the currently missing
evidence types without changing the repository. Every one now has a prepared
pending artifact with gate-specific checks, unresolved actions and completion
instructions. Complete the listed file in place, validate it, hash it, and then
add it to `data/launch-evidence.json`. Do not replace a prepared packet with a
generic template.

For every artifact:

```sh
npm run launch:evidence:artifact:verify -- \
  --file docs/launch/evidence/ARTIFACT.json \
  --gate MED250_GATE_NAME \
  --type EVIDENCE_TYPE

shasum -a 256 docs/launch/evidence/ARTIFACT.json
npm run launch:evidence:verify
```

After an artifact validates, record it with the guarded registry helper:

```sh
npm run launch:evidence:record -- \
  --artifact docs/launch/evidence/ARTIFACT.json
```

When the last required evidence type for a gate is present and the accountable
owner has approved the gate, confirm it in the same guarded path:

```sh
npm run launch:evidence:record -- \
  --artifact docs/launch/evidence/FINAL-ARTIFACT.json \
  --confirm \
  --approved-by "Named owner" \
  --approved-role "Accountable role" \
  --approved-at "2026-07-20T18:00:00+02:00"
```

The helper validates the artifact strictly, computes the SHA-256 digest, refuses
secret-like references, refuses duplicate evidence unless `--replace` is
explicit, and will not record approval metadata without `--confirm`.

For gates where all required evidence is already present but owner approval is
missing, use the generated review packet:

- `desktop-output/goal-progress-2026-07-20/launch-approval-packet-2026-07-20.json`

Refresh it with `npm run launch:approval:packet`. It lists the exact evidence,
acceptance criterion and safe confirmation command for each evidence-complete
gate that is still current. Evidence-complete gates with stale release-bound
artifacts appear under blocked approvals instead and must be refreshed before
owner signature.

The lower-level recorder enforces the same rule. `npm run launch:evidence:record -- --confirm`
refuses to confirm a release-bound gate when the artifact's expected and observed
release revisions do not match the current Git checkout.

Do not store a credential, token, phone number, OTP, customer identity, email address, prescription content, exact customer location, or unredacted account identifier.

Before live approval, configure the approved public MED+250 owner channels:

- `NEXT_PUBLIC_MED250_CONTACT_EMAIL`
- `NEXT_PUBLIC_MED250_SUPPORT_WHATSAPP`
- `NEXT_PUBLIC_MED250_MEETING_URL`

These are public support/meeting-booking channels for the marketplace owner, not
pharmacy responder contacts. Keep staff-private accounts and all server-only
WhatsApp Cloud credentials out of these variables.

## Independent browser QA approval

The controlled browser execution is complete against production release
`5ef50a296941056bd17e614dff7b35290742f50a`: all 16 governed desktop/mobile
scenarios and all 56 privacy-reviewed PNG captures pass. The ledger is
`data/audit-browser-evidence.json`; its screenshot set is
`docs/audit/browser-evidence/`. Its overall status remains deliberately
`pending` with `execution_status: completed_awaiting_approval`.

An independent QA owner must:

1. Review the deployment and catalogue receipt bindings, scenario notes, routes,
   viewports, timestamps, PNG digests and the full screenshot set.
2. Confirm the evidence contains no customer identity, phone, OTP, prescription,
   request identifier, exact location, credential or secret.
3. Record their real name, role and timezone-qualified approval timestamp in
   `approved_by`, `approved_role` and `approved_at`.
4. Set the overall ledger `status` to `passed` only after that review. Do not
   change individual capture facts or the bound release revision.
5. Run `npm run audit:browser-evidence:verify:live`. The strict verifier must
   pass before the browser ledger can close any audit finding.

## Owner work packets

### Operations

Gates:

- `MED250_GATE_GPS_READY`
- `MED250_GATE_WHATSAPP_READY`

Required work:

1. Review the intended production pharmacy set one record at a time.
2. Accept coordinates only where the source proves the operating premises and the review record identifies the reviewer and source version.
3. Accept a WhatsApp contact only where the pharmacy or an authoritative source proves that the number is authorized for the pharmacy.
4. Do not infer WhatsApp capability from an ordinary public phone number.
5. Produce the two review ledgers.

Generate the shared public-registry review index with:

```sh
npm run ops:readiness:packet
```

The generated packet is:

- `desktop-output/goal-progress-2026-07-20/operations-readiness-packet-2026-07-20.json`

It contains the 769-row registry index for both GPS and WhatsApp review, but no
phone numbers, precise coordinates or owner approval. Keep the actual
coordinate/contact evidence and row-level decisions in the controlled private
operations ledger.

Current aggregate evidence already records 93 GPS-ready pharmacies, 300 pharmacies with WhatsApp coverage, 338 login-enabled WhatsApp contacts, and 300 dispatch-ready pharmacies. These counts do not replace record-level GPS and WhatsApp review.

Use these redacted aggregate ledger shells only as the current pending templates:

- `docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json`
- `docs/launch/evidence/whatsapp-readiness-review-ledger-pending-2026-07-16.json`

Keep precise coordinates and contact values in the controlled private ledgers.
After every row is decided and `npm run ops:health:strict` passes, create a
redacted aggregate review-result JSON containing only counts, source digests,
reviewer metadata and the controlled private-ledger reference. Then build the
launch artifact:

```sh
npm run ops:readiness:evidence:build -- \
  --input desktop-output/goal-progress-YYYY-MM-DD/gps-readiness-review-result.json \
  --date YYYY-MM-DD

npm run ops:readiness:evidence:build -- \
  --input desktop-output/goal-progress-YYYY-MM-DD/whatsapp-readiness-review-result.json \
  --date YYYY-MM-DD
```

The builder refuses pending/blocked aggregate results and rejects phone numbers,
coordinates, contact values, tokens or output paths outside `docs/launch/evidence/`.
The release artifacts contain only aggregate counts, source digests, allowed
decisions and completion instructions.

### Register data reviewer

Gate:

- `MED250_GATE_DUPLICATE_REGISTER_REVIEWED`

Run:

```sh
npm run data:duplicates:packet
```

Review all 51 groups in `desktop-output/goal-progress-2026-07-20/duplicate-register-review-packet-2026-07-20.json`. Record only one of:

- `accepted_source_duplicate` when the authoritative source genuinely contains distinct valid records sharing the identifier;
- `blocked_source_correction` when an authoritative correction is still required.

Every decision needs reviewer name, timezone-qualified timestamp, and rationale. Never merge or delete source rows merely to make the verifier pass.

After the strict CSV review passes, build the completed launch ledger from the
governed inputs:

```sh
npm run data:duplicates:evidence:build -- \
  --date YYYY-MM-DD \
  --reviewed-by "Named register data reviewer" \
  --reviewer-role "Register data reviewer" \
  --reviewed-at "YYYY-MM-DDTHH:mm:ss+02:00"
```

The builder refuses the current pending ledger and writes only under
`docs/launch/evidence/`.

Final check:

```sh
npm run data:duplicates:verify -- --strict
npm run data:duplicates:evidence:build -- --date YYYY-MM-DD --reviewed-by "Named register data reviewer" --reviewer-role "Register data reviewer" --reviewed-at "YYYY-MM-DDTHH:mm:ss+02:00"
```

### Security owner

Gates:

- `MED250_GATE_TURNSTILE_SERVER_VERIFIED`
- `MED250_GATE_AUTH_RATE_LIMITS_APPROVED`

Use `docs/launch/SECURITY_OWNER_REVIEW.md` as the shared decision and execution packet. Its pending artifacts are:

- `docs/launch/evidence/turnstile-positive-path-test-pending-2026-07-16.json`
- `docs/launch/evidence/auth-rate-limit-test-pending-2026-07-16.json`
- `docs/launch/evidence/auth-rate-limit-approval-pending-2026-07-16.json`

Turnstile positive-path test:

Current production configuration already reports Turnstile enabled and the
automated verifier proves that missing and invalid tokens return a CAPTCHA
rejection without changing the aggregate Auth user count. Only the real-widget
positive path below remains:

1. Use the production hostname in a controlled browser.
2. Complete the real production widget.
3. Put the short-lived token only in the operator process environment.
4. Run `npm run security:turnstile:verify -- --require-valid` with the protected
   Supabase URL, publishable key, and server key in that same process.
5. The verifier first proves missing and invalid tokens cannot create users,
   creates only one disposable anonymous identity with the valid token, revokes
   its session, deletes it, and confirms the aggregate user count is restored.
6. Do not submit an availability request or contact a pharmacy.
7. Retain the redacted command result without the token or identity, then build
   the launch evidence:

```sh
npm run security:turnstile:evidence:build -- \
  --input desktop-output/goal-progress-YYYY-MM-DD/turnstile-verifier-result.json \
  --date YYYY-MM-DD \
  --executed-by "Named security tester" \
  --executor-role "Security owner" \
  --started-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --completed-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --no-marketplace-side-effect-confirmed
```

The builder refuses negative-only verifier output, leaked tokens/identifiers,
missing cleanup, or a missing no-marketplace-side-effect confirmation.

Rate-limit test:

The current project reports anonymous identities enabled, an anonymous-user
rate-limit value of 30, a one-hour JWT lifetime, and refresh-token rotation
enabled. These are project-wide settings in a shared Supabase project and must
be approved without changing unrelated DineIn or BioPay behavior.

1. Agree a controlled test window.
2. Verify intended anonymous customer access.
3. Verify repeated abusive creation attempts are rejected.
4. Confirm no unintended user, request, or pharmacy record remains.
5. Retain only a redacted aggregate rate-limit test result.
6. Build the completed test and approval artifacts:

```sh
npm run security:auth-rate-limit:evidence:build -- \
  --input desktop-output/goal-progress-YYYY-MM-DD/auth-rate-limit-result.json \
  --date YYYY-MM-DD \
  --executed-by "Named security tester" \
  --executor-role "Security owner" \
  --started-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --completed-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --approved-by "Named security owner" \
  --approved-role "Security owner" \
  --approved-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --change-authority "Named security owner with shared-project owner notice" \
  --rollback-criteria "Restore the prior project setting if aggregate Auth health or legitimate customer access regresses" \
  --legitimate-peak-profile "Privacy-safe expected anonymous customer session demand for the launch window" \
  --abuse-risk-decision "Selected limit balances launch demand with automated abuse resistance" \
  --monitoring-decision "Aggregate Auth and Worker health monitoring remains active through launch and first review"
```

The builder refuses pending tests, missing shared-project approval, missing
cleanup, failed excess-attempt rejection, leaked tokens/identifiers, marketplace
side effects, shared-application regressions, or approval metadata without a
future review date.

### Backend owner

Gates:

- `MED250_GATE_SECURITY_HARDENING_DEPLOYED`
- `MED250_GATE_EDGE_FUNCTIONS_DEPLOYED`

The historical deployment and test artifacts cover the six functions reviewed on 2026-07-16 and remain historical. Fresh 2026-07-18 deployment and test artifacts now bind the active description reviewer, backend contract `2026-07-18.3`, description governance, aggregate trust boundary, scoped database advisors, and the 302-test suite captured when those artifacts were generated. The current serial suite passes 304/304 after adding the exact-release recommendation checks. The anonymous reviewer-denial probe passes. The backend owner must use the protected administrator credential and a controlled product identity for the remaining authenticated read-only inspection, review the fresh artifacts, and add their real name, role, and timezone-qualified approval to the registry. Run:

```sh
npm run backend:verify
npm run backend:verify:description-reviewer -- --product-id PRODUCT_ID --expected-updated-at EXACT_INSPECT_UPDATED_AT --evidence-output docs/launch/evidence/product-description-reviewer-verification-YYYY-MM-DD.json
npm run ops:health:strict
```

Use the exact `updated_at` returned by a fresh inspection. The receipt contains no response body, raw product identifier, credentials, description, or review note. Hash it and bind that digest into the current Edge Function test record before owner approval; the automated records are supporting evidence, not approval artifacts by themselves.

Configure the protected production environment with `MED250_ADMIN_TOKEN` as a secret and the exact probe inputs as `MED250_DESCRIPTION_REVIEWER_PROBE_PRODUCT_ID` and `MED250_DESCRIPTION_REVIEWER_PROBE_EXPECTED_UPDATED_AT` variables. The live release gate intentionally rejects missing or stale probe inputs.

After the backend owner reviews the evidence-complete gates, record approval
with the explicit gate approval helper instead of hand-editing
`data/launch-evidence.json`:

```sh
npm run launch:gate:approve -- \
  --gate MED250_GATE_SECURITY_HARDENING_DEPLOYED \
  --approved-by "Named backend owner" \
  --approved-role "Backend owner" \
  --approved-at "YYYY-MM-DDTHH:mm:ss+02:00"

npm run launch:gate:approve -- \
  --gate MED250_GATE_EDGE_FUNCTIONS_DEPLOYED \
  --approved-by "Named backend owner" \
  --approved-role "Backend owner" \
  --approved-at "YYYY-MM-DDTHH:mm:ss+02:00"
```

The helper refuses incomplete evidence, invalid launch evidence, stale
release-bound evidence, unsafe approval metadata or timestamps without an
explicit timezone.

### Privacy owner

Gate:

- `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED`

Review and approve the implemented 24-hour orphan/abandoned-file rule, 24-hour selected-pharmacy access window, 30-day completed-order deletion rule, six-hour protected schedule, lease/retry behavior, and incident procedure. The controlled cleanup test artifact already exists; a signed privacy decision remains required.

Use `docs/launch/PRESCRIPTION_RETENTION_POLICY.md` as the exact policy under
review and the existing strict cleanup test artifact as the technical proof.
After the privacy owner records the redacted legal, role, transfer,
notification, incident, retention and pharmacy-handling decisions, build the
completed approval artifact:

```sh
npm run privacy:prescription-retention:evidence:build -- \
  --date YYYY-MM-DD \
  --approved-by "Named privacy owner" \
  --approved-role "Privacy owner" \
  --approved-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --legal-basis-decision "Privacy-safe legal basis decision" \
  --controller-processor-decision "Privacy-safe controller and processor decision" \
  --transfer-decision "Privacy-safe transfer and evidence-storage decision" \
  --notification-decision "Privacy-safe notification assessment decision" \
  --incident-contacts-decision "Controlled staff register contains accountable privacy and security incident roles" \
  --retention-decision "The implemented 24-hour and 30-day prescription retention periods are accepted" \
  --pharmacy-handling-decision "Selected pharmacy staff handling requirements are accepted" \
  --review-conditions "Review is required after material workflow, storage, retention, incident or legal-obligation changes"
```

The builder refuses stale or incomplete cleanup test evidence, missing policy
sections, unsafe identifiers, secret-like material, missing privacy-owner
decisions, or a next review timestamp that is not after approval.

### Infrastructure owner

Gates:

- `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED`
- `MED250_GATE_DOMAIN_DNS_VERIFIED`

Required work:

The current redacted snapshot is
`docs/launch/evidence/cloudflare-account-verification-pending-2026-07-16.json`.
It confirms one intended account and the production deployment are visible,
but records that the interactive OAuth session still has 29 broad permissions.
Do not record that pending artifact. After the replacement least-privilege
credential and protected release path are verified, build completed artifacts
from a redacted aggregate verification result:

1. Create and install the least-privilege Cloudflare deployment token described above.
2. Confirm the intended account, production Worker, custom-domain route, protected GitHub environment, and secret/variable ownership.
3. Review the fresh July 20 domain artifacts, then rerun DNS, TLS, redirects, headers, robots, sitemap, and all ten required routes immediately before signing.
4. Build and record the redacted account-verification artifact and signed approval.

```sh
npm run infra:cloudflare-account:evidence:build -- \
  --input desktop-output/goal-progress-YYYY-MM-DD/cloudflare-account-result.json \
  --date YYYY-MM-DD \
  --verified-by "Named infrastructure verifier" \
  --verifier-role "Infrastructure owner" \
  --verified-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --approved-by "Named infrastructure owner" \
  --approved-role "Infrastructure owner" \
  --approved-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --next-review-at "YYYY-MM-DDTHH:mm:ss+02:00" \
  --account-ownership-decision "Redacted account, production Worker and preview Worker are intended MED+250 release assets" \
  --credential-scope-decision "Replacement release credential is limited to MED+250 deployment needs and read-only zone inspection" \
  --release-path-decision "Broad interactive access is removed from the release path and cannot deploy production" \
  --environment-ownership-decision "Protected production and preview environments have named ownership, approval rules, secrets and variables" \
  --routing-boundary-decision "The direct production Worker route is the sole active owner of the production hostname" \
  --rollback-decision "Rollback authority and emergency release access are assigned to the infrastructure owner group"
```

The builder refuses broad write permissions, missing route ownership, missing
protected environments, competing hostname owners, leaked tokens/identifiers, or
approval decisions without a future review timestamp.
5. Inspect the existing domain artifacts and add named infrastructure approval.

Commands:

```sh
npm run domain:dns:verify
npm run cloudflare:check:production
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <exact-lowercase-40-character-git-sha> --evidence-output desktop-output/goal-progress-YYYY-MM-DD/domain-deployment-receipt.json
npm run domain:evidence:refresh -- --deployment-evidence desktop-output/goal-progress-YYYY-MM-DD/domain-deployment-receipt.json --expected-revision git --date YYYY-MM-DD
npm run launch:gate:approve -- --gate MED250_GATE_DOMAIN_DNS_VERIFIED --approved-by "Named infrastructure owner" --approved-role "Infrastructure owner" --approved-at "YYYY-MM-DDTHH:mm:ss+02:00"
```

The current machine evidence for the domain gate is:

- `docs/launch/evidence/domain-verification-2026-07-20.json`
- `docs/launch/evidence/domain-deployment-test-2026-07-20.json`

It passed against live revision `37d8c1c0e0c8ac2d15eea436d2f9037c20e2814c`. That revision binding is now recorded in the domain artifacts, and the checkout has advanced since that run. Before signing the domain gate, rerun the live deployment verifier with the current release SHA, then use `npm run domain:evidence:refresh` to update the domain artifacts and registry digests from the passed receipt. The refresh helper does not approve the gate; the infrastructure owner must still confirm the intended Cloudflare account and route ownership, then use `npm run launch:gate:approve`. The approval helper refuses stale release-bound evidence.

### QA owner

Gate:

- `MED250_GATE_PHYSICAL_UAT_PASSED`

Start from:

- `data/physical-device-uat.json`
- `desktop-output/goal-progress-2026-07-20/physical-device-uat-packet-2026-07-20.json`
- `docs/launch/evidence/physical-device-uat-test-pending-2026-07-16.json`
- `docs/launch/evidence/physical-device-uat-approval-pending-2026-07-16.json`

Generate or refresh the execution packet with `npm run uat:packet`. Use only approved, opaque customer, pharmacy, and unrelated-pharmacy test identities. Execute all 12 scenarios in `data/physical-device-uat.json`. Do not record real phone numbers, OTPs, order IDs, prescription contents, or exact coordinates. Do not contact an unintended pharmacy. After the strict ledger passes, run `npm run uat:evidence:build -- --date YYYY-MM-DD`; it refuses pending or unsafe ledgers and writes complete launch evidence artifacts from the governed UAT record.

Final check:

```sh
npm run uat:verify:live
npm run uat:evidence:build -- --date YYYY-MM-DD
```

The browser approval above is independent of physical-device UAT. Responsive
browser emulation does not replace real-device GPS, OTP, WhatsApp, MoMo,
prescription, notification, lifecycle or cleanup evidence.

## Audit closure work outside the 11 launch gates

The launch registry does not absorb the separately governed audit ledgers.
After the owner packets above, the accountable owners must also complete:

- qualified Kinyarwanda translation, glossary review and clinical/legal sign-off
  in the locale-release ledger;
- all 72 source-bound product-content decisions in
  `data/imports/product-content-review-pending-2026-07-18.json` without inferring
  medicine ingredients or merging distinct registrations;
- canonical sitemap submission and priority-URL inspection in Google Search
  Console, with dated owner evidence;
- authentic creative rights/release approval before replacing any governed
  catalogue creative;
- the three strategic owner decisions on payments, marketplace expansion and
  personalization.

`docs/audit/unified-audit-closure-status-2026-07-18.md` and
`npm run audit:closure:status` are the authoritative consolidated queue.

## Final protected release

Only after every owner packet is complete:

```sh
npm run launch:evidence:verify:live
npm run launch:go-live:status
npm run data:duplicates:verify -- --strict
npm run uat:verify:live
npm run backend:verify
npm run ops:health:strict
npm run security:audit
npm run release:check:live
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <exact-lowercase-40-character-git-sha>
```

The protected production workflow additionally requires the exact live confirmation phrase and approval of the `med250-production` GitHub environment.
