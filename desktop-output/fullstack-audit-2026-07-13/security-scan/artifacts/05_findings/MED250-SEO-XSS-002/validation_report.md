# Validation report: MED250-SEO-XSS-002

## Candidate

**Encoded product brand breaks out of Breadcrumb JSON-LD**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-79

## Validation rubric

1. **Reachable source:** External/local product brand content
2. **Missing or broken control:** No runtime/sink HTML-safe encoding
3. **Confirmed sink or transition:** Second independent dangerouslySetInnerHTML block
4. **Concrete impact:** Stored same-origin script execution remains if only first sink is fixed
5. **Counterevidence:** Current data lacks HTML-like fields, but the supported import path remains reachable.

## Conclusion

Entity-decoded brand data can become a literal script terminator in Breadcrumb JSON-LD rendered with dangerouslySetInnerHTML.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
