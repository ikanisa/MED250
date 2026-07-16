# Attack-path analysis: MED250-DEPLOY-001

## Finding

**Deployment verifier can perform SSRF from CI/operator network**

- Candidate: MED250-DEPLOY-001
- Instance key: deployment-verifier-ssrf:verify-deployed-site:115
- Discovery control: Only literal localhost and initial HTTPS checks
- Discovery sink: Redirect-following fetches and full body reads

## Attack path

1. The verifier can request private URLs, but all supported URL sources are protected operator values or trusted deployment outputs, so no lower-privileged source reaches it.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **CI/operator network**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** No attacker-reachable supported entry point was established.
- **Identity and privileges:** Source is Operator/workflow --url; the sink is Redirect-following fetches and full body reads.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** none
- **Preconditions:** Operator/workflow --url
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-918
- **Mitigations already present:** Only literal localhost and initial HTTPS checks
- **Auth scope:** none
- **Impact surface:** CI/operator network
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** No untrusted repository-supported URL source is reachable.
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
