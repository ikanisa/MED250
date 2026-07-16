import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps government pharmacy GPS promotion exact, governed, and provider-aware", async () => {
  const [extractor, promoter, schemaMigration, dataMigration, manifest] = await Promise.all([
    readFile(new URL("scripts/import-data/extract-rwanda-government-pharmacy-gis.mjs", root), "utf8"),
    readFile(new URL("scripts/import-data/promote-government-gis-geocodes.mjs", root), "utf8"),
    readFile(new URL("supabase/migrations/20260716063700_support_government_gis_geocodes.sql", root), "utf8"),
    readFile(new URL("supabase/migrations/20260716063701_import_verified_government_gis_geocodes.sql", root), "utf8"),
    readFile(new URL("data/imports/rwanda-government-pharmacy-gis-manifest.json", root), "utf8"),
  ]);

  assert.match(extractor, /exactCell\.length === 1/);
  assert.match(extractor, /accuracy <= 10/);
  assert.match(promoter, /matched CSV digest does not match/);
  assert.match(schemaMigration, /rwanda_government_gis/);
  assert.match(schemaMigration, /dawanear_pharmacies_verified_geocode_source_uidx/);
  assert.match(dataMigration, /location_confidence = 0\.980/);
  assert.match(dataMigration, /geocode_reviewed_by = 'MED\+250 Rwanda government GIS evidence review'/);
  assert.match(dataMigration, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);

  const evidence = JSON.parse(manifest);
  assert.equal(evidence.matched_pharmacies, 93);
  assert.equal(evidence.source_features, 291);
  assert.match(evidence.matching_rule, /name, district, sector and cell/);
});
