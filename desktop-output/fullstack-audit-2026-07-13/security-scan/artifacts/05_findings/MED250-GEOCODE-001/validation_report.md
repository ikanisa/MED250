# Validation report: MED250-GEOCODE-001

## Candidate

**Verified pharmacy coordinates are not bound to reviewed coordinates**

- Disposition: **suppressed**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-345

## Validation rubric

1. **Reachable source:** Privileged later location update
2. **Missing or broken control:** Review evidence binds Place ID only
3. **Confirmed sink or transition:** Location can change while row remains verified
4. **Concrete impact:** Orders can be dispatched to premises coordinates never reviewed
5. **Counterevidence:** No repository-supported untrusted source reaches the claimed state change.

## Conclusion

Only direct privileged writes can alter verified coordinates; the supported approval function refuses to overwrite a verified location.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
