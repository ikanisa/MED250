# Validation report: MED250-AUTH-002

## Candidate

**Removing a login contact does not revoke existing pharmacy authorization**

- Disposition: **reportable**
- Confidence: **medium**
- Suggested severity from discovery: **high**
- CWE: CWE-613

## Validation rubric

1. **Reachable source:** Existing staff session before contact removal
2. **Missing or broken control:** Contact is disabled but membership remains active
3. **Confirmed sink or transition:** Pharmacy RPCs authorize active membership only
4. **Concrete impact:** Former staff can retain pharmacy data and order-processing access
5. **Counterevidence:** Manual membership suspension remains a separate compensating control.

## Conclusion

Removing a login contact blocks future OTP issuance but does not revoke an existing session or active pharmacy membership.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
