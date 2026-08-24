# Pharmacy map verification

This admin-only Edge Function looks up Rwanda FDA-licensed pharmacies with the Google Places API (New), stores the returned address, GPS point, Place ID and Maps URL, then marks each result as either `candidate` or `verified`.

Set the `GOOGLE_MAPS_API_KEY` and `DAWANEAR_ADMIN_TOKEN` Edge Function secrets. Invoke the function from a trusted administrative process with the token in `X-DawaNear-Admin-Token`. Candidate generation never verifies GPS coordinates.

Use the repository command from a private operations terminal. Its token is read only from the process environment and is never accepted as a command-line option:

```bash
npm run ops:geocode -- generate --batch-limit 25
npm run ops:geocode -- generate --pharmacy-id 00000000-0000-0000-0000-000000000000
npm run ops:geocode -- inspect --pharmacy-id 00000000-0000-0000-0000-000000000000
```

`generate` returns the official-register identity together with the staged Google Place ID, formatted address, Maps URL and confidence. `inspect` retrieves the same protected review packet without rerunning Google search. Neither operation can mark a row verified.

After checking the staged address and Maps URL against the official premises record, approve exactly one staged candidate with:

```json
{
  "pharmacy_id": "00000000-0000-0000-0000-000000000000",
  "action": "approve",
  "google_place_id": "the-exact-staged-place-id",
  "reviewed_by": "reviewer@example.org",
  "review_note": "Matched the licensed premises name and street address against the May 2026 register."
}
```

Approval does not rerun Google search. It succeeds only when the supplied Place ID is the current staged candidate, confidence is at least 0.8, location data exists, and the reviewer identity plus evidence note are present. The database records the reviewer, timestamp, note and exact Place ID. Batch approval is intentionally impossible, and a database constraint prevents any `verified` row without that durable evidence.

The equivalent guarded command is:

```bash
npm run ops:geocode -- approve \
  --pharmacy-id 00000000-0000-0000-0000-000000000000 \
  --google-place-id the-exact-staged-place-id \
  --reviewed-by reviewer@example.org \
  --review-note "Matched the licensed premises identity and address against the May 2026 register."
```

Approval accepts no batch option. Always run `inspect` immediately before approval and retain the review evidence outside the public application.

`supabase/config.toml` disables the gateway JWT check for this function because the handler performs its own dedicated-token authentication. Deploy with that configuration intact.

The function does not infer WhatsApp numbers from public phone listings. Those numbers and MoMo merchant codes must be verified directly with the claimed pharmacy.

Only rows with `geocode_status = 'verified'` are eligible for the 10 km / nearest-20 dispatch trigger. A partial unique index also prevents two verified pharmacies from sharing the same Google Place ID.
