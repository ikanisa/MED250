# Validation report: MED250-UPLOAD-001

## Candidate

**Prescription upload trusts browser-declared MIME only**

- Disposition: **deferred**
- Confidence: **medium**
- Suggested severity from discovery: **medium**
- CWE: CWE-434

## Validation rubric

1. **Reachable source:** Anonymous customer-selected bytes
2. **Missing or broken control:** Size and File.type allowlist
3. **Confirmed sink or transition:** Bytes uploaded and later signed to selected staff without signature/scanning
4. **Concrete impact:** Disguised malicious content can be delivered to pharmacy staff
5. **Counterevidence:** The malformed upload path is confirmed, but a concrete execution or confidentiality impact is not established.

## Conclusion

Browser-declared MIME is accepted even when bytes do not match the claimed prescription type.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
