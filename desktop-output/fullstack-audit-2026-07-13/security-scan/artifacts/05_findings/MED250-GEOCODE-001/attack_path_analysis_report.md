# Attack-path analysis: MED250-GEOCODE-001

## Finding

**Verified pharmacy coordinates are not bound to reviewed coordinates**

- Candidate: MED250-GEOCODE-001
- Instance key: verified-location:geocode-governance:27
- Discovery control: Review evidence binds Place ID only
- Discovery sink: Location can change while row remains verified

## Attack path

1. The supported approval function refuses verified-coordinate overwrite
2. only an already-privileged direct write reaches the claimed sink.
3. The resulting impact surface is **routing integrity**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** No attacker-reachable supported entry point was established.
- **Identity and privileges:** Source is Privileged later location update; the sink is Location can change while row remains verified.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** none
- **Preconditions:** Privileged later location update
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-345
- **Mitigations already present:** Review evidence binds Place ID only
- **Auth scope:** none
- **Impact surface:** routing integrity
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** No repository-supported untrusted source reaches the claimed state change.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **low**
- Final severity: **not reportable**
- Priority: **none**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**ignore** — the item is suppressed from the final vulnerability list, but remains recorded in coverage and validation artifacts.
