# Validation report: MED250-CONTACT-002

## Candidate

**Contact SQL import can directly grant OTP authority from unbound CSV provenance**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-345

## Validation rubric

1. **Reachable source:** Operator-selected matched-contact CSV
2. **Missing or broken control:** Regex and caller-supplied official URL prefix
3. **Confirmed sink or transition:** Rows become source_verified and login_enabled
4. **Concrete impact:** Tampered input can bind attacker WhatsApp to a pharmacy
5. **Counterevidence:** No authenticated provenance or expected source digest binds the input.

## Conclusion

A caller-selected CSV receives syntactic checks before generated SQL grants source-verified WhatsApp login authority.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
