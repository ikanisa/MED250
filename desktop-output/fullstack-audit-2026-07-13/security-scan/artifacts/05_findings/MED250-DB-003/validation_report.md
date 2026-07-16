# Validation report: MED250-DB-003

## Candidate

**Product status is not revalidated at offer selection**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-367/CWE-20

## Validation rubric

1. **Reachable source:** Owning customer selects submitted offer
2. **Missing or broken control:** Submission-time validation
3. **Confirmed sink or transition:** Selection never rechecks offered products
4. **Concrete impact:** Disabled original/substitute can become selected fulfilment
5. **Counterevidence:** A withdrawn exact or substitute product can become selected.

## Conclusion

Offer selection rechecks offer and pharmacy state but not current product state.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
