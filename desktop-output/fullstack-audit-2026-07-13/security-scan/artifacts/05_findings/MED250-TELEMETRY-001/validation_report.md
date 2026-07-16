# Validation report: MED250-TELEMETRY-001

## Candidate

**Telemetry route buffers unknown-length bodies before limiting**

- Disposition: **reportable**
- Confidence: **high**
- Suggested severity from discovery: **medium**
- CWE: CWE-400

## Validation rubric

1. **Reachable source:** Unauthenticated streamed request without Content-Length
2. **Missing or broken control:** 2 KiB limit before read only when header exists
3. **Confirmed sink or transition:** request.text() drains full stream before post-read limit
4. **Concrete impact:** Repeated bodies consume Worker memory/CPU
5. **Counterevidence:** The post-buffer size check does not bound request-body work.

## Conclusion

A 5 MB body without Content-Length was fully consumed before the endpoint returned 413.

This was a bounded, read-only validation. No live OTP, pharmacy, order, payment, deployment, or privileged database action was performed.
