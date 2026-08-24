# Attack-path analysis: MED250-UPLOAD-001

## Finding

**Prescription upload trusts browser-declared MIME only**

- Candidate: MED250-UPLOAD-001
- Instance key: unrestricted-upload:dawanear-client.ts:664
- Discovery control: Size and File.type allowlist
- Discovery sink: Bytes uploaded and later signed to selected staff without signature/scanning

## Attack path

1. A mislabeled file can be uploaded, but the repository evidence does not establish stored active execution, cross-user disclosure, or another concrete security consequence.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **prescription storage**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** No meaningful lower-privileged cross-boundary impact survived final calibration.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Anonymous customer-selected bytes; the sink is Bytes uploaded and later signed to selected staff without signature/scanning.
- **Cross-boundary behavior:** Not established at a reportable level.
- **Vector:** remote
- **Preconditions:** Anonymous customer-selected bytes
- **Attacker input control:** No, self-only, or insufficient for a meaningful impact.
- **Category:** CWE-434
- **Mitigations already present:** Size and File.type allowlist
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** prescription storage
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The malformed upload path is confirmed, but a concrete execution or confidentiality impact is not established.
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
