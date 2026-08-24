# Attack-path analysis: MED250-CONTACT-004

## Finding

**Contact import resurrects rejected or stale login contacts**

- Candidate: MED250-CONTACT-004
- Instance key: contact-import-resurrection:emit-contact-sql:88
- Discovery control: Unique conflict key only
- Discovery sink: ON CONFLICT forces source_verified/login_enabled

## Attack path

1. A stale or rejected number appears again in an import
2. conflict handling restores verified/login-enabled state; the number can authenticate again.
3. The resulting impact surface is **pharmacy authentication authority**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Matching CSV row; the sink is ON CONFLICT forces source_verified/login_enabled.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Matching CSV row
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-285/CWE-345
- **Mitigations already present:** Unique conflict key only
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy authentication authority
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The import is not monotonic with review state.
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
