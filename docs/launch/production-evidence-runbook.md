# MED+250 production evidence runbook

This runbook closes the 15 fail-closed production gates without weakening them or treating configuration flags as evidence. The authoritative registry is `data/launch-evidence.json`; `npm run launch:evidence:verify:live` is the final machine gate.

## Evidence handling rules

1. Never store a password, service key, personal token, OTP, prescription, customer identity, phone number, exact customer location, or unredacted account identifier in evidence.
2. Store a redacted JSON artifact under `docs/launch/evidence/` or reference an access-controlled HTTPS record. Local files outside this directory and non-JSON local evidence are rejected.
3. Generate the correct local artifact shape with `npm run launch:evidence:template -- --gate <gate-name> --type <required-type>`, complete it, then validate it with `npm run launch:evidence:artifact:verify -- --file <path> --gate <gate-name> --type <required-type>`.
4. Repository evidence must include its lowercase SHA-256 digest in the registry. Generate it with `shasum -a 256 <path>` after the artifact is final.
5. Use only the evidence types declared in each gate's `required_evidence_types` list.
6. A gate is confirmed only by its named accountable owner. Record the approver's name, role, and timezone-qualified approval timestamp.
7. Do not copy a generic approval across gates. The acceptance criterion in each registry entry must be satisfied by the referenced evidence.
8. For access-controlled HTTPS evidence, record the named verifier, verifier role and timezone-qualified verification time in the registry evidence entry.
9. Re-run `npm run launch:evidence:verify` after every evidence edit. Run the strict command only when all owners believe the release is ready.

## Current safe release state

- The Cloudflare Worker is publicly reachable at `https://med250.gikundiro.com`; the seven representative routes pass live deployment verification.
- The public catalogue and availability-request workflow are active. The protected release evidence gate remains incomplete and must not be represented as formally approved.
- Public DNS resolves through Cloudflare. The active verification plan is `docs/launch/dns/med250-cloudflare-domain-plan.json`.
- Wrangler is authenticated to the intended deployment account, but the current OAuth session has broad account-wide write scopes. The infrastructure owner must replace it with a narrowly scoped deploy credential before confirming least privilege.
- Privileged Supabase verification is available through the protected connector and the live backend contract passes.
- Supabase server-side Turnstile validation is enabled with the production widget. Missing and invalid tokens are rejected without creating users; one controlled valid-token browser test remains before the security owner can sign the gate.
- All 51 duplicate-register groups remain pending named human review.

## Gate closure matrix

| Gate | Accountable owner | Required evidence | Closure procedure |
| --- | --- | --- | --- |
| `MED250_GATE_GPS_READY` | Operations | Operations snapshot + review ledger | Generate candidates, inspect each premises, approve only authoritative coordinates, then run strict operational health. Current aggregate snapshot: 93 GPS-ready and 300 dispatch-ready pharmacies out of 769 active records; the governed review ledger still requires owner completion. |
| `MED250_GATE_WHATSAPP_READY` | Operations | Operations snapshot + review ledger | Directly verify an authorised business WhatsApp identity for every production pharmacy and re-run strict operational health. Current aggregate snapshot: 338 login-enabled WhatsApp contacts and 300 pharmacies with WhatsApp coverage; the governed review ledger still requires owner completion. |
| `MED250_GATE_PHARMACY_OPERATIONS_APPROVED` | Operations lead | Signed approval | Approve dispatch, response, selection, escalation, expiry, cancellation, prescription, incident and off-platform-payment procedures for named operating staff. |
| `MED250_GATE_REGULATORY_APPROVED` | Legal/compliance | Signed approval | Approve the exact Rwanda marketplace model and record applicable Rwanda FDA, RICA, health-sector and pharmaceutical-advertising conditions. |
| `MED250_GATE_DATA_REUSE_APPROVED` | Data owner | Signed approval + review ledger | Approve reuse/publication of every product, pharmacy and contact source; attach provenance and licence/permission decisions. |
| `MED250_GATE_DUPLICATE_REGISTER_REVIEWED` | Regulatory data reviewer | Review ledger | Run `npm run data:duplicates:packet` to generate a source-comparison packet, then decide all 51 synchronized groups in `data/imports/duplicate-register-review.csv` with reviewer, timestamp and rationale; `npm run data:duplicates:verify -- --strict` must pass. The packet deliberately contains no decision or recommendation. |
| `MED250_GATE_CREDENTIALS_ROTATED` | Security owner | Deployment receipt + signed approval | Revoke and replace the previously exposed Supabase service, database and personal credentials; retain only a redacted rotation receipt. |
| `MED250_GATE_SECURITY_HARDENING_DEPLOYED` | Backend owner | Deployment receipt + test record | Apply the security migrations with rotated credentials, then run `npm run backend:verify`; contract `2026-07-16.7` and all invariants must pass. |
| `MED250_GATE_EDGE_FUNCTIONS_DEPLOYED` | Backend owner | Deployment receipt + test record | Deploy reviewed OTP, cleanup, geocoding and contact-review functions and execute protected-origin/least-privilege probes. |
| `MED250_GATE_TURNSTILE_SERVER_VERIFIED` | Security owner | Test record | Supabase Auth Turnstile validation is configured and missing/invalid-token rejection is proven. In a controlled browser, complete the real production widget, create only an anonymous auth identity without sending an availability request, delete that test identity, and record the redacted positive-path result. |
| `MED250_GATE_AUTH_RATE_LIMITS_APPROVED` | Security owner | Signed approval + test record | Review project-wide anonymous-auth impact, approve limits, and test intended customer access plus abuse rejection. |
| `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED` | Privacy owner | Signed approval + test record | Approve the 24-hour and 30-day rules, configure the protected cleanup schedule, execute a controlled run, and obtain a healthy non-stale aggregate signal. |
| `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED` | Infrastructure owner | Account verification + signed approval | The intended account and production Worker are visible, but the current OAuth credential is broader than least privilege. Create a deploy credential limited to the MED+250 Worker, its route, required asset capability and read-only zone inspection; replace the local/CI credential, verify deployment, then sign the redacted account record. |
| `MED250_GATE_DOMAIN_DNS_VERIFIED` | Infrastructure owner | Domain verification + test record | Run `npm run domain:dns:verify` against `docs/launch/dns/med250-cloudflare-domain-plan.json`, then run live deployment verification against `https://med250.gikundiro.com`. Confirm DNS, TLS, routing, headers, robots and sitemap before the infrastructure owner signs the gate. |
| `MED250_GATE_PHYSICAL_UAT_PASSED` | QA owner | Signed approval + test record | Complete all 12 scenarios in `data/physical-device-uat.json` with opaque identity labels, redacted evidence and named approval. `npm run uat:verify:live` must pass and no unintended pharmacy may receive a message or prescription. |

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
3. `npm run data:duplicates:verify -- --strict`
4. `npm run uat:verify:live`
5. `npm run backend:verify`
6. `npm run ops:health:strict`
7. `npm run release:check:live`
8. Approve the protected `med250-production` GitHub environment and dispatch the manual workflow with the exact live confirmation phrase.
9. `npm run deployment:verify -- --url https://med250.gikundiro.com --mode live`

### Routing-owner safety rule

`med250.gikundiro.com` is owned by the direct Cloudflare Worker route declared in `wrangler.jsonc`. Do not attach the same hostname to a Sites project or another Worker. The retired `med250.rw` Sites plan is retained only as historical evidence and is not part of the active production verification path.

If any command fails, keep public ordering and indexing disabled and return the responsible gate to `pending` or `rejected` until new evidence exists.
