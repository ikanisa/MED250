# Attack-path analysis: MED250-MIGRATION-001

## Finding

**Validated contact constraints can fail on legacy rows**

- Candidate: MED250-MIGRATION-001
- Instance key: migration-backfill:contact-governance:11
- Discovery control: Immediate validated constraints
- Discovery sink: No backfill before ALTER TABLE validation

## Attack path

1. A deployment can fail on incompatible legacy rows, but the path is operator-only, occurrence is unverified, and there is no lower-privileged attacker path.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **deployment reliability**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Protected administrative workflow.
- **Identity and privileges:** Source is Legacy admin_verified/null-target rows; the sink is No backfill before ALTER TABLE validation.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** admin-only
- **Preconditions:** Legacy admin_verified/null-target rows
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-754
- **Mitigations already present:** Immediate validated constraints
- **Auth scope:** admin-only
- **Impact surface:** deployment reliability
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Current affected-row counts are unavailable without elevated access; impact is conditional on legacy state.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **unknown**
- Final severity: **not reportable**
- Priority: **none**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**ignore** — the item is suppressed from the final vulnerability list, but remains recorded in coverage and validation artifacts.
