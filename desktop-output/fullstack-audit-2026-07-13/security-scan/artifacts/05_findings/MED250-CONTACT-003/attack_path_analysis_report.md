# Attack-path analysis: MED250-CONTACT-003

## Finding

**Roster extractor relabels arbitrary local PDFs as official login-contact evidence**

- Candidate: MED250-CONTACT-003
- Instance key: roster-source-provenance:extract-rosters:216
- Discovery control: Name/district/phone matching only
- Discovery sink: Hard-coded official URL/reference emitted

## Attack path

1. An arbitrary local PDF is processed as an official roster
2. generated evidence is labelled official without an origin digest; the resulting contacts can become OTP-authoritative.
3. The resulting impact surface is **pharmacy authentication authority**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Caller-controlled local roster PDFs; the sink is Hard-coded official URL/reference emitted.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Caller-controlled local roster PDFs
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-345
- **Mitigations already present:** Name/district/phone matching only
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy authentication authority
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** No origin or digest validation distinguishes the official roster.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **high**
- Likelihood: **medium**
- Final severity: **medium**
- Priority: **P2**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
