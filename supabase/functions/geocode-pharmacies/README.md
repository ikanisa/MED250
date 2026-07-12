# Pharmacy map verification

This admin-only Edge Function looks up Rwanda FDA-licensed pharmacies with the Google Places API (New), stores the returned address, GPS point, Place ID and Maps URL, then marks each result as either `candidate` or `verified`.

Set the `GOOGLE_MAPS_API_KEY` and `DAWANEAR_ADMIN_TOKEN` Edge Function secrets. Invoke the function from a trusted administrative process with the token in `X-DawaNear-Admin-Token`. Send `{ "batch_limit": 25, "approve": false }` to create candidates, or `{ "pharmacy_id": "...", "approve": false }` for one record. After checking the premises manually, repeat the single-pharmacy request with `approve: true`. Batch approval is intentionally disabled.

`supabase/config.toml` disables the gateway JWT check for this function because the handler performs its own dedicated-token authentication. Deploy with that configuration intact.

The function does not infer WhatsApp numbers from public phone listings. Those numbers and MoMo merchant codes must be verified directly with the claimed pharmacy.

Only rows with `geocode_status = 'verified'` are eligible for the 10 km / nearest-20 dispatch trigger.
