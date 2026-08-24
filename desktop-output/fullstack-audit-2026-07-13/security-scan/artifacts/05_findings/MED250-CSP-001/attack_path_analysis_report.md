# Attack-path analysis: MED250-CSP-001

## Finding

**Global CSP permits all inline scripts**

- Candidate: MED250-CSP-001
- Instance key: csp:inline-script:worker:33
- Discovery control: script-src unsafe-inline
- Discovery sink: Injected script elements execute

## Attack path

1. Inline-script allowance amplifies the validated JSON-LD issue but is not an independent source-to-impact path.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **browser defense in depth**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Any HTML injection; the sink is Injected script elements execute.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** remote
- **Preconditions:** Any HTML injection
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-693
- **Mitigations already present:** script-src unsafe-inline
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** browser defense in depth
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Track as an amplifier in the stored-injection finding.
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
