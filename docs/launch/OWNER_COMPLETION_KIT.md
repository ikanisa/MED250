# MED+250 accountable-owner completion kit

This kit is the shortest safe path from the current verified implementation to a genuinely approved production release. It does not authorize Codex, an engineer, or an automated test to sign for an accountable owner.

## Start here

Run:

```sh
npm run launch:evidence:status
npm run --silent launch:evidence:handoff > /tmp/med250-owner-evidence-handoff.json
```

The second command produces all 17 currently missing artifact templates without changing the repository. Copy only a completed artifact into `docs/launch/evidence/`, validate it, hash it, and then add it to `data/launch-evidence.json`.

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

### Legal and regulatory

Gate:

- `MED250_GATE_REGULATORY_APPROVED`

The named legal/compliance owner must review the exact information-first marketplace model, central indicative-price wording, pharmacy-only fulfilment, WhatsApp handoff, medicine presentation, prescription handling, product advertising, Rwanda FDA conditions, RICA conditions, and any health-sector obligations. Record conditions or restrictions in the signed artifact; do not use a generic project approval.

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

It already inventories the nine active source classes, binds the current derived data and captured external snapshots to SHA-256 digests, records Amazon as taxonomy/product-reference research only, and confirms that Amazon prices are absent. Resolve its three explicit provenance blockers before signing: retain the missing raw Rwanda FDA register snapshots, replace the duty-roster source-digest placeholder with exact PDF digests, and place the local Amazon research snapshot under an approved durable retention arrangement. Then record one reuse decision per source class and follow the artifact's completion instructions.

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

Final check:

```sh
npm run data:duplicates:verify -- --strict
```

### Security owner

Gates:

- `MED250_GATE_CREDENTIALS_ROTATED`
- `MED250_GATE_TURNSTILE_SERVER_VERIFIED`
- `MED250_GATE_AUTH_RATE_LIMITS_APPROVED`

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

The required deployment and test artifacts already exist. The backend owner must inspect them, verify the current live contract remains `2026-07-16.10`, verify database SSL enforcement, the independent product-image approval trigger, DDL governance guard, six function versions, protected probes, and the scoped database-advisor record, and add their name, role, and timezone-qualified approval to the registry. If privileged credentials have since changed, rerun:

```sh
npm run backend:verify
npm run ops:health:strict
```

### Privacy owner

Gate:

- `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED`

Review and approve the implemented 24-hour orphan/abandoned-file rule, 24-hour selected-pharmacy access window, 30-day completed-order deletion rule, six-hour protected schedule, lease/retry behavior, and incident procedure. The controlled cleanup test artifact already exists; a signed privacy decision remains required.

### Infrastructure owner

Gates:

- `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED`
- `MED250_GATE_DOMAIN_DNS_VERIFIED`

Required work:

The current redacted snapshot is
`docs/launch/evidence/cloudflare-account-verification-pending-2026-07-16.json`.
It confirms one intended account and the production deployment are visible,
but records that the interactive OAuth session still has 29 broad permissions.

1. Create and install the least-privilege Cloudflare deployment token described above.
2. Confirm the intended account, production Worker, custom-domain route, protected GitHub environment, and secret/variable ownership.
3. Verify DNS, TLS, redirects, headers, robots, sitemap, and all seven representative routes.
4. Add the redacted account-verification artifact and signed approval.
5. Inspect the existing domain artifacts and add named infrastructure approval.

Commands:

```sh
npm run domain:dns:verify
npm run cloudflare:check:production
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live
```

### QA owner

Gate:

- `MED250_GATE_PHYSICAL_UAT_PASSED`

Use only approved, opaque customer, pharmacy, and unrelated-pharmacy test identities. Execute all 12 scenarios in `data/physical-device-uat.json`. Do not record real phone numbers, OTPs, order IDs, prescription contents, or exact coordinates. Do not contact an unintended pharmacy.

Final check:

```sh
npm run uat:verify:live
```

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
npm run deployment:verify -- --url https://med250.gikundiro.com --mode live
```

The protected production workflow additionally requires the exact live confirmation phrase and approval of the `med250-production` GitHub environment.
