# Scan-level attack-path analysis

All 31 validated candidates received an explicit attack-path decision. Related candidates may be consolidated into one final finding, but every raw candidate remains traceable through its own ledger.

| Candidate | Decision | Severity | Impact surface |
| --- | --- | --- | --- |
| MED250-AUTH-001 | report | high | pharmacy identity and data |
| MED250-AUTH-002 | report | high | pharmacy identity and data |
| MED250-OTP-001 | report | medium | availability and messaging cost |
| MED250-OTP-002 | report | medium | availability and messaging cost |
| MED250-DB-001 | report | medium | customer and pharmacy response privacy |
| MED250-DB-002 | report | medium | regulated product integrity |
| MED250-DB-003 | report | medium | regulated product integrity |
| MED250-DB-004 | report | medium | customer health and payment contact confidentiality |
| MED250-DB-005 | report | medium | pharmacy notification availability |
| MED250-UPLOAD-001 | ignore | — | prescription storage |
| MED250-TELEMETRY-001 | report | medium | runtime availability |
| MED250-SEO-XSS-001 | report | medium | browser sessions and same-origin data |
| MED250-SEO-XSS-002 | report | medium | browser sessions and same-origin data |
| MED250-GEOCODE-001 | ignore | — | routing integrity |
| MED250-GEOCODE-002 | report | low | routing integrity |
| MED250-CONTACT-001 | report | low | pharmacy contact integrity |
| MED250-CONTACT-002 | report | medium | pharmacy authentication authority |
| MED250-CONTACT-003 | report | medium | pharmacy authentication authority |
| MED250-CONTACT-004 | report | medium | pharmacy authentication authority |
| MED250-DEPLOY-001 | ignore | — | CI/operator network |
| MED250-CI-001 | report | medium | production control-plane secrets |
| MED250-CI-002 | report | medium | production deployment and secrets |
| MED250-CLEANUP-001 | report | medium | prescription cleanup availability |
| MED250-SEARCH-001 | ignore | — | catalogue availability |
| MED250-SEARCH-002 | ignore | — | individual browser availability |
| MED250-ADMIN-001 | ignore | — | audit attribution |
| MED250-MIGRATION-001 | ignore | — | deployment reliability |
| MED250-CSP-001 | ignore | — | browser defense in depth |
| MED250-CSP-002 | ignore | — | browser network defense in depth |
| MED250-CONFIG-001 | ignore | — | runtime configuration |
| MED250-CONTRACT-001 | ignore | — | release assurance |
