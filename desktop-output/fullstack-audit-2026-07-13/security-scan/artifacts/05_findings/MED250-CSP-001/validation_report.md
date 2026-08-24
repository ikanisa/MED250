# Validation report: MED250-CSP-001

## Candidate

**Global CSP permits all inline scripts**

- Disposition: **suppressed**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-693

## Validation rubric

1. **Reachable source:** Any HTML injection
2. **Missing or broken control:** script-src unsafe-inline
3. **Confirmed sink or transition:** Injected script elements execute
4. **Concrete impact:** CSP does not contain stored-XSS impact
5. **Counterevidence:** Track as an amplifier in the stored-injection finding.

## Conclusion

unsafe-inline weakens defense in depth but is not a separate root cause from the validated JSON-LD injection.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
