# Browser evidence closure

Date: 2026-07-18  
State: pending controlled production run  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`

This runbook closes the shared browser-evidence gap for eight partial audit findings without weakening their underlying data, deployment, approval, or content gates. The committed ledger is [`data/audit-browser-evidence.json`](../../data/audit-browser-evidence.json); its validator is [`scripts/validate-audit-browser-evidence.mjs`](../../scripts/validate-audit-browser-evidence.mjs).

The plan contains 16 device-specific scenarios and 56 required captures:

| Evidence family | Findings | Desktop | Mobile | Total |
| --- | --- | ---: | ---: | ---: |
| Advertised departments | P0-1 | 4 | 4 | 8 |
| Catalogue boundaries | P0-2 | 3 | 3 | 6 |
| Failure and retry recovery | P0-2 | 3 | 3 | 6 |
| Availability-request journey | P0-5 | 4 | 4 | 8 |
| Related-product safety boundary | P1-2 | 3 | 3 | 6 |
| Six governed searches | P1-5 | 6 | 6 | 12 |
| Result-state restoration | P2-3 | 3 | 3 | 6 |
| Representative governed product content | P2-1, P2-5 | 2 | 2 | 4 |
| **Total** |  | **28** | **28** | **56** |

## Controlled execution

1. Deploy through the protected production workflow and retain a passing deployment receipt bound to the exact lowercase 40-character Git revision.
2. Run the live catalogue verifier against that same release and retain a passing receipt proving exactly 4,657 governed products, all three catalogue boundaries, and all six search cases.
3. Within 24 hours of those receipts, execute every ledger scenario on the production custom domain at a governed desktop or mobile viewport.
4. Store PNG evidence only under `docs/audit/browser-evidence/`. Record each file's repository-relative path and SHA-256 digest.
5. Use meaningful acceptance notes, then record the named executor, capture window, named QA approver, role, and approval time.
6. Set scenario and overall status to `passed` only after every expected capture passes.

Screenshots and notes must not retain customer names, phone numbers, coordinates, prescription contents, request identifiers, one-time codes, credentials, response bodies, or secrets. Redact those values before capture and keep the ledger flags fail-closed. Do not use synthetic screenshots or infer an approval.

## Verification

```sh
npm run audit:browser-evidence:verify
npm run audit:browser-evidence:verify:live
npm run audit:closure:verify
```

The first command validates the complete pending plan. The strict commands require every receipt, capture, hash, release binding, privacy declaration, and approval.

No production browser session was run while creating this contract. The ledger remains pending, no screenshot is committed, and no audit finding is closed by this document alone.
