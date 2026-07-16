# Validation report: MED250-AUTH-001

## Candidate

**OTP login reactivates suspended or revoked pharmacy membership**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-863

## Validation rubric

1. **Reachable source:** Valid OTP for a still-linked pharmacy contact
2. **Missing or broken control:** Existing membership lifecycle state
3. **Confirmed sink or transition:** Upsert forces role=manager,status=active
4. **Concrete impact:** Removed staff can regain pharmacy order and selected-customer access
5. **Counterevidence:** Existing membership lifecycle state is not preserved.

## Conclusion

Valid OTP reaches an unconditional manager/active membership upsert, so prior suspension or revocation is overwritten.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
