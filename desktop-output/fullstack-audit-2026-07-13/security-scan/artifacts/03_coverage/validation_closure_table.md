# Validation closure table

All 31 raw discovery candidates received a Phase 3 disposition and validation receipt.

| Candidate | Disposition | Confidence | Closure |
| --- | --- | --- | --- |
| MED250-AUTH-001 | reportable | high | Valid OTP reaches an unconditional manager/active membership upsert, so prior suspension or revocation is overwritten. |
| MED250-AUTH-002 | reportable | medium | Removing a login contact blocks future OTP issuance but does not revoke an existing session or active pharmacy membership. |
| MED250-OTP-001 | reportable | high | Rate checks and challenge creation are separate operations with no lock or active-challenge uniqueness, allowing concurrent over-issuance. |
| MED250-OTP-002 | reportable | high | The source bucket includes caller-controlled User-Agent, so changing it creates a new rate-limit identity. |
| MED250-DB-001 | reportable | high | The active-orders RPC aggregates incomplete offer rows before client-side filtering and returns draft pharmacy response data. |
| MED250-DB-002 | reportable | high | Exact requested-product confirmations do not recheck current active/orderable state. |
| MED250-DB-003 | reportable | high | Offer selection rechecks offer and pharmacy state but not current product state. |
| MED250-DB-004 | reportable | high | The selected-contact RPC may return a summary WhatsApp number different from the verified login-enabled contact that made the pharmacy eligible. |
| MED250-DB-005 | reportable | high | Cancellation immediately releases the one-active-order slot and there is no rolling create/cancel quota. |
| MED250-UPLOAD-001 | deferred | medium | Browser-declared MIME is accepted even when bytes do not match the claimed prescription type. |
| MED250-TELEMETRY-001 | reportable | high | A 5 MB body without Content-Length was fully consumed before the endpoint returned 413. |
| MED250-SEO-XSS-001 | reportable | high | Entity-decoded product data can become a literal script terminator in Product JSON-LD rendered with dangerouslySetInnerHTML. |
| MED250-SEO-XSS-002 | reportable | high | Entity-decoded brand data can become a literal script terminator in Breadcrumb JSON-LD rendered with dangerouslySetInnerHTML. |
| MED250-GEOCODE-001 | suppressed | high | Only direct privileged writes can alter verified coordinates; the supported approval function refuses to overwrite a verified location. |
| MED250-GEOCODE-002 | reportable | high | Approval binds status and Place ID but not the reviewed candidate snapshot, so a concurrent update retaining that Place ID can verify unreviewed coordinates. |
| MED250-CONTACT-001 | reportable | high | Removing or updating a WhatsApp parent leaves its derived phone child active and republished in the summary. |
| MED250-CONTACT-002 | reportable | high | A caller-selected CSV receives syntactic checks before generated SQL grants source-verified WhatsApp login authority. |
| MED250-CONTACT-003 | reportable | high | Arbitrary local PDFs can be relabelled with official Rwanda FDA references and flow into login-authoritative contact data. |
| MED250-CONTACT-004 | reportable | high | Reimporting a matching contact restores source_verified and login-enabled state over prior stale or rejected governance decisions. |
| MED250-DEPLOY-001 | suppressed | high | Private destinations pass URL validation, but all supported URL sources are protected operator settings or Cloudflare deployment output. |
| MED250-CI-001 | reportable | high | The elevated Supabase key is job-scoped across checkout, setup, install, build, validation, and deployment. |
| MED250-CI-002 | reportable | high | Production actions use mutable major-version tags while receiving Supabase and Cloudflare credentials. |
| MED250-CLEANUP-001 | reportable | high | Cleanup enumerates every owner folder and page before applying its deletion bound, while users can create deeply nested owner-prefixed paths. |
| MED250-SEARCH-001 | reportable | medium | Anonymous search performs full price aggregation, fuzzy scoring, counting, and sorting; a 2,459-row local run took about 43–59 ms per request. |
| MED250-SEARCH-002 | reportable | high | The offline fallback accepts unbounded query length; 5,000 characters took about 5.12 seconds over 2,480 products. |
| MED250-ADMIN-001 | reportable | high | Shared-token admin functions durably trust caller-supplied reviewer labels. |
| MED250-MIGRATION-001 | reportable | medium | Earlier supported imports can create rows rejected by later immediately validated constraints, with no backfill or preflight. |
| MED250-CSP-001 | suppressed | high | unsafe-inline weakens defense in depth but is not a separate root cause from the validated JSON-LD injection. |
| MED250-CSP-002 | suppressed | high | Wildcard Supabase connectivity broadens post-compromise reach but has no independent source-to-impact chain. |
| MED250-CONFIG-001 | suppressed | high | The generated deployment configuration contains nodejs_compat and production dry-run uses that redirected file. |
| MED250-CONTRACT-001 | reportable | high | The mandatory release contract checks bucket existence and cleanup-table RLS but not bucket privacy, limits, or Storage policies. |
