# Validation report: MED250-DB-001

## Candidate

**Active-order recovery exposes incomplete pharmacy responses**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-200

## Validation rubric

1. **Reachable source:** Owning customer calls active-orders RPC
2. **Missing or broken control:** Direct-table RLS requires complete offers
3. **Confirmed sink or transition:** SECURITY DEFINER aggregate omits f.complete
4. **Concrete impact:** Customer learns pharmacy identity/note/items before complete confirmation
5. **Counterevidence:** Direct-table RLS and the confirmed-offers RPC do not protect this SECURITY DEFINER output.

## Conclusion

The active-orders RPC aggregates incomplete offer rows before client-side filtering and returns draft pharmacy response data.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
