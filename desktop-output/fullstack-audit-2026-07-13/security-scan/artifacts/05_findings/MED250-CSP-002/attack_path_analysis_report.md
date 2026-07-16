# Attack-path analysis: MED250-CSP-002

## Finding

**CSP allows connections to every Supabase project**

- Candidate: MED250-CSP-002
- Instance key: csp:supabase-wildcard:worker:25
- Discovery control: Wildcard connect-src
- Discovery sink: Attacker-owned Supabase is allowed exfiltration target

## Attack path

1. Broad Supabase connectivity may amplify same-origin compromise but has no independent attacker source and concrete impact.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **browser network defense in depth**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Injected/compromised browser script; the sink is Attacker-owned Supabase is allowed exfiltration target.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** remote
- **Preconditions:** Injected/compromised browser script
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-942
- **Mitigations already present:** Wildcard connect-src
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** browser network defense in depth
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Track as hardening rather than a standalone finding.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **low**
- Likelihood: **high**
- Final severity: **not reportable**
- Priority: **none**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**ignore** — the item is suppressed from the final vulnerability list, but remains recorded in coverage and validation artifacts.
