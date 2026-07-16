# Validation report: MED250-OTP-001

## Candidate

**OTP issuance limits are non-atomic under concurrent requests**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-362/CWE-799

## Validation rubric

1. **Reachable source:** Public parallel OTP-send requests
2. **Missing or broken control:** Separate count checks
3. **Confirmed sink or transition:** Multiple active challenges and WhatsApp sends can commit
4. **Concrete impact:** Notification/cost abuse and multiplied guess budget
5. **Counterevidence:** Sequential counters do not close the race.

## Conclusion

Rate checks and challenge creation are separate operations with no lock or active-challenge uniqueness, allowing concurrent over-issuance.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
