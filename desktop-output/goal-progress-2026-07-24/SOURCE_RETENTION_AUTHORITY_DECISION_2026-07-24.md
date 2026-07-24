# MED+250 Source-Retention Authority Decision

- Classification: accountable-owner decision workbook; not approval or source evidence
- Application release candidate: `8ca3f6dc79f57f89c7e3d4b221a357b4fba7c49f`
- Decision owner: named MED+250 data owner
- Required role: data owner with authority over catalogue provenance, retention, and reuse

The signed outcome must be recorded in
`data/source-authority-decision.json` with
`npm run data:source-authority:record`. This workbook is the human decision
aid; the JSON record and strict verifier are the production release control.

## Facts the owner is being asked to decide

The original private bundle `med250-source-retention-2026-07-16` was previously
verified as a 25-artifact, 25,220,675-byte bundle with:

- aggregate bundle SHA-256
  `c96bd6445e983398cceb92de4328aa59fa5a1c043107e524124b99e610f12057`;
- manifest SHA-256
  `181bca849b252f0acd3000e066247cb5e04c934b815d5f8fe83c4732f63d428e`;
- source-spec SHA-256
  `da70f8b651d3ed1d137adc9a95dcfd155f6d0029b6b76608a2f39331b3d2871`;
  and
- `approved_durable_storage: false`.

The current workspace does not contain that original bundle manifest or its
private source bytes. The technical receipt is evidence that the bundle once
verified; it is not the bundle and cannot prove current durable retention.

A public-data reconstruction is available:

- artifact:
  `outputs/recovered-evidence/med250-marketplace-public-recovery-2026-07-23/recovered-public-marketplace-catalogue.json`;
- SHA-256:
  `5cad7067c8d904454f66f7e8a2d7bc276d72ac645bc2acdb30fc8a52642a6395`;
- 2,200 consumer identities, including 2,198 public rows and two governed
  exclusions;
- 2,480 Rwanda FDA medicine rows;
- 4,680 total pipeline identities; and
- 128 Rwanda-observed price rows.

The reconstruction is explicitly
`recovery_manifest_not_source_retention_approval`. It does not recover the
original corrected private dataset whose recorded SHA-256 is
`5000580eb85403a58de8e604bdd055b25b22958ae5755206913a070bcae31383`.

## Decision

Select exactly one option.

### Option A — restore the original controlled bundle

- [ ] I will supply the unchanged original bundle through an approved private
      storage channel.
- [ ] I authorize the release verifier to compare every retained byte,
      manifest entry, and aggregate digest with the committed retention spec.
- [ ] I will approve or reject the durable storage location only after
      `npm run data:source-retention:verify` passes.

Private handoff reference, without credentials or personal data:

`________________________________________________________________________`

### Option B — authorize a reconstructed operational baseline

- [ ] I confirm the original bundle could not be recovered after the recorded
      search and custody review.
- [ ] I authorize the public reconstruction only as a new governed operational
      baseline, never as the original source or proof of original retention.
- [ ] I accept that missing private research fields, raw observations, workbook
      history, reuse-rights evidence, and the original SHA-256 remain
      unavailable.
- [ ] I define the exact permitted fields, uses, retention location, correction
      process, and future provenance rules below.
- [ ] I require a new manifest and SHA-256 receipt for the replacement.
- [ ] I understand that this decision does not approve the 51 duplicate or 72
      product-content decisions.

Permitted fields and uses:

`________________________________________________________________________`

Prohibited fields and uses:

`________________________________________________________________________`

Approved durable storage location label, without credentials:

`________________________________________________________________________`

Retention period and review date:

`________________________________________________________________________`

### Option C — reject both

- [ ] I reject the current evidence for production use. Production remains
      closed until a new source authority is approved.

## Accountable decision record

- Decision selected: `A / B / C`
- Decision rationale: `______________________________________________________`
- Approved or rejected by: `_________________________________________________`
- Role: `___________________________________________________________________`
- Decision timestamp with timezone: `________________________________________`
- Next review timestamp with timezone: `_____________________________________`
- Authoritative evidence reference: `________________________________________`

Do not commit credentials, phone numbers, customer information, prescription
contents, precise customer coordinates, or unredacted private source data.
