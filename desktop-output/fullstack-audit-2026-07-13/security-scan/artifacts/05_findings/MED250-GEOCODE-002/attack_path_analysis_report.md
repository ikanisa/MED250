# Attack-path analysis: MED250-GEOCODE-002

## Finding

**Geocode approval has a candidate-snapshot race**

- Candidate: MED250-GEOCODE-002
- Instance key: candidate-approval:geocode-function:114
- Discovery control: Approval rereads only status and Place ID
- Discovery sink: Coordinates/confidence/version are not in update predicate

## Attack path

1. A candidate value changes between review and approval while retaining the Place ID
2. approval checks only status and Place ID; unreviewed coordinates become verified and influence dispatch distance.
3. The resulting impact surface is **routing integrity**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Concurrent candidate update; the sink is Coordinates/confidence/version are not in update predicate.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Concurrent candidate update
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-367
- **Mitigations already present:** Approval rereads only status and Place ID
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** routing integrity
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The approval transition is not atomic with the reviewed values.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **medium**
- Final severity: **low**
- Priority: **P3**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
