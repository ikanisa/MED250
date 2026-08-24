# Attack-path analysis: MED250-DB-003

## Finding

**Product status is not revalidated at offer selection**

- Candidate: MED250-DB-003
- Instance key: regulatory-state-select:marketplace.sql:1791
- Discovery control: Submission-time validation
- Discovery sink: Selection never rechecks offered products

## Attack path

1. A customer selects a complete offer after an included product is disabled
2. selection revalidates the offer but not product state; the disabled fulfilment becomes selected.
3. The resulting impact surface is **regulated product integrity**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Owning customer selects submitted offer; the sink is Selection never rechecks offered products.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Owning customer selects submitted offer
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-367/CWE-20
- **Mitigations already present:** Submission-time validation
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** regulated product integrity
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** A withdrawn exact or substitute product can become selected.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **high**
- Final severity: **medium**
- Priority: **P2**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
