# MED+250 marketplace product review

This service-only administrative Edge Function lists and inspects Amazon-first product candidates and applies exactly one evidence-backed state transition at a time.

It uses the server-only `MED250_ADMIN_TOKEN` Edge secret in the `X-MED250-Admin-Token` header. Gateway JWT verification is disabled only because this administrative process uses that dedicated constant-time custom-token check. The function uses an elevated Supabase key only after authentication and delegates every decision to the atomic review RPC.

The implementation temporarily accepts the former internal secret and header names so the deployed secret can be rotated without downtime. New operator tooling and documentation use MED+250 terminology exclusively.

Approval cannot be batched. The required path is `start_review`, `compliance_review`, then `approve`. Each decision must carry the `updated_at` value returned by a fresh inspection, an operator identity, and a substantive evidence note. Approval additionally requires seller and compliance HTTPS evidence references.
