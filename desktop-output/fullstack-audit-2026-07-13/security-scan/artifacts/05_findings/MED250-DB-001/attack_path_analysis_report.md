# Attack-path analysis: MED250-DB-001

## Finding

**Active-order recovery exposes incomplete pharmacy responses**

- Candidate: MED250-DB-001
- Instance key: customer-confirmation-privacy:marketplace.sql:2641
- Discovery control: Direct-table RLS requires complete offers
- Discovery sink: SECURITY DEFINER aggregate omits f.complete

## Attack path

1. An order owner calls the public RPC directly
2. the SECURITY DEFINER aggregate includes an incomplete offer; draft pharmacy identity, note, and item data cross the pre-confirmation boundary.
3. The resulting impact surface is **customer and pharmacy response privacy**.

## Attack Path Facts

- **Assumptions:** Production uses the repository Cloudflare/Supabase architecture and public endpoints described by the threat model.
- **Context:** The path crosses a product trust boundary identified by the threat model.
- **In scope:** Yes; the component is part of the marketplace runtime, data plane, authentication, or production workflow.
- **Exposure:** Public or authenticated internet-facing product surface.
- **Identity and privileges:** Source is Owning customer calls active-orders RPC; the sink is SECURITY DEFINER aggregate omits f.complete.
- **Cross-boundary behavior:** Established by the validated source-to-sink chain.
- **Vector:** remote
- **Preconditions:** Owning customer calls active-orders RPC
- **Attacker input control:** Yes or realistically plausible within the product threat model.
- **Category:** CWE-200
- **Mitigations already present:** Direct-table RLS requires complete offers
- **Auth scope:** Public or normal product identity, as specified by the source.
- **Impact surface:** customer and pharmacy response privacy
- **Target reach:** single marketplace service or tenant
- **Secrets references:** No additional secret reference is required beyond the recorded identity/session path.
- **Counterevidence:** Direct-table RLS and the confirmed-offers RPC do not protect this SECURITY DEFINER output.
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
