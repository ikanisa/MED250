# Attack-path analysis: MED250-DB-005

## Finding

**One customer session can create/cancel orders repeatedly**

- Candidate: MED250-DB-005
- Instance key: order-notification-rate:marketplace.sql:1251
- Discovery control: One concurrent active order
- Discovery sink: Cancellation immediately frees slot; no rolling quota

## Attack path

1. An authenticated anonymous customer creates an order, cancels it, and repeats
2. each cancellation frees the active slot and each new order can dispatch to up to 20 pharmacies.
3. The resulting impact surface is **pharmacy notification availability**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is One CAPTCHA-cleared anonymous session; the sink is Cancellation immediately frees slot; no rolling quota.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** One CAPTCHA-cleared anonymous session
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-770/CWE-799
- **Mitigations already present:** One concurrent active order
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** pharmacy notification availability
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Idempotency and concurrent-order controls do not limit sequential churn.
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
