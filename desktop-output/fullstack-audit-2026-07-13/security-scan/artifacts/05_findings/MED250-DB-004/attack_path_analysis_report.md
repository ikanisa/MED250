# Attack-path analysis: MED250-DB-004

## Finding

**Selected contact may be an unverified WhatsApp number**

- Candidate: MED250-DB-004
- Instance key: selected-contact-provenance:marketplace.sql:1914
- Discovery control: Dispatch requires existence of any verified contact
- Discovery sink: Returned legacy p.whatsapp may select candidate contact

## Attack path

1. A customer selects an eligible pharmacy
2. the contact RPC returns a summary number not tied to the verified login contact; the client opens WhatsApp to the unverified destination.
3. The resulting impact surface is **customer health and payment contact confidentiality**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Customer requests contact after selection; the sink is Returned legacy p.whatsapp may select candidate contact.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Customer requests contact after selection
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-345
- **Mitigations already present:** Dispatch requires existence of any verified contact
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** customer health and payment contact confidentiality
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Having some verified contact does not validate the returned number.
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
