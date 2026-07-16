import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, hardeningMigration, geocoder, documentation, reviewTemplate] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260713200337_govern_pharmacy_geocode_approvals.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260715180529_med250_security_hardening_20260714.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/geocode-pharmacies/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/geocode-pharmacies/README.md", import.meta.url), "utf8"),
  readFile(new URL("../data/imports/pharmacy-geocode-review-template.csv", import.meta.url), "utf8"),
]);

test("requires durable human evidence before a pharmacy GPS point becomes dispatch eligible", () => {
  assert.match(migration, /geocode_review_place_id text/);
  assert.match(migration, /geocode_reviewed_by text/);
  assert.match(migration, /geocode_reviewed_at timestamptz/);
  assert.match(migration, /geocode_review_note text/);
  assert.match(migration, /geocode_status <> 'verified'/);
  assert.match(migration, /geocode_review_place_id = google_place_id/);
  assert.match(migration, /dawanear_pharmacies_verified_google_place_uidx/);
  assert.match(migration, /where geocode_status = 'verified'/);
});

test("separates Google candidate generation from exact single-pharmacy approval", () => {
  assert.match(geocoder, /Action must be generate, inspect, or approve/);
  assert.match(geocoder, /Request body must be a JSON object/);
  assert.match(geocoder, /batch_limit must be an integer from 1 to 25/);
  assert.match(geocoder, /Pharmacy record was not found/);
  assert.match(geocoder, /action === "inspect"/);
  assert.match(geocoder, /google_formatted_address/);
  assert.match(geocoder, /google_maps_url/);
  assert.match(geocoder, /body\.approve === true/);
  assert.match(geocoder, /Approval requires exactly one pharmacy_id/);
  assert.match(geocoder, /pharmacy\.google_place_id === placeId/);
  assert.match(geocoder, /pharmacy\.geocode_status === "candidate"/);
  assert.match(geocoder, /Number\(pharmacy\.location_confidence \|\| 0\) >= \.8/);
  assert.match(geocoder, /dawanear_approve_geocode_candidate/);
  assert.match(geocoder, /p_expected_updated_at: pharmacy\.updated_at/);
  assert.match(hardeningMigration, /v_pharmacy\.updated_at is distinct from p_expected_updated_at/);
  assert.match(geocoder, /Verified coordinates cannot be overwritten by candidate generation/);
  assert.match(geocoder, /candidate_version: pharmacy\.updated_at/);
  assert.match(geocoder, /status: "stale_candidate"/);
  assert.match(geocoder, /strictTypeFiltering: true/);
  assert.doesNotMatch(geocoder, /canVerify/);
  assert.match(documentation, /Batch approval is intentionally impossible/);
  assert.match(reviewTemplate, /google_place_id/);
  assert.match(reviewTemplate, /reviewed_by/);
  assert.match(reviewTemplate, /review_note/);
});
