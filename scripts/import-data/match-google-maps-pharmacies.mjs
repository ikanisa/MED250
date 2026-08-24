import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
if (!args.fda || !args.maps || !args.output) throw new Error("Usage: node match-google-maps-pharmacies.mjs --fda <csv> --maps <dir> --output <dir>");

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(cell); cell = ""; }
    else if (!quoted && char === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== '\r') cell += char;
  }
  const headers = rows.shift();
  return rows.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}
function csv(rows, columns) { const q = (v) => `"${String(v ?? "").replaceAll('"','""')}"`; return [columns.map(q).join(','), ...rows.map((r) => columns.map((c) => q(r[c])).join(','))].join('\n') + '\n'; }
const stop = new Set(["PHARMACY","PHARMACIE","PHARMA","LTD","LIMITED","RETAIL","BRANCH","RWANDA","THE","AND","FOR"]);
function tokens(name) { return new Set(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter((token) => token && !stop.has(token))); }
function score(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let intersection = 0; for (const token of A) if (B.has(token)) intersection++;
  return (2 * intersection) / (A.size + B.size);
}
const localityAliases = {
  RUBAVU:["RUBAVU","GISENYI"], HUYE:["HUYE","BUTARE"], MUSANZE:["MUSANZE","RUHENGERI"], KARONGI:["KARONGI","KIBUYE"],
  NYARUGENGE:["NYARUGENGE","KIGALI"], GASABO:["GASABO","KIGALI"], KICUKIRO:["KICUKIRO","KIGALI"],
};
function localityMatch(pharmacy, place) {
  const haystack = `${place.city ?? ""} ${place.address ?? ""}`.toUpperCase();
  const aliases = localityAliases[pharmacy.district] ?? [pharmacy.district];
  return aliases.some((alias) => haystack.includes(alias));
}
function cidFromLegacyPlaceId(value) {
  const hex = String(value ?? "").split(":").at(-1);
  if (!/^0x[0-9a-f]+$/i.test(hex)) return "";
  try { return BigInt(hex).toString(10); } catch { return ""; }
}

const fda = parseCsv(await readFile(args.fda, "utf8"));
async function collectFiles(root, relative = "") {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = join(relative, entry.name);
    if (entry.isDirectory() && relative.split("/").length < 2) files.push(...await collectFiles(root, next));
    else if (entry.isFile() && /^(pharmacy_.*|kigali_pharmacies_.*)\.json$/i.test(entry.name)) files.push(next);
  }
  return files;
}
const files = await collectFiles(args.maps);
const placesById = new Map();
for (const file of files) {
  let rows; try { rows = JSON.parse(await readFile(join(args.maps, file), "utf8")); } catch { continue; }
  if (!Array.isArray(rows)) continue;
  for (const place of rows) {
    const key = place.place_id || place.external_id || `${place.name}|${place.phone}|${place.address}`;
    if (place.name && !placesById.has(key)) placesById.set(key, { ...place, source_file: file });
  }
}
const places = [...placesById.values()];
const matched = []; const review = [];
for (const pharmacy of fda) {
  const candidates = places.map((place) => ({ place, score: score(pharmacy.name, place.name) })).sort((a,b) => b.score-a.score);
  const best = candidates[0]; const second = candidates[1];
  const confidence = best?.score ?? 0;
  const localityConfirmed = best ? localityMatch(pharmacy, best.place) : false;
  const status = confidence >= .85 && confidence - (second?.score ?? 0) >= .15 && localityConfirmed ? "name_and_locality_matched" : confidence >= .55 ? "review" : "unmatched";
  const legacyPlaceId = best?.place.place_id ?? best?.place.external_id ?? "";
  const row = { ...pharmacy, match_status: status, match_confidence: confidence.toFixed(3), locality_confirmed: localityConfirmed ? "true" : "false", google_name: best?.place.name ?? "", google_address: best?.place.address ?? "", google_phone: best?.place.phone ?? "", legacy_google_place_id: legacyPlaceId, google_cid: cidFromLegacyPlaceId(legacyPlaceId), google_rating: best?.place.rating ?? "", google_review_count: best?.place.review_count ?? "", google_source_file: best?.place.source_file ?? "" };
  (status === "name_and_locality_matched" ? matched : review).push(row);
}
await mkdir(args.output, { recursive: true });
const columns = [...Object.keys(fda[0]),"match_status","match_confidence","locality_confirmed","google_name","google_address","google_phone","legacy_google_place_id","google_cid","google_rating","google_review_count","google_source_file"];
await writeFile(join(args.output,"pharmacies-map-matched.csv"), csv(matched, columns));
await writeFile(join(args.output,"pharmacies-map-review.csv"), csv(review, columns));
await writeFile(join(args.output,"pharmacies-all.csv"), csv([...matched, ...review].sort((a,b) => Number(a.source_serial)-Number(b.source_serial)), columns));
await writeFile(join(args.output,"map-match-manifest.json"), JSON.stringify({ generated_at:new Date().toISOString(), fda_pharmacies:fda.length, unique_google_places:places.length, automatically_matched:matched.length, needs_review:review.length, note:"Name matching never marks GPS as verified. Google Places detail lookup and human review remain required." }, null, 2) + "\n");
console.log(JSON.stringify({ fda: fda.length, googlePlaces: places.length, matched: matched.length, review: review.length }, null, 2));
