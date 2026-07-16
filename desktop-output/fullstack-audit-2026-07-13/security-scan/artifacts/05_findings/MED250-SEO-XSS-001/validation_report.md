# Validation report: MED250-SEO-XSS-001

## Candidate

**Encoded product data breaks out of Product JSON-LD**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **high**
- CWE: CWE-79

## Validation rubric

1. **Reachable source:** External/local product register content
2. **Missing or broken control:** Parser strips tags before entity decode; JSON.stringify only
3. **Confirmed sink or transition:** dangerouslySetInnerHTML Product schema with literal </script>
4. **Concrete impact:** Stored same-origin script execution can steal local sessions and act as victim
5. **Counterevidence:** Current data lacks HTML-like fields, but the supported import path crosses an external-data boundary.

## Conclusion

Entity-decoded product data can become a literal script terminator in Product JSON-LD rendered with dangerouslySetInnerHTML.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
