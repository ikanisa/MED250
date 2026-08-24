# Validation report: MED250-CONTACT-004

## Candidate

**Contact import resurrects rejected or stale login contacts**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-285/CWE-345

## Validation rubric

1. **Reachable source:** Matching CSV row
2. **Missing or broken control:** Unique conflict key only
3. **Confirmed sink or transition:** ON CONFLICT forces source_verified/login_enabled
4. **Concrete impact:** Governance rejection/removal can be bypassed by reimport
5. **Counterevidence:** The import is not monotonic with review state.

## Conclusion

Reimporting a matching contact restores source_verified and login-enabled state over prior stale or rejected governance decisions.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
