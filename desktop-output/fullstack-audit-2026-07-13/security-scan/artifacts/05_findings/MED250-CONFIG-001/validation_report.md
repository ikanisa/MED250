# Validation report: MED250-CONFIG-001

## Candidate

**Local and production Worker compatibility flags can drift**

- Disposition: **suppressed**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-16

## Validation rubric

1. **Reachable source:** Node-dependent server path
2. **Missing or broken control:** Vite enables nodejs_compat
3. **Confirmed sink or transition:** Canonical Wrangler omits flag
4. **Concrete impact:** Routes may pass local tests and fail only in production
5. **Counterevidence:** The alleged production mismatch is defeated by current build evidence.

## Conclusion

The generated deployment configuration contains nodejs_compat and production dry-run uses that redirected file.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
