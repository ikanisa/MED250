# Browser evidence closure

Date: 2026-07-18  
State: controlled production run complete — 16 of 16 scenarios passed; independent approval pending
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

The passing deployment and catalogue receipts are bound to production Git revision `5ef50a296941056bd17e614dff7b35290742f50a`. All 16 desktop/mobile scenarios now pass with 56 immutable PNG digests, exact production routes and governed viewport metadata. The ledger is intentionally `pending` with `execution_status: completed_awaiting_approval`; no approver name, role, timestamp, or overall pass has been invented.

## Controlled execution

1. Deploy through the protected production workflow and retain a passing deployment receipt bound to the exact lowercase 40-character Git revision.
2. Run the live catalogue verifier against that same release and retain a passing receipt proving exactly 4,657 governed products, all three catalogue boundaries, and all six search cases.
3. Within 24 hours of those receipts, execute every ledger scenario on the production custom domain at a governed desktop or mobile viewport.
4. Store PNG evidence only under `docs/audit/browser-evidence/`. Record each file's repository-relative path and SHA-256 digest.
5. Use meaningful acceptance notes, then record the named executor, capture window, named QA approver, role, and approval time.
6. Set each scenario to `passed` only after every expected capture passes. Keep the overall ledger `pending` until an independent QA owner reviews the run and supplies a real name, role, and approval timestamp.

Screenshots and notes must not retain customer names, phone numbers, coordinates, prescription contents, request identifiers, one-time codes, credentials, response bodies, or secrets. Redact those values before capture and keep the ledger flags fail-closed. Do not use synthetic screenshots or infer an approval.

## Verification

```sh
npm run audit:browser-evidence:verify
npm run audit:browser-evidence:verify:live
npm run audit:closure:verify
```

The first command validates the completed controlled run and its pending-approval state. The strict commands require every receipt, capture, hash, release binding, privacy declaration, and independent approval.

The production browser run is fully executed and the ledger remains pending overall. Passing scenario screenshots are stored under `docs/audit/browser-evidence/`, but no audit finding is closed by this document alone; independent QA approval is still required.
