# Attack-path analysis: MED250-SEARCH-001

## Finding

**Anonymous server catalogue search performs full aggregate/ranking work**

- Candidate: MED250-SEARCH-001
- Instance key: catalogue-query-cost:server-search:131
- Discovery control: Input/output bounds
- Discovery sink: Full product/price aggregate, scoring, count and sort precede pagination

## Attack path

1. Anonymous full ranking is reachable, but measured work at the current 2,459-row scale is about 43–59 ms and does not yet establish material service degradation.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **catalogue availability**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Repeated anonymous fuzzy search; the sink is Full product/price aggregate, scoring, count and sort precede pagination.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** remote
- **Preconditions:** Repeated anonymous fuzzy search
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-400
- **Mitigations already present:** Input/output bounds
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** catalogue availability
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** No repository rate limit or precomputed search index bounds repeated work.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** medium

## Severity calibration

- Impact: **low**
- Likelihood: **high**
- Final severity: **not reportable**
- Priority: **none**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**ignore** — the item is suppressed from the final vulnerability list, but remains recorded in coverage and validation artifacts.
