# Validation report: MED250-GEOCODE-002

## Candidate

**Geocode approval has a candidate-snapshot race**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-367

## Validation rubric

1. **Reachable source:** Concurrent candidate update
2. **Missing or broken control:** Approval rereads only status and Place ID
3. **Confirmed sink or transition:** Coordinates/confidence/version are not in update predicate
4. **Concrete impact:** Unreviewed coordinates can become verified and dispatch-eligible
5. **Counterevidence:** The approval transition is not atomic with the reviewed values.

## Conclusion

Approval binds status and Place ID but not the reviewed candidate snapshot, so a concurrent update retaining that Place ID can verify unreviewed coordinates.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
