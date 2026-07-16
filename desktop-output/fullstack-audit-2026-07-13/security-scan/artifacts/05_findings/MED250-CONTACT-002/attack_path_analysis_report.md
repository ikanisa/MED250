# Attack-path analysis: MED250-CONTACT-002

## Finding

**Contact SQL import can directly grant OTP authority from unbound CSV provenance**

- Candidate: MED250-CONTACT-002
- Instance key: contact-import-auth-promotion:emit-contact-sql:79
- Discovery control: Regex and caller-supplied official URL prefix
- Discovery sink: Rows become source_verified and login_enabled

## Attack path

1. An external contact file is substituted or selected
2. syntactic parsing generates privileged import SQL without authenticated source provenance; imported numbers become OTP-authoritative.
3. The resulting impact surface is **pharmacy authentication authority**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Operator-selected matched-contact CSV; the sink is Rows become source_verified and login_enabled.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Operator-selected matched-contact CSV
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-345
- **Mitigations already present:** Regex and caller-supplied official URL prefix
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy authentication authority
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** No authenticated provenance or expected source digest binds the input.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **high**
- Likelihood: **medium**
- Final severity: **medium**
- Priority: **P2**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
