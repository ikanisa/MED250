# Validation report: MED250-CONTACT-003

## Candidate

**Roster extractor relabels arbitrary local PDFs as official login-contact evidence**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-345

## Validation rubric

1. **Reachable source:** Caller-controlled local roster PDFs
2. **Missing or broken control:** Name/district/phone matching only
3. **Confirmed sink or transition:** Hard-coded official URL/reference emitted
4. **Concrete impact:** Substituted PDF can seed source-verified pharmacy login contact
5. **Counterevidence:** No origin or digest validation distinguishes the official roster.

## Conclusion

Arbitrary local PDFs can be relabelled with official Rwanda FDA references and flow into login-authoritative contact data.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
