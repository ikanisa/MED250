import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    parsed[value.slice(2)] = next;
    index++;
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const requiredArgs = ["retail-pharmacies", "online-pharmacies", "products"];
const missingArgs = requiredArgs.filter((name) => !args[name]);
if (missingArgs.length > 0) {
  throw new Error("Usage: node load-supabase.mjs --retail-pharmacies <csv> --online-pharmacies <csv> --products <csv> [--chunk-size <number>]");
}

const chunkSize = args["chunk-size"] ? Number(args["chunk-size"]) : 200;
if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) {
  throw new Error("--chunk-size must be an integer between 1 and 1000.");
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in the private execution environment.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function parseCsv(text, sourcePath) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (quoted) throw new Error(`${sourcePath}: unterminated quoted CSV field.`);
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers?.length) throw new Error(`${sourcePath}: CSV is empty.`);
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values, index) => {
      if (values.length !== headers.length) throw new Error(`${sourcePath}: row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
      return Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex]]));
    });
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing required field ${label}.`);
  return normalized;
}

function sourceSerial(value, label) {
  const serial = Number(value);
  if (!Number.isInteger(serial) || serial < 1) throw new Error(`Invalid source serial for ${label}: ${value}`);
  return serial;
}

function nullableOfficialValue(value) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === "—" || normalized === "-" ? null : normalized;
}

function productId(serial) {
  return `rwanda-fda-hm-${String(serial).padStart(4, "0")}`;
}

function pharmacyKey(registryType, serial) {
  return `${registryType}-2026-05-${serial}`;
}

function assertUniqueCanonicalKeys(rows, field, label) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    if (seen.has(row[field])) duplicates.add(row[field]);
    seen.add(row[field]);
  }
  if (duplicates.size > 0) throw new Error(`Duplicate ${label}: ${[...duplicates].join(", ")}`);
}

function buildPharmacyRows(rows, registryType) {
  const online = registryType === "online";
  return rows.map((row, index) => {
    const serial = sourceSerial(row.source_serial, `${registryType} pharmacy CSV row ${index + 2}`);
    return {
      registry_entry_key: pharmacyKey(registryType, serial),
      registry_type: registryType,
      fda_source_serial: serial,
      name: requiredText(row.name, `${registryType} pharmacy ${serial} name`),
      responsible_professional: requiredText(row.technician, `${registryType} pharmacy ${serial} technician`),
      responsible_professional_registration: requiredText(row.council_registration_number, `${registryType} pharmacy ${serial} council registration number`),
      province: requiredText(row.province, `${registryType} pharmacy ${serial} province`),
      district: requiredText(row.district, `${registryType} pharmacy ${serial} district`),
      sector_cell_raw: requiredText(row.sector_cell_raw, `${registryType} pharmacy ${serial} sector/cell`),
      license_expires_on: requiredText(row.license_expiration_date, `${registryType} pharmacy ${serial} license expiration date`),
      online_license_verified: online,
      marketplace_approved: false,
      geocode_status: "pending",
      is_active: true,
      source_name: row.source_name?.trim() || (online ? "Rwanda FDA - Licensed Online Pharmacies May 2026" : "Rwanda FDA - Licensed Human Retail Pharmacies May 2026"),
      source_url: requiredText(row.source_url, `${registryType} pharmacy ${serial} source URL`),
    };
  });
}

const [retailCsv, onlineCsv, productCsv] = await Promise.all([
  readFile(args["retail-pharmacies"], "utf8"),
  readFile(args["online-pharmacies"], "utf8"),
  readFile(args.products, "utf8"),
]);

const retailRows = buildPharmacyRows(parseCsv(retailCsv, args["retail-pharmacies"]), "retail");
const onlineRows = buildPharmacyRows(parseCsv(onlineCsv, args["online-pharmacies"]), "online");
const pharmacyRows = [...retailRows, ...onlineRows];
const refreshedAt = new Date().toISOString();
const productRows = parseCsv(productCsv, args.products).map((row, index) => {
  const serial = sourceSerial(row.source_serial, `product CSV row ${index + 2}`);
  const registrationNumber = requiredText(row.registration_number, `product ${serial} registration number`);
  const brandName = nullableOfficialValue(row.brand_name) ?? nullableOfficialValue(row.generic_name) ?? `Registered medicine (${registrationNumber})`;
  const regulatoryStatus = requiredText(row.regulatory_status, `product ${serial} regulatory status`);
  return {
    id: productId(serial),
    source_register: "rwanda_fda_human_medicinal_products_july_2026",
    source_serial: serial,
    registration_number: registrationNumber,
    brand_name: brandName,
    generic_name: nullableOfficialValue(row.generic_name),
    strength: nullableOfficialValue(row.strength),
    dosage_form: nullableOfficialValue(row.dosage_form),
    pack_size: nullableOfficialValue(row.pack_size),
    shelf_life: nullableOfficialValue(row.shelf_life),
    product_type: "human_medicine",
    category: "Medicines",
    prescription_status: "unclassified",
    regulatory_status: regulatoryStatus,
    manufacturer: nullableOfficialValue(row.manufacturer),
    manufacturer_country: nullableOfficialValue(row.manufacturer_country),
    marketing_authorization_holder: nullableOfficialValue(row.marketing_authorization_holder),
    local_technical_representative: nullableOfficialValue(row.local_technical_representative),
    registration_date: nullableOfficialValue(row.registration_date),
    expiry_date: requiredText(row.expiry_date, `product ${serial} expiry date`),
    image_url: null,
    image_source: null,
    is_orderable: false,
    is_active: !["grace_period", "expired"].includes(regulatoryStatus),
    source_name: row.source_name?.trim() || "Rwanda FDA - Registered Pharmaceutical Products July 2026",
    source_url: requiredText(row.source_url, `product ${serial} source URL`),
    source_refreshed_at: refreshedAt,
  };
});

assertUniqueCanonicalKeys(pharmacyRows, "registry_entry_key", "pharmacy registry_entry_key values");
assertUniqueCanonicalKeys(productRows, "id", "product IDs");

async function upsertInChunks(table, rows, onConflict) {
  let written = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table} import failed for rows ${index + 1}-${index + chunk.length}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

const pharmaciesWritten = await upsertInChunks("dawanear_pharmacies", pharmacyRows, "registry_entry_key");
const productsWritten = await upsertInChunks("dawanear_products", productRows, "id");
console.log(JSON.stringify({ retailPharmaciesWritten: retailRows.length, onlinePharmaciesWritten: onlineRows.length, pharmaciesWritten, productsWritten }, null, 2));
