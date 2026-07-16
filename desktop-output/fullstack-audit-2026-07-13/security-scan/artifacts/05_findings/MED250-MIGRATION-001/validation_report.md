# Validation report: MED250-MIGRATION-001

## Candidate

**Validated contact constraints can fail on legacy rows**

- Disposition: **reportable**
- Confidence: **medium**
- Suggested severity from discovery: **medium**
- CWE: CWE-754

## Validation rubric

1. **Reachable source:** Legacy admin_verified/null-target rows
2. **Missing or broken control:** Immediate validated constraints
3. **Confirmed sink or transition:** No backfill before ALTER TABLE validation
4. **Concrete impact:** Governance deployment can partially stop after earlier migration committed
5. **Counterevidence:** Current affected-row counts are unavailable without elevated access; impact is conditional on legacy state.

## Conclusion

Earlier supported imports can create rows rejected by later immediately validated constraints, with no backfill or preflight.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
