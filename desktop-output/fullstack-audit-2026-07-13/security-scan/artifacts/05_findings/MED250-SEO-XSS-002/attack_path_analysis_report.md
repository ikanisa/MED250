# Attack-path analysis: MED250-SEO-XSS-002

## Finding

**Encoded product brand breaks out of Breadcrumb JSON-LD**

- Candidate: MED250-SEO-XSS-002
- Instance key: jsonld-render:product-page:breadcrumb-schema
- Discovery control: No runtime/sink HTML-safe encoding
- Discovery sink: Second independent dangerouslySetInnerHTML block

## Attack path

1. Encoded external brand text survives the import sequence, becomes a literal script terminator in Breadcrumb JSON-LD, and executes when a visitor opens the generated product page.
2. The validated missing control permits the recorded state transition.
3. The resulting impact surface is **browser sessions and same-origin data**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is External/local product brand content; the sink is Second independent dangerouslySetInnerHTML block.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** External/local product brand content
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-79
- **Mitigations already present:** No runtime/sink HTML-safe encoding
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** browser sessions and same-origin data
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Current data lacks HTML-like fields, but the supported import path remains reachable.
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
