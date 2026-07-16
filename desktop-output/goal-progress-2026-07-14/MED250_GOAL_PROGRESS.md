# MED+250 remaining-work goal — progress report

Date: 2026-07-14  
Preview: https://med250-rwanda.ikanisa.chatgpt.site  
Access: private, owner-only

## Outcome

The Amazon-aligned marketplace implementation is built, tested, and published as a controlled private preview. The release remains fail-closed for public ordering and search indexing until every production attestation is supported by durable evidence and named approval.

## Completed in this continuation

| Requirement | Evidence | Status |
| --- | --- | --- |
| Exact production-gate registry | `data/launch-evidence.json` contains all 15 gates | Complete |
| Fail-closed live gate | `npm run release:preflight:live` stops at the 15 pending attestations | Complete |
| Evidence integrity | `scripts/validate-launch-evidence.mjs` validates status, evidence, approver and timestamp rules | Complete |
| Accessibility contrast | Dark brand-ink action text plus automated endpoint contrast tests | Complete |
| Operational monitoring | Healthy, degraded and critical aggregate snapshots are directly tested | Complete |
| Private deployment verification | Protected header support in `scripts/verify-deployed-site.mjs` | Complete |
| Full automated verification | `npm test`: 115 tests passed, 0 failed | Complete |
| Cloudflare-compatible build | Vinext build and strict Wrangler dry-run pass | Complete |
| Private Sites preview | Exact hardened source deployed as version 8; seven routes verified with zero errors | Complete |
| Gate-specific evidence control | Schema v2 requires the correct evidence categories for each gate | Complete |
| Tamper-evident repository evidence | Local evidence must match its recorded SHA-256 digest | Complete |
| Approval accountability | Confirmed gates require approver name, role and timezone-qualified timestamp | Complete |
| Launch owner runbook | `docs/launch/production-evidence-runbook.md` maps all 15 gates to exact closure procedures | Complete |
| Live public privilege probe | Backend-contract and operational-health RPCs both deny the publishable role with HTTP 401 | Complete |
| Current infrastructure snapshot | `03-current-external-readiness.json` records owner-only Sites, preview mode, missing DNS and unauthenticated Wrangler | Complete |
| Custom-domain preparation | `med250.rw` and `www.med250.rw` attached to owner-only Sites; provider and SSL validation remain pending | Complete |
| Provider-issued DNS plan | `docs/launch/dns/med250-sites-domain-plan.json` records all six exact routing and validation records | Complete |
| DNS agreement verifier | `npm run domain:dns:verify` is case-correct and currently fails closed at 0/6 records | Complete |
| Duplicate-review decision support | `04-duplicate-review-packet.json` compares all 51 source groups without making recommendations | Complete |
| Physical-device UAT governance | `data/physical-device-uat.json` defines 12 required scenarios with strict privacy and approval validation | Complete |
| Evidence artifact integrity | Local evidence JSON is content-validated for gate, type, completion, roles, redaction, checks and type-specific fields | Complete |
| Remote evidence accountability | Protected HTTPS evidence requires a named verifier, role and timezone-qualified verification time | Complete |
| Evidence template workflow | Gate/type-specific templates and standalone artifact verification commands are implemented | Complete |

## Production gates still pending

The source of truth is `data/launch-evidence.json`. Its 15 entries remain pending, including authoritative pharmacy GPS approval, governed contact coverage, credential rotation evidence, backend deployment confirmation, duplicate-register decisions, legal/privacy approvals, protected Cloudflare production configuration, physical-device UAT, monitoring/cleanup configuration, production data checks, accessibility sign-off, custom-domain SEO verification and final release approval.

Current material operating-data gaps remain:

- Pharmacy GPS approvals: 0 of 769.
- Registered WhatsApp coverage: 267 of 769 pharmacies.
- Governed duplicate-register groups awaiting decisions: 51.
- Production Wrangler session, custom-domain DNS/routes and protected variables: not yet evidenced.
- The Sites project remains active at version 8, owner-only, and in preview mode. Both intended custom domains are attached but remain pending with zero of six DNS records visible and SSL still awaiting validation.
- The public Supabase settings endpoint does not expose enough information to prove Turnstile or anonymous-sign-in configuration. Both privileged aggregate RPCs correctly reject the publishable role.

The evidence registry is now schema v2. `npm run launch:evidence:status` prints the responsible owner, acceptance criterion, missing evidence categories and approval state for every gate. Repository evidence is hash-verified, and generic evidence cannot substitute for a gate's declared evidence types.

## Release state

- Software implementation: ready.
- Controlled private preview: deployed and verified.
- Exact current deployable source: published as owner-only Sites version 8.
- Public ordering: disabled.
- Search indexing: disabled.
- Production launch: hold until all 15 evidence gates are confirmed.

## Final blocked audit

After three consecutive goal turns, the same external conditions remain: 15/15 launch attestations pending, 51/51 duplicate groups pending, 12/12 physical-UAT scenarios pending, 0/6 DNS records visible, Sites TLS pending validation, Wrangler unauthenticated and no privileged Supabase, Cloudflare, geocoding or operations credentials available. The exact state is captured in `05-final-blocker-audit.json`.

All safe repository-side work found by the completion audits is implemented: source validation, gate-specific and type-specific evidence validation, tamper-evident local artifacts, protected remote-evidence verification metadata, owner runbooks, DNS plans/verifiers, duplicate decision support, privacy-safe UAT governance, release gates, production dry-run, private deployment and authenticated post-deployment verification.

The objective cannot be truthfully completed until accountable external owners perform the actions listed in the blocker audit. No code change can substitute for authoritative pharmacy coordinates/contact permission, credential rotation, production deployment receipts, legal/privacy/data approval, DNS ownership, or physical-device evidence.
