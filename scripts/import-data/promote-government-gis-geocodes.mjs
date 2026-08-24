import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [matchedPath, manifestPath, migrationPath] = process.argv.slice(2);
if (!migrationPath) {
  throw new Error("Usage: node promote-government-gis-geocodes.mjs <matched.csv> <manifest.json> <migration.sql>");
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(cell); cell = ""; }
    else if (!quoted && character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  const headers = rows.shift();
  return rows.filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const matchedBytes = await readFile(matchedPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (digest(matchedBytes) !== manifest.matched_sha256) throw new Error("Government GIS matched CSV digest does not match its evidence manifest");
const rows = parseCsv(matchedBytes.toString("utf8"));
if (rows.length !== 93 || new Set(rows.map((row) => row.registry_entry_key)).size !== 93) {
  throw new Error(`Expected 93 unique reviewed GIS matches, received ${rows.length}`);
}
for (const row of rows) {
  const longitude = Number(row.longitude), latitude = Number(row.latitude), accuracy = Number(row.accuracy_m);
  if (!row.gis_global_id || !Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(accuracy) || accuracy > 10) {
    throw new Error("Government GIS promotion contains incomplete or low-accuracy evidence");
  }
}

const payload = JSON.stringify(rows.map((row) => ({
  registry_entry_key: row.registry_entry_key,
  source_id: `rwanda-gov-gis:${row.gis_global_id}`,
  longitude: Number(row.longitude),
  latitude: Number(row.latitude),
  accuracy_m: Number(row.accuracy_m),
  source_url: row.source_url,
}))).replaceAll("'", "''");

const sql = `begin;
-- Generated from 93 manually governed exact matches between the current Rwanda
-- FDA register and the Government of Rwanda pharmacy feature layer.
-- Government source SHA-256: ${manifest.source_sha256}
-- Registry SHA-256: ${manifest.registry_sha256}
-- Reviewed match SHA-256: ${manifest.matched_sha256}
with source_rows as (
  select * from jsonb_to_recordset('${payload}'::jsonb) as source_row(
    registry_entry_key text, source_id text, longitude double precision,
    latitude double precision, accuracy_m double precision, source_url text
  )
)
update public.dawanear_pharmacies as pharmacy
set location = extensions.st_setsrid(extensions.st_makepoint(source.longitude, source.latitude), 4326)::extensions.geography,
    location_confidence = 0.980,
    geocode_status = 'verified',
    geocode_checked_at = now(),
    geocode_provider = 'rwanda_government_gis',
    geocode_source_id = source.source_id,
    geocode_source_url = source.source_url,
    google_place_id = source.source_id,
    google_maps_url = 'https://www.google.com/maps/search/?api=1&query=' || source.latitude::text || ',' || source.longitude::text,
    geocode_review_place_id = source.source_id,
    geocode_reviewed_by = 'MED+250 Rwanda government GIS evidence review',
    geocode_reviewed_at = now(),
    geocode_review_note = 'Exact current FDA licensed name, district, sector and cell matched to a unique Government of Rwanda WGS84 point with recorded GPS accuracy of ' || source.accuracy_m::text || ' metres.'
from source_rows as source
where pharmacy.registry_entry_key = source.registry_entry_key
  and (
    pharmacy.geocode_status in ('pending', 'candidate')
    or (
      pharmacy.geocode_provider = 'rwanda_government_gis'
      and pharmacy.geocode_source_id = source.source_id
    )
  );
commit;
`;

await writeFile(migrationPath, sql);
console.log(JSON.stringify({ geocodes: rows.length, matched_sha256: manifest.matched_sha256 }));
