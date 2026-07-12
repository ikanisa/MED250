import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const pharmacyInput = args.pharmacies;
const productInput = args.products;
const output = args.output ?? "data/imports";
const publicOutput = args["public-output"];
if (!pharmacyInput || !productInput) throw new Error("Usage: node parse-rwanda-fda.mjs --pharmacies <txt> --products <txt> [--output <dir>] [--public-output <dir>]");

const RETAIL_SOURCE_NAME = "Rwanda FDA - Licensed Human Retail Pharmacies May 2026";
const RETAIL_SOURCE_URL = "https://rwandafda.gov.rw/medicines-inspection-licensed-premises/";
const ONLINE_SOURCE_NAME = "Rwanda FDA - Licensed Online Pharmacies May 2026";
const ONLINE_SOURCE_URL = "https://rwandafda.gov.rw/monitoring-tool/documents-management/uploads/1/Licensed-Premises/1781787371_5.%20%20LIST%20OF%20LICENSED%20ONLINE%20PHARMACIES-MAY%2020261.pdf";
const PRODUCT_SOURCE_NAME = "Rwanda FDA - Registered Pharmaceutical Products July 2026";
const PRODUCT_SOURCE_URL = "https://rwandafda.gov.rw/register/monitoring_preview_register";
const PRODUCT_EXPECTED_TOTAL = 2480;
const PRODUCT_EXPECTED_STATUS_COUNTS = Object.freeze({ valid: 2430, expiring_soon: 29, grace_period: 21 });

const onlinePharmacies = [
  { source_serial: 1, name: "AXENTT LIMITED", technician: "Emmanuel Nzabahimana", council_registration_number: "NPC/A1182", province: "Kigali City", district: "Kicukiro", sector_cell_raw: "Gikondo Kanserege", license_expiration_date: "2030-01-27", source_url: ONLINE_SOURCE_URL },
  { source_serial: 2, name: "KASHA RWANDA LTD", technician: "Christian King Musana", council_registration_number: "NPC/A1389", province: "Kigali City", district: "Nyarugenge", sector_cell_raw: "Nyarugenge Kiyovu", license_expiration_date: "2030-06-02", source_url: ONLINE_SOURCE_URL },
  { source_serial: 3, name: "HARAKAMEDS Ltd", technician: "Ishimwe Uwimana Rene", council_registration_number: "NPC/A0829", province: "Kigali City", district: "Kicukiro", sector_cell_raw: "Masaka Cyimo", license_expiration_date: "2030-09-22", source_url: ONLINE_SOURCE_URL },
];

const districts = ["NYARUGENGE","GASABO","KICUKIRO","MUSANZE","BURERA","GAKENKE","GICUMBI","RULINDO","HUYE","NYANZA","MUHANGA","RUHANGO","KAMONYI","NYAMAGABE","NYARUGURU","GISAGARA","KAYONZA","RWAMAGANA","NGOMA","KIREHE","GATSIBO","NYAGATARE","BUGESERA","RUBAVU","KARONGI","RUSIZI","NYAMASHEKE","RUTSIRO","NGORORERO","NYABIHU"];
const pharmacyCorrections = new Map([
  [18, "ADEVA PHARMACY LTD MEDICAL PRODUCTS LEO PATRICK MAZIMPAKA NPC/A1502 EASTERN RWAMAGANA MWULIRE BUSHENYI 12/02/2030"],
  [207, "KARAME PHARMACY LTD MEDICAL PRODUCTS MUTUYIMANA EPIPHANIE NPC/A0849 NORTHERN GICUMBI RUTARE GATWARO 28/05/2030"],
  [516, "NURA PHARMACY LTD MEDICAL PRODUCTS MANIRAKIZA JOHN NPC/A0933 SOUTHERN NYANZA BUSASAMANA NYANZA 02/09/2030"],
  [557, "PHARMACIE LA CHARITE LTD MEDICAL PRODUCTS MUNYAKINDI FAUSTIN NPC/A0276 SOUTHERN MUHANGA NYAMAGABE GAHOGO 11/09/2030"],
  [577, "PHARMACIE IRIS LTD MEDICAL PRODUCTS MUNYENGABE JEAN DAMAS NPC/A0189 KIGALI CITY NYARUGENGE NYARUGENGE KIYOVU 17/09/2030"],
  [600, "NEW SHILOH PHARMACY LTD MEDICAL PRODUCTS MUKESHIMANA MAOMBI NPC/A0909 KIGALI CITY NYARUGENGE NYARUGENGE KIYOVU 18/09/2030"],
  [726, "MEDLINE PHARMACY LTD MEDICAL PRODUCTS ADELINE TUYIKUNDE NPC/A1433 KIGALI CITY NYARUGENGE RWEZAMENYO RWEZAMENYO II 05/01/2031"],
]);

function csv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.map(quote).join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n") + "\n";
}

function clean(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function sourceDateToIso(value) {
  const normalized = clean(value);
  if (!normalized || normalized === "—" || normalized === "-") return "";
  return normalized.split("/").reverse().join("-");
}

function duplicateGroups(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const value = clean(String(row[field] ?? "")).toUpperCase();
    if (!value) continue;
    grouped.set(value, [...(grouped.get(value) ?? []), row.source_serial]);
  }
  return [...grouped.entries()]
    .filter(([, sourceSerials]) => sourceSerials.length > 1)
    .map(([value, sourceSerials]) => ({ value, source_serials: sourceSerials }));
}

function hasExactSerialCoverage(rows, expectedTotal) {
  if (rows.length !== expectedTotal) return false;
  const serials = new Set(rows.map((row) => row.source_serial));
  if (serials.size !== expectedTotal) return false;
  for (let serial = 1; serial <= expectedTotal; serial++) {
    if (!serials.has(serial)) return false;
  }
  return true;
}

function parseDistrict(tokens) {
  for (let width = 1; width <= Math.min(3, tokens.length); width++) {
    const joined = tokens.slice(0, width).join("").replace(/[^A-Z]/g, "");
    const match = districts.find((district) => district === joined);
    if (match) return { district: match, width };
  }
  return { district: tokens[0] ?? "", width: 1 };
}

const pharmacyText = await readFile(pharmacyInput, "utf8");
const body = pharmacyText.split("Markdown Content:").at(-1)
  .replace(/^#.*$/gm, " ")
  .replace(/^SN NAME OF INSTITUTION.*$/gm, " ")
  .replace(/^(TECHNICIAN|COUNCIL|REGISTRATI|ON NUMBER|PROVINCE DISTRICT SECTOR CELL LICENSE|EXPIRATIO|N DATE)\s*$/gm, " ");
const starts = [...body.matchAll(/^\s*(\d+)\.\s+/gm)];
const pharmacies = [];
const pharmacyReview = [];
for (let i = 0; i < starts.length; i++) {
  const serial = Number(starts[i][1]);
  const extracted = clean(body.slice(starts[i].index + starts[i][0].length, starts[i + 1]?.index ?? body.length));
  const raw = pharmacyCorrections.get(serial) ?? extracted;
  const record = raw.match(/^(.*?)\s+MEDICAL\s+PRODUCTS\s+(.*?)\s+(NPC\/A\d+)\s+(KIGALI CITY|EASTERN|NORTHERN|SOUTHERN|WESTERN)\s+(.+?)\s+(\d{2}\/\d{2}\/\d{4})\b/i);
  if (!record) {
    pharmacyReview.push({ serial, raw, reason: "row_pattern_not_recognized" });
    continue;
  }
  const adminTokens = clean(record[5]).toUpperCase().split(" ");
  const parsedDistrict = parseDistrict(adminTokens);
  const name = clean(record[1]).replace(/^F E\s+/i, "");
  pharmacies.push({
    source_serial: serial,
    name,
    technician: clean(record[2]),
    council_registration_number: record[3].toUpperCase(),
    province: record[4].toUpperCase(),
    district: parsedDistrict.district,
    sector_cell_raw: adminTokens.slice(parsedDistrict.width).join(" "),
    license_expiration_date: record[6].split("/").reverse().join("-"),
    source_name: RETAIL_SOURCE_NAME,
    source_url: RETAIL_SOURCE_URL,
    source_file: basename(pharmacyInput),
  });
}

const productText = await readFile(productInput, "utf8");
const products = [];
const productParseErrors = [];
function decodeHtml(value) {
  const named = { amp:"&", quot:'"', apos:"'", lt:"<", gt:">", nbsp:" " };
  return value.replace(/<[^>]+>/g, " ").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}
function addProduct(cells, regulatoryStatus, sourceSerial) {
  if (cells.length !== 14) {
    productParseErrors.push({ source_serial: sourceSerial, reason: `expected_14_cells_received_${cells.length}` });
    return;
  }
  const [, registrationNumber, brandName, genericName, strength, dosageForm, packSize, shelfLife, manufacturer, country, authorizationHolder, localRepresentative, registrationDate, expiryDate] = cells.map(clean);
  products.push({
    source_serial: sourceSerial,
    registration_number: clean(registrationNumber),
    brand_name: clean(brandName),
    generic_name: clean(genericName),
    strength: clean(strength),
    dosage_form: clean(dosageForm),
    pack_size: clean(packSize),
    shelf_life: clean(shelfLife),
    manufacturer: clean(manufacturer),
    manufacturer_country: clean(country),
    marketing_authorization_holder: clean(authorizationHolder),
    local_technical_representative: clean(localRepresentative),
    registration_date: sourceDateToIso(registrationDate),
    expiry_date: sourceDateToIso(expiryDate),
    regulatory_status: regulatoryStatus,
    source_name: PRODUCT_SOURCE_NAME,
    source_url: PRODUCT_SOURCE_URL,
  });
}
if (productText.includes('class="hm-reg-row')) {
  let sourceSerial = 0;
  const statusBySourceValue = { valid: "valid", soon: "expiring_soon", expired: "grace_period" };
  for (const match of productText.matchAll(/<tr class="hm-reg-row[^>]*data-expiry="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    sourceSerial++;
    const status = statusBySourceValue[match[1]];
    if (!status) productParseErrors.push({ source_serial: sourceSerial, reason: `unexpected_source_status_${match[1]}` });
    const cells = [...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeHtml(cell[1]));
    const displaySerial = Number(clean(cells[0] ?? ""));
    if (displaySerial !== 0 && displaySerial !== sourceSerial) {
      productParseErrors.push({ source_serial: sourceSerial, reason: `unexpected_display_serial_${displaySerial}` });
    }
    addProduct(cells, status, sourceSerial);
  }
} else {
  for (const line of productText.split(/\r?\n/)) {
    if (!/^\d+\t/.test(line)) continue;
    const cells = line.split("\t");
    addProduct(cells, "valid", Number(cells[0]));
  }
}

const productStatusCounts = Object.fromEntries(Object.keys(PRODUCT_EXPECTED_STATUS_COUNTS).map((status) => [status, products.filter((row) => row.regulatory_status === status).length]));
const productDuplicateRegistrations = duplicateGroups(products, "registration_number");
const retailDuplicateRegistrations = duplicateGroups(pharmacies, "council_registration_number");
const productCompletenessChecks = {
  expected_row_count: products.length === PRODUCT_EXPECTED_TOTAL,
  sequential_source_serials: hasExactSerialCoverage(products, PRODUCT_EXPECTED_TOTAL),
  all_rows_have_registration_numbers: products.every((row) => row.registration_number.length > 0),
  all_rows_have_product_names: products.every((row) => row.brand_name.length > 0 || row.generic_name.length > 0),
  all_dates_valid: products.every((row) => (!row.registration_date || isIsoDate(row.registration_date)) && isIsoDate(row.expiry_date)),
  expected_status_counts: Object.entries(PRODUCT_EXPECTED_STATUS_COUNTS).every(([status, count]) => productStatusCounts[status] === count),
  every_html_row_parsed: productParseErrors.length === 0,
};
const retailCompletenessChecks = {
  every_source_row_parsed: pharmacyReview.length === 0 && pharmacies.length === starts.length,
  sequential_source_serials: hasExactSerialCoverage(pharmacies, starts.length),
  all_required_fields_present: pharmacies.every((row) => ["name", "technician", "council_registration_number", "province", "district", "sector_cell_raw", "source_url"].every((field) => row[field]?.length > 0)),
  all_dates_valid: pharmacies.every((row) => isIsoDate(row.license_expiration_date)),
};
const onlineCompletenessChecks = {
  expected_row_count: onlinePharmacies.length === 3,
  sequential_source_serials: hasExactSerialCoverage(onlinePharmacies, 3),
  all_required_fields_present: onlinePharmacies.every((row) => ["name", "technician", "council_registration_number", "province", "district", "sector_cell_raw", "source_url"].every((field) => row[field]?.length > 0)),
  all_dates_valid: onlinePharmacies.every((row) => isIsoDate(row.license_expiration_date)),
};
const failedChecks = [
  ...Object.entries(productCompletenessChecks).filter(([, passed]) => !passed).map(([check]) => `products.${check}`),
  ...Object.entries(retailCompletenessChecks).filter(([, passed]) => !passed).map(([check]) => `retail_pharmacies.${check}`),
  ...Object.entries(onlineCompletenessChecks).filter(([, passed]) => !passed).map(([check]) => `online_pharmacies.${check}`),
];
if (failedChecks.length > 0) {
  throw new Error(`Official-data completeness validation failed: ${failedChecks.join(", ")}${productParseErrors.length ? `; parse errors: ${JSON.stringify(productParseErrors.slice(0, 10))}` : ""}`);
}

await mkdir(output, { recursive: true });
const pharmacyColumns = ["source_serial","name","technician","council_registration_number","province","district","sector_cell_raw","license_expiration_date","source_name","source_url","source_file"];
const publicPharmacyColumns = ["source_serial","name","technician","council_registration_number","province","district","sector_cell_raw","license_expiration_date","source_url"];
const productColumns = ["source_serial","registration_number","brand_name","generic_name","strength","dosage_form","pack_size","shelf_life","manufacturer","manufacturer_country","marketing_authorization_holder","local_technical_representative","registration_date","expiry_date","regulatory_status","source_name","source_url"];
await writeFile(`${output}/rwanda-fda-retail-pharmacies-may-2026.csv`, csv(pharmacies, pharmacyColumns));
await writeFile(`${output}/rwanda-fda-retail-pharmacies-review.csv`, csv(pharmacyReview, ["serial","reason","raw"]));
await writeFile(`${output}/rwanda-fda-online-pharmacies-may-2026.csv`, csv(onlinePharmacies, publicPharmacyColumns));
await writeFile(`${output}/rwanda-fda-products-july-2026.csv`, csv(products, productColumns));
await writeFile(`${output}/source-manifest.json`, JSON.stringify({
  generated_at: new Date().toISOString(),
  retail_pharmacies: { official_total: starts.length, parsed: pharmacies.length, review: pharmacyReview.length, source: pharmacyInput, source_name: RETAIL_SOURCE_NAME, source_url: RETAIL_SOURCE_URL, completeness_checks: retailCompletenessChecks, completeness: "complete", duplicate_professional_registration_numbers: retailDuplicateRegistrations },
  online_pharmacies: { official_total: 3, extracted: onlinePharmacies.length, source_name: ONLINE_SOURCE_NAME, source_url: ONLINE_SOURCE_URL, completeness_checks: onlineCompletenessChecks, completeness: "complete" },
  products: { official_total: PRODUCT_EXPECTED_TOTAL, official_valid: PRODUCT_EXPECTED_STATUS_COUNTS.valid, official_expiring_soon: PRODUCT_EXPECTED_STATUS_COUNTS.expiring_soon, official_grace_period: PRODUCT_EXPECTED_STATUS_COUNTS.grace_period, extracted: products.length, unique_registration_numbers: products.length - productDuplicateRegistrations.reduce((total, group) => total + group.source_serials.length - 1, 0), status_counts: productStatusCounts, source: productInput, source_name: PRODUCT_SOURCE_NAME, source_url: PRODUCT_SOURCE_URL, completeness_checks: productCompletenessChecks, completeness: "complete", duplicate_registration_numbers: productDuplicateRegistrations },
}, null, 2) + "\n");
if (publicOutput) {
  await mkdir(publicOutput, { recursive: true });
  await writeFile(`${publicOutput}/rwanda-fda-pharmacies-may-2026.csv`, csv(pharmacies, publicPharmacyColumns));
  await writeFile(`${publicOutput}/rwanda-fda-online-pharmacies-may-2026.csv`, csv(onlinePharmacies, publicPharmacyColumns));
  await writeFile(`${publicOutput}/rwanda-fda-products-july-2026.csv`, csv(products, productColumns));
}
console.log(JSON.stringify({ retailPharmacies: pharmacies.length, retailPharmacyReview: pharmacyReview.length, onlinePharmacies: onlinePharmacies.length, products: products.length, duplicateProductRegistrationNumbers: productDuplicateRegistrations.length, output, publicOutput: publicOutput ?? null }, null, 2));
