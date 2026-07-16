# Attack-path analysis: MED250-OTP-001

## Finding

**OTP issuance limits are non-atomic under concurrent requests**

- Candidate: MED250-OTP-001
- Instance key: rate-limit-concurrency:send-otp:32
- Discovery control: Separate count checks
- Discovery sink: Multiple active challenges and WhatsApp sends can commit

## Attack path

1. A bot sends concurrent OTP requests
2. each request observes the same pre-insert counters; multiple challenges and WhatsApp sends commit before the limits reflect the burst.
3. The resulting impact surface is **availability and messaging cost**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Public parallel OTP-send requests; the sink is Multiple active challenges and WhatsApp sends can commit.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Public parallel OTP-send requests
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-362/CWE-799
- **Mitigations already present:** Separate count checks
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** availability and messaging cost
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Sequential counters do not close the race.
- **Blindspots:** No live destructive or privileged production action was attempted.
- **Confidence:** high

## Severity calibration

- Impact: **medium**
- Likelihood: **high**
- Final severity: **medium**
- Priority: **P2**

The severity-policy matrix was applied mechanically after reachability and counterevidence.

## Final policy decision

**report** — retain in the final security report.
