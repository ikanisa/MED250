# Attack-path analysis: MED250-DB-002

## Finding

**Disabled requested product can still be confirmed**

- Candidate: MED250-DB-002
- Instance key: regulatory-state-submit:marketplace.sql:1511
- Discovery control: Order creation checked prior state
- Discovery sink: Submission omits current active/orderable check for requested product

## Attack path

1. A legitimate routed pharmacy confirms the exact requested item after it is disabled
2. the submission path omits the current-state predicate and persists the response.
3. The resulting impact surface is **regulated product integrity**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Legitimate routed pharmacy submits response; the sink is Submission omits current active/orderable check for requested product.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Legitimate routed pharmacy submits response
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-367/CWE-20
- **Mitigations already present:** Order creation checked prior state
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** regulated product integrity
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Creation-time validation does not cover later product withdrawal.
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
