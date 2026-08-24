# Attack-path analysis: MED250-AUTH-002

## Finding

**Removing a login contact does not revoke existing pharmacy authorization**

- Candidate: MED250-AUTH-002
- Instance key: session-lifecycle:contact-review:89
- Discovery control: Contact is disabled but membership remains active
- Discovery sink: Pharmacy RPCs authorize active membership only

## Attack path

1. A staff member signs in before removal
2. the number is later removed; the persistent session and active membership remain valid; pharmacy RPCs continue authorizing access.
3. The resulting impact surface is **pharmacy identity and data**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Existing staff session before contact removal; the sink is Pharmacy RPCs authorize active membership only.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Existing staff session before contact removal
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-613
- **Mitigations already present:** Contact is disabled but membership remains active
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy identity and data
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Manual membership suspension remains a separate compensating control.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** medium

## Severity calibration

- Impact: **high**
- Likelihood: **high**
- Final severity: **high**
- Priority: **P1**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
