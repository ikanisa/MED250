# Validation report: MED250-CSP-002

## Candidate

**CSP allows connections to every Supabase project**

- Disposition: **suppressed**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-942

## Validation rubric

1. **Reachable source:** Injected/compromised browser script
2. **Missing or broken control:** Wildcard connect-src
3. **Confirmed sink or transition:** Attacker-owned Supabase is allowed exfiltration target
4. **Concrete impact:** Browser tokens/data can leave origin without CSP violation
5. **Counterevidence:** Track as hardening rather than a standalone finding.

## Conclusion

Wildcard Supabase connectivity broadens post-compromise reach but has no independent source-to-impact chain.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
