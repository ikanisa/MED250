# Attack-path analysis: MED250-SEARCH-002

## Finding

**Offline catalogue fallback accepts unbounded query length**

- Candidate: MED250-SEARCH-002
- Instance key: algorithmic-complexity:catalogue-search:66
- Discovery control: Server path caps 160 chars only
- Discovery sink: Fallback allocates bigram sets across all products

## Attack path

1. A long search string makes the caller browser slow, but the demonstrated effect is self-only and does not cross a trust boundary.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **individual browser availability**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is URL or unrestricted search input; the sink is Fallback allocates bigram sets across all products.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** remote
- **Preconditions:** URL or unrestricted search input
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-400
- **Mitigations already present:** Server path caps 160 chars only
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** individual browser availability
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Normal 160-character search is fast, but no client or URL cap enforces it.
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
