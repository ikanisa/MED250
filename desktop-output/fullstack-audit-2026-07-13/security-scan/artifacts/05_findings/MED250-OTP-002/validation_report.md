# Validation report: MED250-OTP-002

## Candidate

**Caller-controlled User-Agent partitions OTP source limits**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-799

## Validation rubric

1. **Reachable source:** Public request User-Agent
2. **Missing or broken control:** Source hash includes IP plus User-Agent
3. **Confirmed sink or transition:** Different User-Agents create different source buckets
4. **Concrete impact:** Bot can bypass source-window limits subject to phone/global controls
5. **Counterevidence:** Per-phone and global limits bound but do not remove the bypass.

## Conclusion

The source bucket includes caller-controlled User-Agent, so changing it creates a new rate-limit identity.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
