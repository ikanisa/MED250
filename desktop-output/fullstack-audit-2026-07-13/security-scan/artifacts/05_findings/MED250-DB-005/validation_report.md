# Validation report: MED250-DB-005

## Candidate

**One customer session can create/cancel orders repeatedly**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-770/CWE-799

## Validation rubric

1. **Reachable source:** One CAPTCHA-cleared anonymous session
2. **Missing or broken control:** One concurrent active order
3. **Confirmed sink or transition:** Cancellation immediately frees slot; no rolling quota
4. **Concrete impact:** Up to 20 pharmacies receive repeated open/close notifications
5. **Counterevidence:** Idempotency and concurrent-order controls do not limit sequential churn.

## Conclusion

Cancellation immediately releases the one-active-order slot and there is no rolling create/cancel quota.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
