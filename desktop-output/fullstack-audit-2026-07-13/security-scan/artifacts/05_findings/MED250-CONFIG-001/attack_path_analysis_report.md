# Attack-path analysis: MED250-CONFIG-001

## Finding

**Local and production Worker compatibility flags can drift**

- Candidate: MED250-CONFIG-001
- Instance key: worker-node-compat:vite-vs-wrangler
- Discovery control: Vite enables nodejs_compat
- Discovery sink: Canonical Wrangler omits flag

## Attack path

1. Generated production configuration and dry-run both contain nodejs_compat, defeating the claimed mismatch.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **runtime configuration**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** No attacker-reachable supported entry point was established.
- **Identity and privileges:** Source is Node-dependent server path; the sink is Canonical Wrangler omits flag.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** none
- **Preconditions:** Node-dependent server path
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-16
- **Mitigations already present:** Vite enables nodejs_compat
- **Auth scope:** none
- **Impact surface:** runtime configuration
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The alleged production mismatch is defeated by current build evidence.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** medium

## Severity calibration

- Impact: **ignore**
- Likelihood: **ignore**
- Final severity: **not reportable**
- Priority: **none**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**ignore** — the item is suppressed from the final vulnerability list, but remains recorded in coverage and validation artifacts.
