# Attack-path analysis: MED250-CONTACT-001

## Finding

**Removing WhatsApp contact leaves derived phone contact active**

- Candidate: MED250-CONTACT-001
- Instance key: derived-contact-revocation:contact-review:89
- Discovery control: Only parent contact is staled
- Discovery sink: derived_from_contact_id phone row remains in summary

## Attack path

1. An operator removes the WhatsApp parent
2. the derived phone child remains active; summary refresh republishes the stale number and it can remain available for contact.
3. The resulting impact surface is **pharmacy contact integrity**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Approved remove/update; the sink is derived_from_contact_id phone row remains in summary.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Approved remove/update
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-672
- **Mitigations already present:** Only parent contact is staled
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy contact integrity
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Summary refresh preserves rather than repairs the stale child.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **medium**
- Final severity: **low**
- Priority: **P3**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
