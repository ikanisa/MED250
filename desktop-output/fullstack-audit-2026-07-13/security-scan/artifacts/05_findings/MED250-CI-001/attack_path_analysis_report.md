# Attack-path analysis: MED250-CI-001

## Finding

**Supabase elevated key is exposed to the entire production job**

- Candidate: MED250-CI-001
- Instance key: ci-secret-scope:deploy-cloudflare:81
- Discovery control: Job-level env
- Discovery sink: Checkout/setup/npm ci/build/actions/verify all inherit secret

## Attack path

1. A compromised dependency, build tool, or earlier job step reads the job-scoped elevated Supabase secret before the narrowly necessary production step and uses it against the project.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **production control-plane secrets**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is GitHub production secret; the sink is Checkout/setup/npm ci/build/actions/verify all inherit secret.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** GitHub production secret
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-522
- **Mitigations already present:** Job-level env
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** production control-plane secrets
- **Target reach:** production workflow/project
- **Secrets references:** Supabase/Cloudflare production credentials are present in the workflow.
- **Counterevidence:** A compromise in any earlier step can read the production credential.
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
