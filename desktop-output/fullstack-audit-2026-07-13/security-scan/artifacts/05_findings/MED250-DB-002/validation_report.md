# Validation report: MED250-DB-002

## Candidate

**Disabled requested product can still be confirmed**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-367/CWE-20

## Validation rubric

1. **Reachable source:** Legitimate routed pharmacy submits response
2. **Missing or broken control:** Order creation checked prior state
3. **Confirmed sink or transition:** Submission omits current active/orderable check for requested product
4. **Concrete impact:** Withdrawn or disabled medicine can be confirmed
5. **Counterevidence:** Creation-time validation does not cover later product withdrawal.

## Conclusion

Exact requested-product confirmations do not recheck current active/orderable state.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
