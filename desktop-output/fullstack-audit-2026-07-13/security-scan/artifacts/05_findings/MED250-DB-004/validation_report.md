# Validation report: MED250-DB-004

## Candidate

**Selected contact may be an unverified WhatsApp number**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-345

## Validation rubric

1. **Reachable source:** Customer requests contact after selection
2. **Missing or broken control:** Dispatch requires existence of any verified contact
3. **Confirmed sink or transition:** Returned legacy p.whatsapp may select candidate contact
4. **Concrete impact:** Customer can be directed to an unverified third party for health/payment coordination
5. **Counterevidence:** Having some verified contact does not validate the returned number.

## Conclusion

The selected-contact RPC may return a summary WhatsApp number different from the verified login-enabled contact that made the pharmacy eligible.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
