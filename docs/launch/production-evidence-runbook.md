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

- The private owner-only Sites preview is deployed at `https://med250-rwanda.ikanisa.chatgpt.site` and its seven representative routes pass the authenticated preview verifier.
- Public ordering and indexing remain disabled.
- `med250.rw` and `www.med250.rw` are attached to the owner-only Sites project, but remain pending because the zone has none of the provider-issued routing or validation records. The exact pending plan is `docs/launch/dns/med250-sites-domain-plan.json`.
- Wrangler is not authenticated on the audit machine.
- The local environment contains only the public Supabase URL and publishable key; privileged backend verification cannot run here.
- All 51 duplicate-register groups remain pending named human review.

## Gate closure matrix

| Gate | Accountable owner | Required evidence | Closure procedure |
| --- | --- | --- | --- |
| `MED250_GATE_GPS_READY` | Operations | Operations snapshot + review ledger | Generate candidates, inspect each premises, approve only authoritative coordinates, then run strict operational health. Current gap: 0/769 approved. |
| `MED250_GATE_WHATSAPP_READY` | Operations | Operations snapshot + review ledger | Directly verify an authorised business WhatsApp identity for every production pharmacy and re-run strict operational health. Current coverage: 267/769 pharmacies. |
| `MED250_GATE_PHARMACY_OPERATIONS_APPROVED` | Operations lead | Signed approval | Approve dispatch, response, selection, escalation, expiry, cancellation, prescription, incident and off-platform-payment procedures for named operating staff. |
| `MED250_GATE_REGULATORY_APPROVED` | Legal/compliance | Signed approval | Approve the exact Rwanda marketplace model and record applicable Rwanda FDA, RICA, health-sector and pharmaceutical-advertising conditions. |
| `MED250_GATE_DATA_REUSE_APPROVED` | Data owner | Signed approval + review ledger | Approve reuse/publication of every product, pharmacy and contact source; attach provenance and licence/permission decisions. |
| `MED250_GATE_DUPLICATE_REGISTER_REVIEWED` | Regulatory data reviewer | Review ledger | Run `npm run data:duplicates:packet` to generate a source-comparison packet, then decide all 51 synchronized groups in `data/imports/duplicate-register-review.csv` with reviewer, timestamp and rationale; `npm run data:duplicates:verify -- --strict` must pass. The packet deliberately contains no decision or recommendation. |
| `MED250_GATE_CREDENTIALS_ROTATED` | Security owner | Deployment receipt + signed approval | Revoke and replace the previously exposed Supabase service, database and personal credentials; retain only a redacted rotation receipt. |
| `MED250_GATE_SECURITY_HARDENING_DEPLOYED` | Backend owner | Deployment receipt + test record | Apply the two 2026-07-14 security migrations with rotated credentials, then run `npm run backend:verify`; contract `2026-07-14.1` and all invariants must pass. |
| `MED250_GATE_EDGE_FUNCTIONS_DEPLOYED` | Backend owner | Deployment receipt + test record | Deploy reviewed OTP, cleanup, geocoding and contact-review functions and execute protected-origin/least-privilege probes. |
| `MED250_GATE_TURNSTILE_SERVER_VERIFIED` | Security owner | Test record | Configure Supabase Auth Turnstile validation and prove missing/invalid tokens cannot create anonymous customer identities while valid controlled tokens can. |
| `MED250_GATE_AUTH_RATE_LIMITS_APPROVED` | Security owner | Signed approval + test record | Review project-wide anonymous-auth impact, approve limits, and test intended customer access plus abuse rejection. |
| `MED250_GATE_PRESCRIPTION_RETENTION_APPROVED` | Privacy owner | Signed approval + test record | Approve the 24-hour and 30-day rules, configure the protected cleanup schedule, execute a controlled run, and obtain a healthy non-stale aggregate signal. |
| `MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED` | Infrastructure owner | Account verification + signed approval | Verify the intended account and zone, least-privilege deploy token, Worker names and protected GitHub environments without recording token values. |
| `MED250_GATE_DOMAIN_DNS_VERIFIED` | Infrastructure owner | Domain verification + test record | Choose Sites or direct Wrangler as the sole routing owner. The hostnames are currently attached to owner-only Sites. Apply the provider-issued records in `docs/launch/dns/med250-sites-domain-plan.json`, run `npm run domain:dns:verify`, refresh Sites until provider/TLS status is active, then run authenticated preview verification against both hostnames. Live-mode verification remains a separate final-launch step. |
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
9. `npm run deployment:verify -- --url https://med250.rw --mode live`

### Routing-owner safety rule

The same hostname must not be owned simultaneously by a Sites custom-domain binding and the direct `wrangler.jsonc` production Worker routes. The current safe state assigns both hostnames to the owner-only Sites project while DNS is absent. Before public launch, the infrastructure owner must make and evidence one choice:

- **Sites:** keep the Sites bindings, validate the provider-issued DNS records, preserve owner-only access until all gates pass, then make the approved live release through Sites.
- **Direct Worker:** remove both Sites custom-domain bindings first, authenticate the intended Cloudflare account, then use the protected `med250-production` workflow and direct Worker routes.

Do not install DNS or run a direct production deployment until that routing-owner decision is recorded.

If any command fails, keep public ordering and indexing disabled and return the responsible gate to `pending` or `rejected` until new evidence exists.
