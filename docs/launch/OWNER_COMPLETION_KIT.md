# MED+250 accountable-owner completion kit

This kit is the shortest safe path from the current verified implementation to a genuinely approved production release. It does not authorize Codex, an engineer, or an automated test to sign for an accountable owner.

## Start here

Run:

```sh
npm run launch:evidence:status
npm run --silent launch:evidence:handoff > /tmp/med250-owner-evidence-handoff.json
npm run audit:browser-evidence:verify
npm run audit:closure:status
```

The second command produces one deterministic handoff for all 17 currently missing evidence types without changing the repository. Every one now has a prepared pending artifact with gate-specific checks, unresolved actions and completion instructions. Complete the listed file in place, validate it, hash it, and then add it to `data/launch-evidence.json`. Do not replace a prepared packet with a generic template.

For every artifact:

```sh
npm run launch:evidence:artifact:verify -- \
  --file docs/launch/evidence/ARTIFACT.json \
  --gate MED250_GATE_NAME \
  --type EVIDENCE_TYPE

shasum -a 256 docs/launch/evidence/ARTIFACT.json
npm run launch:evidence:verify
```

Do not store a credential, token, phone number, OTP, customer identity, email address, prescription content, exact customer location, or unredacted account identifier.

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
- `MED250_GATE_PHARMACY_OPERATIONS_APPROVED`

Required work:

1. Review the intended production pharmacy set one record at a time.
2. Accept coordinates only where the source proves the operating premises and the review record identifies the reviewer and source version.
3. Accept a WhatsApp contact only where the pharmacy or an authoritative source proves that the number is authorized for the pharmacy.
4. Do not infer WhatsApp capability from an ordinary public phone number.
5. Approve written dispatch, response, escalation, expiry, cancellation, prescription, incident, and WhatsApp handoff procedures.
6. Produce the two review ledgers and the operations signed approval.

Current aggregate evidence already records 93 GPS-ready pharmacies, 300 pharmacies with WhatsApp coverage, 338 login-enabled WhatsApp contacts, and 300 dispatch-ready pharmacies. These counts do not replace record-level approval.

The complete procedure is `docs/launch/PHARMACY_OPERATIONS_SOP.md`. Review it against the intended production pharmacy set, assign the named operating and escalation roles in the controlled staff register, and complete `docs/launch/evidence/pharmacy-operations-approval-pending-2026-07-16.json`. If the operating model changes, update the procedure, repeat the relevant tests and replace the recorded procedure digest before signing.

Use these redacted aggregate ledger shells for the record-level readiness decisions:

- `docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json`
- `docs/launch/evidence/whatsapp-readiness-review-ledger-pending-2026-07-16.json`

Keep precise coordinates and contact values in the controlled private ledgers. The release artifacts contain only aggregate counts, source digests, allowed decisions and completion instructions.

### Legal and regulatory

Gate:

- `MED250_GATE_REGULATORY_APPROVED`

The named legal/compliance owner must review the exact information-first marketplace model, central indicative-price wording, pharmacy-only fulfilment, WhatsApp handoff, medicine presentation, prescription handling, product advertising, Rwanda FDA conditions, RICA conditions, and any health-sector obligations. Record conditions or restrictions in the signed artifact; do not use a generic project approval.

Start with:

- `docs/launch/RWANDA_REGULATORY_REVIEW_BRIEF.md`
- `docs/launch/evidence/regulatory-approval-pending-2026-07-16.json`

The brief records two material current-law actions that cannot be closed by engineering: Law No. 011/2026 requires an enterprise engaging in e-commerce or online-intermediary services to apply for the corresponding RICA licence, with an existing-operator conformity period of no more than six months from 4 March 2026; and Rwanda FDA's promotion rules expressly include catalogues and internet/electronic displays within regulated advertising where they promote supply, sale or use. The owner must obtain authoritative written determinations or approvals for the exact MED+250 presentation and operation, complete the privacy and health-sector decisions in the brief, and sign only after every pending check passes.

### Data owner

Gate:

- `MED250_GATE_DATA_REUSE_APPROVED`

Review provenance, licence, permission, publication scope, refresh cadence, and withdrawal procedure for:

- Rwanda FDA medicine and pharmacy registers;
- Amazon category/taxonomy and product-reference research;
- Rwanda government GIS;
- MMI and other pharmacy-directory evidence;
- pharmacy contact evidence;
- Rwanda observed central indicative-price sources.

The review ledger must cover every active source and include exact SHA-256 source digests. If a source is not approved for publication or operational reuse, remove or replace the affected derived data before approval.

Start from the prepared redacted ledger:

- `docs/launch/evidence/data-reuse-review-ledger-pending-2026-07-16.json`
- `docs/launch/evidence/data-reuse-approval-pending-2026-07-16.json`

It already inventories the nine active source classes, binds the current derived data and captured external snapshots to SHA-256 digests, records Amazon as taxonomy/product-reference research only, and confirms that Amazon prices are absent. A controlled private bundle now retains 25 exact artifacts: the raw Amazon snapshot, corrected 2,200-row import dataset, final 4,680-record workbook, Rwanda FDA product and licensed-premises sources, all 11 active Rwanda FDA duty-roster PDFs, governed derived releases and supporting manifests. The redacted technical receipt is `docs/launch/evidence/source-retention-bundle-2026-07-16.json`.

Before signing, approve the current private durable-storage location or move the unchanged bundle to an approved evidence store and run:

```sh
npm run data:source-retention:verify
```

Retain the verified manifest SHA-256, then record one approval, rejection or conditional approval per source class and follow the two pending artifacts' completion instructions. Technical retention does not itself grant publication or operational-reuse rights.

### Regulatory data reviewer

Gate:

- `MED250_GATE_DUPLICATE_REGISTER_REVIEWED`

Run:

```sh
npm run data:duplicates:packet
```

Review all 51 groups in `desktop-output/goal-progress-2026-07-16/04-duplicate-review-packet.json`. Record only one of:

- `accepted_source_duplicate` when the authoritative source genuinely contains distinct valid records sharing the identifier;
- `blocked_source_correction` when an authoritative correction is still required.

Every decision needs reviewer name, timezone-qualified timestamp, and rationale. Never merge or delete source rows merely to make the verifier pass.

Complete the prepared redacted launch ledger after the row-level review:

- `docs/launch/evidence/duplicate-register-review-ledger-pending-2026-07-16.json`

Final check:

```sh
npm run data:duplicates:verify -- --strict
```

### Security owner

Gates:

- `MED250_GATE_CREDENTIALS_ROTATED`
- `MED250_GATE_TURNSTILE_SERVER_VERIFIED`
- `MED250_GATE_AUTH_RATE_LIMITS_APPROVED`

Use `docs/launch/SECURITY_OWNER_REVIEW.md` as the shared decision and execution packet. Its pending artifacts are:

- `docs/launch/evidence/credentials-rotation-deployment-receipt-pending-2026-07-16.json`
- `docs/launch/evidence/credentials-rotation-approval-pending-2026-07-16.json`
- `docs/launch/evidence/turnstile-positive-path-test-pending-2026-07-16.json`
- `docs/launch/evidence/auth-rate-limit-test-pending-2026-07-16.json`
- `docs/launch/evidence/auth-rate-limit-approval-pending-2026-07-16.json`

Credential work:

1. Revoke every previously exposed Supabase service, database, personal, and deployment credential.
2. Replace each downstream CI, local, and server reference.
3. Replace the current broad Cloudflare OAuth session with a token limited to the MED+250 Worker, required route/assets, and read-only zone inspection.
4. Verify old credentials fail.
5. Verify the new credentials perform only the intended operations.
6. Store only a redacted deployment receipt and signed approval.

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
7. Retain the redacted command result without the token or identity.

Rate-limit test:

The current project reports anonymous identities enabled, an anonymous-user
rate-limit value of 30, a one-hour JWT lifetime, and refresh-token rotation
enabled. These are project-wide settings in a shared Supabase project and must
be approved without changing unrelated DineIn or BioPay behavior.

1. Agree a controlled test window.
2. Verify intended anonymous customer access.
3. Verify repeated abusive creation attempts are rejected.
4. Confirm no unintended user, request, or pharmacy record remains.
5. Sign the selected limits and their operational impact.

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

### Privacy owner

Gate:

- `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED`

Review and approve the implemented 24-hour orphan/abandoned-file rule, 24-hour selected-pharmacy access window, 30-day completed-order deletion rule, six-hour protected schedule, lease/retry behavior, and incident procedure. The controlled cleanup test artifact already exists; a signed privacy decision remains required.

Use `docs/launch/PRESCRIPTION_RETENTION_POLICY.md` as the exact policy under review and complete `docs/launch/evidence/prescription-retention-approval-pending-2026-07-16.json`. The pending artifact already binds the policy and controlled cleanup test to their SHA-256 values; the privacy owner must add the legal, role and incident decisions.

### Infrastructure owner

Gates:

- `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED`
- `MED250_GATE_DOMAIN_DNS_VERIFIED`

Required work:

The current redacted snapshot is
`docs/launch/evidence/cloudflare-account-verification-pending-2026-07-16.json`.
It confirms one intended account and the production deployment are visible,
but records that the interactive OAuth session still has 29 broad permissions.
The paired infrastructure signature is
`docs/launch/evidence/cloudflare-account-approval-pending-2026-07-16.json`.

1. Create and install the least-privilege Cloudflare deployment token described above.
2. Confirm the intended account, production Worker, custom-domain route, protected GitHub environment, and secret/variable ownership.
3. Verify DNS, TLS, redirects, headers, robots, sitemap, and all ten required routes.
4. Add the redacted account-verification artifact and signed approval.
5. Inspect the existing domain artifacts and add named infrastructure approval.

Commands:

```sh
npm run domain:dns:verify
npm run cloudflare:check:production
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <exact-lowercase-40-character-git-sha>
```

### QA owner

Gate:

- `MED250_GATE_PHYSICAL_UAT_PASSED`

Start from:

- `data/physical-device-uat.json`
- `docs/launch/evidence/physical-device-uat-test-pending-2026-07-16.json`
- `docs/launch/evidence/physical-device-uat-approval-pending-2026-07-16.json`

Use only approved, opaque customer, pharmacy, and unrelated-pharmacy test identities. Execute all 12 scenarios in `data/physical-device-uat.json`. Do not record real phone numbers, OTPs, order IDs, prescription contents, or exact coordinates. Do not contact an unintended pharmacy.

Final check:

```sh
npm run uat:verify:live
```

The browser approval above is independent of physical-device UAT. Responsive
browser emulation does not replace real-device GPS, OTP, WhatsApp, MoMo,
prescription, notification, lifecycle or cleanup evidence.

## Audit closure work outside the 15 launch gates

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
npm run data:duplicates:verify -- --strict
npm run uat:verify:live
npm run backend:verify
npm run ops:health:strict
npm run security:audit
npm run release:check:live
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live --expected-revision <exact-lowercase-40-character-git-sha>
```

The protected production workflow additionally requires the exact live confirmation phrase and approval of the `med250-production` GitHub environment.
