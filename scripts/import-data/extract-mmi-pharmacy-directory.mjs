import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [registryPath, matchedOutputPath, reviewOutputPath, manifestOutputPath] = process.argv.slice(2);
if (!manifestOutputPath) {
  throw new Error("Usage: node extract-mmi-pharmacy-directory.mjs <fda-registry.csv> <matched.csv> <review.csv> <manifest.json>");
}

const ROOT = "https://www.mmi.gov.rw/partners/pharmacies";

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

function decode(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&").replaceAll("&nbsp;", " ").replaceAll("&#039;", "'")
    .replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function text(value) {
  return decode(value).replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/\b(PHARMACY|PHARMACIE|PHARMA|LIMITED|LTD|RWANDA|RETAIL)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}

function tokens(value) {
  return new Set(normalize(value).split(/\s+/).filter(Boolean));
}

function similarity(left, right) {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const normalized = digits.startsWith("250") ? digits
    : digits.startsWith("0") ? `250${digits.slice(1)}`
      : digits.length === 9 ? `250${digits}` : digits;
  return /^2507[2389][0-9]{7}$/.test(normalized) ? normalized : null;
}

function phones(value) {
  const candidates = String(value ?? "").match(/(?:\+?250|0)?7[2389][0-9]{7}/g) ?? [];
  return [...new Set(candidates.map(normalizePhone).filter(Boolean))];
}

async function fetchPage(url) {
  const response = await fetch(url, { headers: { "user-agent": "MED+250 pharmacy directory verifier/1.0" } });
  if (!response.ok) throw new Error(`MMI directory returned HTTP ${response.status}`);
  return response.text();
}

const pages = new Map();
const queued = new Map([[1, ROOT]]);
for (let page = 1; page <= 30; page += 1) {
  const url = queued.get(page);
  if (!url || pages.has(page)) continue;
  const html = await fetchPage(url);
  pages.set(page, { url, html });
  for (const match of html.matchAll(/href="([^"]*tx_news_pi1%5BcurrentPage%5D=[^"]+)"/g)) {
    const href = decode(match[1]);
    const parsed = new URL(href, ROOT);
    if (parsed.origin !== "https://www.mmi.gov.rw" || parsed.pathname !== "/partners/pharmacies") continue;
    const pageNumber = Number(parsed.searchParams.get("tx_news_pi1[currentPage]"));
    if (Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 30 && !queued.has(pageNumber)) {
      queued.set(pageNumber, parsed.toString());
    }
  }
}
if (pages.size !== 14) throw new Error(`Expected 14 MMI directory pages, discovered ${pages.size}`);

const directoryRows = [];
for (const [page, { url, html }] of [...pages.entries()].sort(([a], [b]) => a - b)) {
  for (const block of html.split('<div class="col-12 mabo8 name txt_content"').slice(1)) {
    const name = text(block.match(/<p class="txt_subtitle_impact[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    const phoneText = text(block.match(/<p>\s*TEL:\s*([^<]+)<\/p>/i)?.[1]);
    const afterName = block.slice(block.indexOf("</p>") + 4);
    const afterNameColumn = afterName.slice(afterName.indexOf("</div>") + 6);
    const area = text(afterNameColumn.match(/<div class="col-md-3 col-sm-3">([\s\S]*?)<\/div>/)?.[1]);
    if (!name || !area || !phoneText) continue;
    for (const e164 of phones(phoneText)) directoryRows.push({ name, area, e164, page, source_url: url });
  }
}
const uniqueDirectoryRows = [...new Map(directoryRows.map((row) => [`${normalize(row.name)}|${normalize(row.area)}|${row.e164}`, row])).values()];
if (uniqueDirectoryRows.length < 100) throw new Error(`MMI directory extraction is unexpectedly incomplete (${uniqueDirectoryRows.length} contacts)`);

const registryBytes = await readFile(registryPath);
const registry = parseCsv(registryBytes.toString("utf8"));
const aliases = new Map([["BUTARE", "HUYE"], ["GISENYI", "RUBAVU"], ["RUHENGERI", "MUSANZE"], ["KIBUYE", "KARONGI"]]);
const locality = (value) => aliases.get(normalize(value)) ?? normalize(value);
const matched = [], review = [];

for (const source of uniqueDirectoryRows) {
  const [sourceDistrict = "", sourceSector = ""] = source.area.split("-").map((value) => locality(value));
  const ranked = registry.map((pharmacy) => {
    const nameScore = similarity(source.name, pharmacy.name);
    const exactName = normalize(source.name) === normalize(pharmacy.name);
    const districtMatch = locality(pharmacy.district) === sourceDistrict;
    const registrySector = locality(String(pharmacy.sector_cell_raw).split(/\s+/)[0]);
    const sectorMatch = Boolean(sourceSector && registrySector === sourceSector);
    const confidence = Math.min(1, (exactName ? .82 : nameScore * .78) + (districtMatch ? .12 : 0) + (sectorMatch ? .06 : 0));
    return { pharmacy, nameScore, exactName, districtMatch, sectorMatch, confidence };
  }).sort((a, b) => b.confidence - a.confidence || Number(a.pharmacy.source_serial) - Number(b.pharmacy.source_serial));
  const best = ranked[0], runner = ranked[1];
  const margin = best.confidence - runner.confidence;
  const sameNameDistrictCandidates = ranked.filter((candidate) =>
    candidate.exactName && candidate.districtMatch && candidate.confidence === best.confidence,
  ).length;
  const accepted = best.districtMatch
    && (best.sectorMatch || sameNameDistrictCandidates === 1)
    && ((best.exactName && margin >= .1) || (best.nameScore >= .85 && margin >= .15));
  const row = {
    registry_entry_key: accepted ? `retail-2026-05-${best.pharmacy.source_serial}` : "",
    registry_pharmacy_name: best.pharmacy.name,
    registry_district: best.pharmacy.district,
    registry_area: best.pharmacy.sector_cell_raw,
    directory_pharmacy_name: source.name,
    directory_area: source.area,
    e164: source.e164,
    source_url: source.source_url,
    source_reference: `MMI pharmacy partner directory page ${source.page}`,
    name_score: best.nameScore.toFixed(3),
    match_confidence: best.confidence.toFixed(3),
    runner_up_confidence: runner.confidence.toFixed(3),
    district_match: best.districtMatch ? "true" : "false",
    sector_match: best.sectorMatch ? "true" : "false",
    review_reason: accepted ? "exact_or_high_name_and_locality" : "ambiguous_or_unmatched",
  };
  (accepted ? matched : review).push(row);
}

const columns = [
  "registry_entry_key", "registry_pharmacy_name", "registry_district", "registry_area",
  "directory_pharmacy_name", "directory_area", "e164", "source_url", "source_reference",
  "name_score", "match_confidence", "runner_up_confidence", "district_match", "sector_match",
  "review_reason",
];
const matchedBytes = Buffer.from(csv(matched, columns));
const reviewBytes = Buffer.from(csv(review, columns));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pageDigests = Object.fromEntries([...pages.entries()].sort(([a], [b]) => a - b)
  .map(([page, value]) => [String(page), { url: value.url, sha256: sha256(value.html) }]));
const manifest = {
  generated_at: new Date().toISOString(),
  source: ROOT,
  source_owner: "Rwanda Military Medical Insurance",
  source_pages: pages.size,
  extracted_contact_rows: uniqueDirectoryRows.length,
  matched_contact_rows: matched.length,
  matched_pharmacies: new Set(matched.map((row) => row.registry_entry_key)).size,
  review_rows: review.length,
  matching_rule: "Unique exact or >=0.85 name match with FDA district and sector evidence; ambiguous branches remain review-only.",
  registry_sha256: sha256(registryBytes),
  matched_sha256: sha256(matchedBytes),
  review_sha256: sha256(reviewBytes),
  page_digests: pageDigests,
};

await Promise.all([
  writeFile(matchedOutputPath, matchedBytes),
  writeFile(reviewOutputPath, reviewBytes),
  writeFile(manifestOutputPath, `${JSON.stringify(manifest, null, 2)}\n`),
]);
console.log(JSON.stringify({
  pages: pages.size,
  extracted: uniqueDirectoryRows.length,
  matchedContacts: matched.length,
  matchedPharmacies: manifest.matched_pharmacies,
  review: review.length,
}, null, 2));
