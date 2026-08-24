# Attack-path analysis: MED250-OTP-002

## Finding

**Caller-controlled User-Agent partitions OTP source limits**

- Candidate: MED250-OTP-002
- Instance key: rate-key:user-agent:auth-shared:149
- Discovery control: Source hash includes IP plus User-Agent
- Discovery sink: Different User-Agents create different source buckets

## Attack path

1. A bot varies User-Agent across public send requests
2. each value creates another source bucket; per-phone and global limits are the remaining bounds.
3. The resulting impact surface is **availability and messaging cost**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Public request User-Agent; the sink is Different User-Agents create different source buckets.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Public request User-Agent
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-799
- **Mitigations already present:** Source hash includes IP plus User-Agent
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** availability and messaging cost
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Per-phone and global limits bound but do not remove the bypass.
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
