# Validation report: MED250-SEARCH-001

## Candidate

**Anonymous server catalogue search performs full aggregate/ranking work**

- Disposition: **reportable**
- Confidence: **medium**
- Suggested severity from discovery: **medium**
- CWE: CWE-400

## Validation rubric

1. **Reachable source:** Repeated anonymous fuzzy search
2. **Missing or broken control:** Input/output bounds
3. **Confirmed sink or transition:** Full product/price aggregate, scoring, count and sort precede pagination
4. **Concrete impact:** Database CPU/latency exhaustion can affect ordering operations
5. **Counterevidence:** No repository rate limit or precomputed search index bounds repeated work.

## Conclusion

Anonymous search performs full price aggregation, fuzzy scoring, counting, and sorting; a 2,459-row local run took about 43–59 ms per request.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
