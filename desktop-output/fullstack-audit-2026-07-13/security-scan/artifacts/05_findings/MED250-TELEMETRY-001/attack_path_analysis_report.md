# Attack-path analysis: MED250-TELEMETRY-001

## Finding

**Telemetry route buffers unknown-length bodies before limiting**

- Candidate: MED250-TELEMETRY-001
- Instance key: body-buffering:telemetry:84
- Discovery control: 2 KiB limit before read only when header exists
- Discovery sink: request.text() drains full stream before post-read limit

## Attack path

1. A public caller streams a large body without Content-Length
2. the route buffers the body before checking the 2 KiB policy; repeated requests consume Worker memory and CPU.
3. The resulting impact surface is **runtime availability**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Unauthenticated streamed request without Content-Length; the sink is request.text() drains full stream before post-read limit.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Unauthenticated streamed request without Content-Length
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-400
- **Mitigations already present:** 2 KiB limit before read only when header exists
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** runtime availability
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** The post-buffer size check does not bound request-body work.
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
