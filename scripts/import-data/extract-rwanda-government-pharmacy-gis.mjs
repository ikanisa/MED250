import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [registryPath, matchedPath, reviewPath, manifestPath] = process.argv.slice(2);
if (!manifestPath) {
  throw new Error("Usage: node extract-rwanda-government-pharmacy-gis.mjs <fda-registry.csv> <matched.csv> <review.csv> <manifest.json>");
}

const SOURCE = "https://gh.space.gov.rw/server/rest/services/Health_Facilities/FeatureServer/3";
const queryUrl = new URL(`${SOURCE}/query`);
queryUrl.search = new URLSearchParams({
  where: "1=1",
  outFields: "objectid,globalid,shop_name,province,district,sector,cell,village,street_number,accuracy,data_collection_date,editdate",
  returnGeometry: "true",
  outSR: "4326",
  f: "geojson",
}).toString();

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

function csv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${[columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n")}\n`;
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/\b(PHARMACY|PHARMACIE|PHARMA|LIMITED|LTD|RWANDA|RETAIL)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}

const aliases = new Map([["BUTARE", "HUYE"], ["GISENYI", "RUBAVU"], ["RUHENGERI", "MUSANZE"], ["KIBUYE", "KARONGI"]]);
const locality = (value) => aliases.get(normalize(value)) ?? normalize(value);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const registryBytes = await readFile(registryPath);
const registry = parseCsv(registryBytes.toString("utf8"));
const response = await fetch(queryUrl, { headers: { "user-agent": "MED+250 government geospatial verifier/1.0" } });
if (!response.ok) throw new Error(`Rwanda government GIS returned HTTP ${response.status}`);
const sourceBytes = Buffer.from(await response.arrayBuffer());
const geojson = JSON.parse(sourceBytes.toString("utf8"));
const features = geojson.features ?? [];
if (features.length !== 291) throw new Error(`Expected 291 government pharmacy features, received ${features.length}`);

const matched = [], review = [];
for (const feature of features) {
  const source = feature.properties ?? {};
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  const accuracy = Number(source.accuracy);
  const candidates = registry.filter((row) =>
    normalize(row.name) === normalize(source.shop_name)
    && locality(row.district) === locality(source.district),
  );
  const exactSector = candidates.filter((row) =>
    locality(String(row.sector_cell_raw).split(/\s+/)[0]) === locality(source.sector),
  );
  const exactCell = exactSector.filter((row) =>
    locality(String(row.sector_cell_raw).split(/\s+/).slice(1).join(" ")) === locality(source.cell),
  );
  const validPoint = Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= 28.8 && longitude <= 30.9 && latitude >= -2.9 && latitude <= -1.0;
  const accepted = exactCell.length === 1 && validPoint && Number.isFinite(accuracy) && accuracy <= 10;
  const best = exactCell[0] ?? exactSector[0] ?? candidates[0];
  const row = {
    registry_entry_key: accepted ? `retail-2026-05-${best.source_serial}` : "",
    registry_pharmacy_name: best?.name ?? "",
    registry_district: best?.district ?? "",
    registry_area: best?.sector_cell_raw ?? "",
    gis_object_id: String(source.objectid ?? ""),
    gis_global_id: String(source.globalid ?? ""),
    gis_shop_name: String(source.shop_name ?? ""),
    gis_district: String(source.district ?? ""),
    gis_sector: String(source.sector ?? ""),
    gis_cell: String(source.cell ?? ""),
    gis_village: String(source.village ?? ""),
    gis_street_number: String(source.street_number ?? ""),
    longitude: validPoint ? Number(longitude).toFixed(7) : "",
    latitude: validPoint ? Number(latitude).toFixed(7) : "",
    accuracy_m: Number.isFinite(accuracy) ? accuracy.toFixed(3) : "",
    collected_at: source.data_collection_date ? new Date(source.data_collection_date).toISOString() : "",
    edited_at: source.editdate ? new Date(source.editdate).toISOString() : "",
    source_url: SOURCE,
    review_reason: accepted ? "exact_name_district_sector_cell_and_accuracy" :
      exactSector.length === 1 ? "cell_mismatch_or_accuracy" :
        candidates.length ? "sector_mismatch_or_ambiguous" : "name_or_district_unmatched",
  };
  (accepted ? matched : review).push(row);
}

if (matched.length !== 93 || new Set(matched.map((row) => row.registry_entry_key)).size !== 93) {
  throw new Error(`Expected 93 unique exact government GIS matches, received ${matched.length}`);
}
const columns = [
  "registry_entry_key", "registry_pharmacy_name", "registry_district", "registry_area",
  "gis_object_id", "gis_global_id", "gis_shop_name", "gis_district", "gis_sector", "gis_cell",
  "gis_village", "gis_street_number", "longitude", "latitude", "accuracy_m", "collected_at",
  "edited_at", "source_url", "review_reason",
];
const matchedBytes = Buffer.from(csv(matched, columns));
const reviewBytes = Buffer.from(csv(review, columns));
const manifest = {
  generated_at: new Date().toISOString(),
  source: SOURCE,
  source_owner: "Government of Rwanda geospatial portal",
  source_service_item_id: "814af48dc25f4d08bfe0c745ab094efc",
  source_features: features.length,
  source_sha256: digest(sourceBytes),
  registry_sha256: digest(registryBytes),
  matched_sha256: digest(matchedBytes),
  review_sha256: digest(reviewBytes),
  matched_pharmacies: matched.length,
  review_features: review.length,
  matching_rule: "Unique exact current FDA licensed name, district, sector and cell; WGS84 Rwanda point; recorded GPS accuracy at most 10 metres.",
  observation_warning: "Government coordinates were collected in 2021 and edited in 2023; exact current FDA locality matching is required before activation.",
};

await Promise.all([
  writeFile(matchedPath, matchedBytes),
  writeFile(reviewPath, reviewBytes),
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
]);
console.log(JSON.stringify({ features: features.length, matched: matched.length, review: review.length }));
