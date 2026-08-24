# Attack-path analysis: MED250-AUTH-001

## Finding

**OTP login reactivates suspended or revoked pharmacy membership**

- Candidate: MED250-AUTH-001
- Instance key: authorization-state:verify-otp:106
- Discovery control: Existing membership lifecycle state
- Discovery sink: Upsert forces role=manager,status=active

## Attack path

1. A suspended staff member with the still-authorized WhatsApp number requests and verifies an OTP
2. verification overwrites the suspended membership as manager/active; downstream pharmacy RPCs accept it.
3. The resulting impact surface is **pharmacy identity and data**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Valid OTP for a still-linked pharmacy contact; the sink is Upsert forces role=manager,status=active.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Valid OTP for a still-linked pharmacy contact
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-863
- **Mitigations already present:** Existing membership lifecycle state
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy identity and data
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Existing membership lifecycle state is not preserved.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **high**
- Likelihood: **high**
- Final severity: **high**
- Priority: **P1**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
