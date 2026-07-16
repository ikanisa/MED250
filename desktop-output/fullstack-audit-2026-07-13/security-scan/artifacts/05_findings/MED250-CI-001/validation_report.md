# Validation report: MED250-CI-001

## Candidate

**Supabase elevated key is exposed to the entire production job**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-522

## Validation rubric

1. **Reachable source:** GitHub production secret
2. **Missing or broken control:** Job-level env
3. **Confirmed sink or transition:** Checkout/setup/npm ci/build/actions/verify all inherit secret
4. **Concrete impact:** Dependency/action compromise can exfiltrate RLS-bypassing key
5. **Counterevidence:** A compromise in any earlier step can read the production credential.

## Conclusion

The elevated Supabase key is job-scoped across checkout, setup, install, build, validation, and deployment.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
