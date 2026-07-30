# Pharmacy contact-review operations

This administrative Edge Function lists and inspects pharmacy-staff contact-edit requests, then invokes one atomic database review for exactly one request. It uses the same dedicated `DAWANEAR_ADMIN_TOKEN` custom header as pharmacy geocoding and is not a customer or pharmacy-staff endpoint.

Use `npm run ops:contacts -- list`, inspect a request, verify the contact directly with the pharmacy, then approve or reject it with a named reviewer and evidence note. Approved WhatsApp numbers become login-enabled and are mirrored into the pharmacy's phone contacts by the database transaction. Source-verified WhatsApp destinations may already receive order dispatches, but no public-source contact is automatically promoted to pharmacy-portal login authority.

The function has gateway JWT verification disabled only because it performs a constant-time dedicated-token check before parsing the body or touching Supabase. Unauthenticated calls return HTTP 403.
