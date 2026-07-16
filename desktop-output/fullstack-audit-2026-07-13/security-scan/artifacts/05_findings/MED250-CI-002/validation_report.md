# Validation report: MED250-CI-002

## Candidate

**Deployment actions use mutable major-version refs**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-829

## Validation rubric

1. **Reachable source:** Mutable GitHub Action tags
2. **Missing or broken control:** Official action provenance only
3. **Confirmed sink or transition:** Actions receive Cloudflare and job-level Supabase credentials
4. **Concrete impact:** Moved/compromised tag can steal secrets or alter deployment
5. **Counterevidence:** The supply-chain boundary is not pinned to reviewed commits.

## Conclusion

Production actions use mutable major-version tags while receiving Supabase and Cloudflare credentials.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
