# Validation report: MED250-CONTACT-001

## Candidate

**Removing WhatsApp contact leaves derived phone contact active**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-672

## Validation rubric

1. **Reachable source:** Approved remove/update
2. **Missing or broken control:** Only parent contact is staled
3. **Confirmed sink or transition:** derived_from_contact_id phone row remains in summary
4. **Concrete impact:** Revoked number can remain visible/callable
5. **Counterevidence:** Summary refresh preserves rather than repairs the stale child.

## Conclusion

Removing or updating a WhatsApp parent leaves its derived phone child active and republished in the summary.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
