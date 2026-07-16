# Attack-path analysis: MED250-ADMIN-001

## Finding

**Shared admin token allows forged reviewer identity labels**

- Candidate: MED250-ADMIN-001
- Instance key: reviewer-attribution:admin-functions:99
- Discovery control: Shared-secret authentication
- Discovery sink: reviewed_by comes from request body

## Attack path

1. A valid shared-token holder can change the reviewer label, but already possesses the same approval authority and gains no privilege or access delta.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **audit attribution**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Protected administrative workflow.
- **Identity and privileges:** Source is Holder of shared admin token; the sink is reviewed_by comes from request body.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** admin-only
- **Preconditions:** Holder of shared admin token
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-345
- **Mitigations already present:** Shared-secret authentication
- **Auth scope:** admin-only
- **Impact surface:** audit attribution
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The caller does not gain extra approval power, but audit attribution can be forged.
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
