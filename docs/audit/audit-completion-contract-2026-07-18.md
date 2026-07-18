# Audit completion contract

Date: 2026-07-18  
Audit source revision: `ALtnJHwQWBgt5JycfaOGftvKWVHBOLMKzbI9tuf-JrxPmecFrmDaMt1VqSxxxAxyOZIqpkTkcapZA8VcxqQNLq9OMDzTgjApfiO0tloLkak`

The implementation register now has a valid terminal path. An item may move to `complete` only when every acceptance condition or strategic entry criterion is covered by durable evidence and a named accountable approval. A status edit, source file, test name, screenshot, or unverified link is not enough.

## Terminal states

- `complete`: every criterion is covered by source-revision-bound evidence and named approval.
- `owner_declined`: the accountable owner made a dated decision with a rationale. This is terminal for the rejected item but does not claim implementation.
- `partial` and `external_gate`: open states. They must retain concrete remaining work and cannot carry completion approval metadata.

## Completion object

A completed finding or strategic item adds:

```json
{
  "status": "complete",
  "remaining": [],
  "closure": {
    "audit_source_revision": "CURRENT_AUDIT_REVISION",
    "approved_by": "Named accountable person",
    "approved_role": "Accountable role",
    "approved_at": "2026-07-18T10:30:00+02:00",
    "evidence": [
      {
        "reference": "docs/audit/closure-evidence/ITEM-evidence.json",
        "sha256": "64-lowercase-hex-characters",
        "recorded_at": "2026-07-18T10:00:00+02:00",
        "summary": "What the evidence proves and the governed state it covers.",
        "covers": [0, 1]
      }
    ]
  }
}
```

`covers` uses zero-based indexes into the finding's `acceptance` array or the strategic item's `entry_criteria` array. Every index must be covered at least once. Evidence must predate or match the approval.

## Local evidence artifact

Repository evidence must be a non-symlink JSON file under `docs/audit/closure-evidence/`, and its SHA-256 digest must match the register:

```json
{
  "schema_version": "1",
  "audit_source_revision": "CURRENT_AUDIT_REVISION",
  "item_id": "P0-1",
  "status": "passed",
  "evidence_type": "browser_test",
  "recorded_at": "2026-07-18T10:00:00+02:00",
  "summary": "The controlled evidence passed the stated acceptance boundary.",
  "errors": [],
  "contains_personal_data": false,
  "contains_secrets": false
}
```

Allowed evidence types are `browser_test`, `data_review`, `deployment_receipt`, `device_test`, `operations_observation`, `owner_decision`, `regulatory_approval`, `rights_approval`, `search_console`, `service_receipt`, and `translation_approval`.

An HTTPS evidence reference may replace a local artifact only when it records a named verifier, verifier role, and timezone-qualified verification timestamp. URLs containing credentials are rejected. Summaries and local artifacts are rejected if they contain secret-like material, customer contact details, one-time codes, request identifiers, prescription contents, or precise coordinates.

## Verification

```sh
npm run audit:closure:status
npm run audit:goals:verify
npm run audit:goals:verify:strict
npm run audit:closure:verify
```

The status command reconciles the implementation register with browser, launch, physical-device, localization, and product-content evidence and prints accountable-owner queues. The non-strict goals command validates the truthful open register. The strict goals command requires all 17 findings and all three strategic decisions to be terminal. The final command requires the unified report to be strictly ready, including every protected production launch gate.

Current result: the non-strict register passes with nine partial findings, seven external gates, and one owner-declined finding. Strict closure remains intentionally closed. No item was promoted while this contract was added.
