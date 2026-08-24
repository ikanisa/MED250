# Validation report: MED250-SEARCH-002

## Candidate

**Offline catalogue fallback accepts unbounded query length**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-400

## Validation rubric

1. **Reachable source:** URL or unrestricted search input
2. **Missing or broken control:** Server path caps 160 chars only
3. **Confirmed sink or transition:** Fallback allocates bigram sets across all products
4. **Concrete impact:** Multi-second browser main-thread block
5. **Counterevidence:** Normal 160-character search is fast, but no client or URL cap enforces it.

## Conclusion

The offline fallback accepts unbounded query length; 5,000 characters took about 5.12 seconds over 2,480 products.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
