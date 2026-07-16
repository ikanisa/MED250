# Attack-path analysis: MED250-CI-002

## Finding

**Deployment actions use mutable major-version refs**

- Candidate: MED250-CI-002
- Instance key: ci-action-ref:deploy-cloudflare:52
- Discovery control: Official action provenance only
- Discovery sink: Actions receive Cloudflare and job-level Supabase credentials

## Attack path

1. A mutable action tag is changed upstream
2. the workflow resolves the changed code while production credentials are present; malicious action code can exfiltrate secrets or alter deployment.
3. The resulting impact surface is **production deployment and secrets**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Mutable GitHub Action tags; the sink is Actions receive Cloudflare and job-level Supabase credentials.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Mutable GitHub Action tags
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-829
- **Mitigations already present:** Official action provenance only
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** production deployment and secrets
- **Target reach:** production workflow/project
- **Secrets references:** Supabase/Cloudflare production credentials are present in the workflow.
- **Counterevidence:** The supply-chain boundary is not pinned to reviewed commits.
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
