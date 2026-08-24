import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DASHBOARD_RECOVERY_SCHEMA = "med250.dashboard-recovery.v1";
export const MED250_SUPABASE_PROJECT_REF = "uskfnszcdqpcfrhjxitl";
const MAX_SOURCE_FILE_BYTES = 256 * 1024 * 1024;
const MAX_SQL_STATEMENT_BYTES = 90_000;
const MAX_ROWS_PER_TABLE = 1_000_000;
const VALID_TARGETS = new Set(["staging", "production"]);

const SENSITIVE_TABLES = new Map([
  ["dawanear_customer_otp_challenges", "expired OTP hashes and rate-limit fingerprints must not leave Supabase"],
  ["dawanear_pharmacy_otp_challenges", "expired OTP hashes and authentication material must not leave Supabase"],
  ["dawanear_pharmacy_identities", "legacy authentication identities are replaced by fresh Cloudflare sessions"],
  ["auth_users", "Supabase authentication records and credential metadata must not be exported"],
  ["auth_sessions", "Supabase sessions must be invalidated, not migrated"],
  ["auth_refresh_tokens", "Supabase refresh tokens must never be migrated"],
]);

const TABLE_POLICIES = Object.freeze({
  dawanear_customer_profiles: { key: ["user_id"], canonical: "clients" },
  dawanear_pharmacies: { key: ["id"], canonical: "pharmacies" },
  dawanear_pharmacy_memberships: { key: ["id"], canonical: "raw_only" },
  dawanear_pharmacy_claims: { key: ["id"], canonical: "raw_only" },
  dawanear_products: { key: ["id"], canonical: "catalogue" },
  dawanear_marketplace_products: { key: ["id"], canonical: "raw_only" },
  dawanear_marketplace_product_reviews: { key: ["id"], canonical: "raw_only" },
  dawanear_product_description_reviews: { key: ["id"], canonical: "raw_only" },
  dawanear_product_images: { key: ["product_id", "position"], canonical: "catalogue_media_metadata" },
  dawanear_pharmacy_prices: { key: ["id"], canonical: "raw_only" },
  dawanear_orders: { key: ["id"], canonical: "orders" },
  dawanear_order_items: { key: ["id"], canonical: "order_items" },
  dawanear_order_recipients: { key: ["order_id", "pharmacy_id"], canonical: "recipients" },
  dawanear_pharmacy_notifications: { key: ["id"], canonical: "raw_only" },
  dawanear_offers: { key: ["id"], canonical: "offers" },
  dawanear_offer_items: { key: ["id"], canonical: "offer_items" },
  dawanear_pharmacy_contacts: { key: ["id"], canonical: "pharmacy_contacts" },
  dawanear_pharmacy_contact_edit_requests: { key: ["id"], canonical: "raw_only" },
  dawanear_whatsapp_outbox: { key: ["id"], canonical: "raw_only_no_replay" },
  dawanear_central_price_contributions: { key: ["id"], canonical: "central_price_audit" },
  dawanear_public_metric_approvals: { key: ["metric_key"], canonical: "metric_approvals" },
  dawanear_maintenance_state: { key: ["task_key"], canonical: "raw_only" },
  dawanear_maintenance_runs: { key: ["id"], canonical: "raw_only" },
});

const REQUIRED_TABLES = Object.freeze([
  "dawanear_pharmacies",
  "dawanear_pharmacy_contacts",
  "dawanear_products",
]);

const CANONICAL_INSERT_ORDER = Object.freeze([
  "med250_pharmacies",
  "med250_pharmacy_contacts",
  "med250_known_pharmacy_numbers",
  "med250_catalogue_products",
  "med250_product_images",
  "med250_actors",
  "med250_web_principals",
  "med250_client_locations",
  "med250_client_requests",
  "med250_web_order_items",
  "med250_request_recipients",
  "med250_marketplace_offers",
  "med250_marketplace_offer_items",
  "med250_catalogue_price_contributions",
  "med250_public_metric_approvals",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stableJson(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, space);
}

function exactIso(value, field) {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function exactProjectRef(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized !== MED250_SUPABASE_PROJECT_REF) {
    throw new Error(`Source project ref must be the MED250 project ${MED250_SUPABASE_PROJECT_REF}.`);
  }
  return normalized;
}

function exactTarget(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!VALID_TARGETS.has(normalized)) throw new Error("Target must be staging or production.");
  return normalized;
}

function csvCell(value, quoted) {
  return value === "" && !quoted ? null : value;
}

export function parseDashboardCsv(source) {
  if (typeof source !== "string" || source.includes("\0")) throw new Error("Dashboard CSV is invalid.");
  const parsedRows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let fieldQuoted = false;
  let afterQuote = false;
  let sawAny = false;

  const finishField = () => {
    row.push({ value: field, quoted: fieldQuoted });
    field = "";
    fieldQuoted = false;
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    parsedRows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    sawAny = true;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (afterQuote) {
      if (character === ",") finishField();
      else if (character === "\n") finishRow();
      else if (character === "\r" && source[index + 1] === "\n") {
        finishRow();
        index += 1;
      } else {
        throw new Error("Dashboard CSV has characters after a closing quote.");
      }
      continue;
    }
    if (character === '"') {
      if (field !== "") throw new Error("Dashboard CSV has an unexpected quote.");
      quoted = true;
      fieldQuoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r" && source[index + 1] === "\n") {
      finishRow();
      index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Dashboard CSV has an unterminated quoted field.");
  if (afterQuote || field !== "" || fieldQuoted || row.length > 0 || (sawAny && !source.endsWith("\n"))) finishRow();
  while (parsedRows.length && parsedRows.at(-1).every((cell) => cell.value === "" && !cell.quoted)) parsedRows.pop();
  if (!parsedRows.length) throw new Error("Dashboard CSV has no header row.");

  const headers = parsedRows[0].map((cell) => cell.value.trim());
  if (headers.some((header) => !/^[a-z][a-z0-9_]{0,62}$/.test(header))) {
    throw new Error("Dashboard CSV contains an invalid column header.");
  }
  if (new Set(headers).size !== headers.length) throw new Error("Dashboard CSV contains duplicate headers.");
  const rows = [];
  for (let index = 1; index < parsedRows.length; index += 1) {
    const cells = parsedRows[index];
    if (cells.length !== headers.length) throw new Error(`Dashboard CSV row ${index + 1} has the wrong column count.`);
    if (cells.every((cell) => cell.value === "" && !cell.quoted)) continue;
    rows.push({
      rowNumber: index + 1,
      payload: Object.fromEntries(headers.map((header, position) => [header, csvCell(cells[position].value, cells[position].quoted)])),
    });
  }
  if (rows.length > MAX_ROWS_PER_TABLE) throw new Error("Dashboard CSV exceeds the one-million-row recovery limit.");
  return { headers, rows };
}

function tablePolicy(table, headers) {
  const configured = TABLE_POLICIES[table];
  if (configured) return configured;
  const key = headers.includes("id") ? ["id"] : [headers[0]];
  return { key, canonical: "raw_only_unknown" };
}

function sourceKey(payload, columns, rowNumber) {
  const values = columns.map((column) => payload[column]);
  if (values.some((value) => value === null || value === undefined || String(value).length === 0)) {
    throw new Error(`Dashboard CSV row ${rowNumber} is missing its source key.`);
  }
  const key = values.map(String).join("|");
  if (key.length > 500) throw new Error(`Dashboard CSV row ${rowNumber} has an oversized source key.`);
  return key;
}

async function loadCsvFile(filePath, table) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${table} is not a bounded dashboard CSV file.`);
  }
  const bytes = await readFile(filePath);
  const parsed = parseDashboardCsv(bytes.toString("utf8"));
  const policy = tablePolicy(table, parsed.headers);
  for (const column of policy.key) {
    if (!parsed.headers.includes(column)) throw new Error(`${table} is missing source key column ${column}.`);
  }
  const keys = new Set();
  const rows = parsed.rows.map((row) => {
    const key = sourceKey(row.payload, policy.key, row.rowNumber);
    if (keys.has(key)) throw new Error(`${table} contains duplicate source key ${key}.`);
    keys.add(key);
    return { ...row, sourceKey: key, payloadSha256: sha256(stableJson(row.payload)) };
  });
  return { bytes, headers: parsed.headers, rows, policy };
}

export async function prepareDashboardManifest({ sourceDir, projectRef, exportedAt, outputPath }) {
  const sourceDirectory = resolve(sourceDir);
  const normalizedProjectRef = exactProjectRef(projectRef);
  const normalizedExportedAt = exactIso(exportedAt, "exported-at");
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".csv")
    .sort((left, right) => left.name.localeCompare(right.name));
  if (!entries.length || entries.length > 100) throw new Error("Recovery source must contain between 1 and 100 CSV exports.");

  const tables = [];
  const seenTables = new Set();
  for (const entry of entries) {
    const table = basename(entry.name, extname(entry.name));
    if (!/^dawanear_[a-z0-9_]{1,80}$/.test(table)) throw new Error(`${entry.name} must be named after its Supabase table.`);
    if (SENSITIVE_TABLES.has(table)) throw new Error(`${table} is prohibited: ${SENSITIVE_TABLES.get(table)}.`);
    if (seenTables.has(table)) throw new Error(`Recovery source contains duplicate table ${table}.`);
    seenTables.add(table);
    const loaded = await loadCsvFile(join(sourceDirectory, entry.name), table);
    tables.push({
      source_table: table,
      file_name: entry.name,
      content_sha256: sha256(loaded.bytes),
      row_count: loaded.rows.length,
      headers: loaded.headers,
      source_key_columns: loaded.policy.key,
      canonical_policy: loaded.policy.canonical,
    });
  }
  for (const required of REQUIRED_TABLES) {
    if (!seenTables.has(required)) throw new Error(`Recovery source is missing required table ${required}.`);
  }
  const sourceSnapshotSha256 = sha256(stableJson({
    schema_version: DASHBOARD_RECOVERY_SCHEMA,
    source_project_ref: normalizedProjectRef,
    exported_at: normalizedExportedAt,
    tables,
  }));
  const manifest = {
    schema_version: DASHBOARD_RECOVERY_SCHEMA,
    source_platform: "supabase_dashboard_csv",
    source_project_ref: normalizedProjectRef,
    exported_at: normalizedExportedAt,
    source_snapshot_sha256: sourceSnapshotSha256,
    prohibited_tables: Object.fromEntries(SENSITIVE_TABLES),
    tables,
  };
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, `${stableJson(manifest, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function textValue(payload, name, { required = false, maximum = 10_000 } = {}) {
  const value = payload[name];
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  const result = String(value).trim();
  if (!result && required) throw new Error(`${name} is required.`);
  if (result.length > maximum) throw new Error(`${name} exceeds ${maximum} characters.`);
  return result || null;
}

function booleanValue(payload, name, fallback = false) {
  const value = payload[name];
  if (value === null || value === undefined || value === "") return fallback;
  if (value === true || value === 1 || /^(true|t|1|yes)$/i.test(String(value))) return true;
  if (value === false || value === 0 || /^(false|f|0|no)$/i.test(String(value))) return false;
  throw new Error(`${name} is not a boolean.`);
}

function numberValue(payload, name, { integer = false, minimum = -Infinity, maximum = Infinity, fallback = null } = {}) {
  const value = payload[name];
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed)) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its supported numeric range.`);
  }
  return parsed;
}

function timestampValue(payload, name, fallback = null) {
  const value = textValue(payload, name);
  return value ? exactIso(value, name) : fallback;
}

function dateValue(payload, name) {
  const value = textValue(payload, name);
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match || !Number.isFinite(Date.parse(`${match[0]}T00:00:00Z`))) throw new Error(`${name} is not a date.`);
  return match[0];
}

function normalizedE164(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

export function parsePostgisPoint(value) {
  if (value === null || value === undefined || value === "") return null;
  const source = String(value).trim();
  const point = source.match(/^(?:SRID=4326;)?POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
  if (point) return { longitude: Number(point[1]), latitude: Number(point[2]) };
  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      if (parsed?.type === "Point" && Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
        return { longitude: Number(parsed.coordinates[0]), latitude: Number(parsed.coordinates[1]) };
      }
    } catch {
      return null;
    }
  }
  if (/^[0-9a-f]+$/i.test(source) && source.length >= 42 && source.length % 2 === 0) {
    try {
      const bytes = Buffer.from(source, "hex");
      const littleEndian = bytes[0] === 1;
      if (!littleEndian && bytes[0] !== 0) return null;
      const type = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
      let offset = 5;
      if ((type & 0x20000000) !== 0) offset += 4;
      if ((type & 0xff) !== 1 || bytes.length < offset + 16) return null;
      const longitude = littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
      const latitude = littleEndian ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8);
      return { longitude, latitude };
    } catch {
      return null;
    }
  }
  return null;
}

function validRwandaPoint(point) {
  return point && point.latitude >= -3 && point.latitude <= -0.8 && point.longitude >= 28.7 && point.longitude <= 30.9;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("SQL numeric value is invalid.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  const string = String(value);
  if (string.includes("\0")) throw new Error("SQL text contains a null byte.");
  return `'${string.replaceAll("'", "''")}'`;
}

function renderInsertStatements(table, columns, rows) {
  if (!rows.length) return [];
  const prefix = `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n`;
  const statements = [];
  let tuples = [];
  let size = Buffer.byteLength(prefix) + 2;
  const flush = () => {
    if (tuples.length) statements.push(`${prefix}${tuples.join(",\n")};`);
    tuples = [];
    size = Buffer.byteLength(prefix) + 2;
  };
  for (const row of rows) {
    const tuple = `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`;
    const tupleBytes = Buffer.byteLength(tuple) + 2;
    if (Buffer.byteLength(prefix) + tupleBytes > MAX_SQL_STATEMENT_BYTES) {
      throw new Error(`${table} contains a row that exceeds the safe D1 statement limit.`);
    }
    if (tuples.length && (size + tupleBytes > MAX_SQL_STATEMENT_BYTES || tuples.length >= 100)) flush();
    tuples.push(tuple);
    size += tupleBytes;
  }
  flush();
  return statements;
}

function sourceRows(tables, name) {
  return tables.get(name)?.rows ?? [];
}

function recoveryActorId(e164) {
  return `recovery-client-${sha256(`client:${e164}`).slice(0, 32)}`;
}

function recoveryLocationId(orderId) {
  return `recovery-location-${sha256(`order-location:${orderId}`).slice(0, 32)}`;
}

function mapOrderStatus(value) {
  return ({
    draft: "ready",
    broadcast: "dispatched",
    offers_received: "dispatched",
    selected: "selected",
    completed: "completed",
    cancelled: "cancelled",
    expired: "expired",
  })[value] ?? null;
}

function productDepartment(category) {
  const normalized = String(category ?? "").trim();
  if (/medicine/i.test(normalized)) return "Medicines";
  if (/personal|beauty/i.test(normalized)) return "Personal care";
  if (/baby|family/i.test(normalized)) return "Baby & family";
  if (/wellness|health|household/i.test(normalized)) return "Wellness";
  return normalized || "Medicines";
}

function addWarning(state, sourceTable, code, count = 1, skipped = true) {
  state.warningCounts[code] = (state.warningCounts[code] ?? 0) + count;
  if (skipped) state.skippedRowCounts[sourceTable] = (state.skippedRowCounts[sourceTable] ?? 0) + count;
}

function canonicalState() {
  return {
    tables: new Map(CANONICAL_INSERT_ORDER.map((table) => [table, []])),
    warningCounts: {},
    skippedRowCounts: {},
  };
}

function buildCanonicalRows(source, manifest) {
  const state = canonicalState();
  const exportedAt = manifest.exported_at;
  const exportedDate = exportedAt.slice(0, 10);
  const pharmacySources = sourceRows(source, "dawanear_pharmacies");
  const contactSources = sourceRows(source, "dawanear_pharmacy_contacts");
  const productSources = sourceRows(source, "dawanear_products");

  const pharmacyInput = new Map();
  for (const sourceRow of pharmacySources) {
    const row = sourceRow.payload;
    const id = textValue(row, "id", { required: true, maximum: 100 });
    if (pharmacyInput.has(id)) throw new Error(`Duplicate pharmacy id ${id}.`);
    const point = parsePostgisPoint(row.location);
    if (row.location && !validRwandaPoint(point)) throw new Error(`Pharmacy ${id} has an unsupported location value.`);
    pharmacyInput.set(id, { row, id, point });
  }

  const contactCandidates = [];
  const numberPharmacies = new Map();
  for (const sourceRow of contactSources) {
    const row = sourceRow.payload;
    const id = textValue(row, "id", { required: true, maximum: 100 });
    const pharmacyId = textValue(row, "pharmacy_id", { required: true, maximum: 100 });
    if (!pharmacyInput.has(pharmacyId)) throw new Error(`Contact ${id} references an unknown pharmacy.`);
    const channel = textValue(row, "contact_type", { required: true, maximum: 20 });
    if (!new Set(["phone", "whatsapp"]).has(channel)) throw new Error(`Contact ${id} has an unsupported channel.`);
    const e164 = normalizedE164(row.e164);
    if (!e164) throw new Error(`Contact ${id} has an invalid E.164 number.`);
    const verificationStatus = textValue(row, "verification_status", { required: true, maximum: 40 });
    const sourceActive = !new Set(["rejected", "stale"]).has(verificationStatus);
    const verifiedAt = timestampValue(row, "verified_at");
    const verified = sourceActive && verifiedAt !== null
      && new Set(["source_verified", "admin_verified"]).has(verificationStatus);
    const candidate = { row, id, pharmacyId, channel, e164, sourceActive, verified, verifiedAt, verificationStatus };
    contactCandidates.push(candidate);
    if (channel === "whatsapp") {
      const set = numberPharmacies.get(e164) ?? new Set();
      if (sourceActive) set.add(pharmacyId);
      numberPharmacies.set(e164, set);
    }
  }

  const ambiguousNumbers = new Set([...numberPharmacies].filter(([, ids]) => ids.size > 1).map(([e164]) => e164));
  const dispatchContactsByPharmacy = new Map();
  const primaryDispatchByPharmacy = new Map();
  for (const candidate of contactCandidates) {
    const ambiguous = ambiguousNumbers.has(candidate.e164);
    const active = candidate.sourceActive && !ambiguous;
    const loginEnabled = active && candidate.channel === "whatsapp" && candidate.verified
      && booleanValue(candidate.row, "is_login_enabled", false);
    const dispatchEnabled = loginEnabled;
    const isPrimary = active && booleanValue(candidate.row, "is_primary", false);
    const mapped = {
      id: candidate.id,
      pharmacy_id: candidate.pharmacyId,
      channel: candidate.channel,
      e164: candidate.e164,
      address: null,
      verified_at: candidate.verifiedAt,
      source: textValue(candidate.row, "source_name", { maximum: 500 })
        ?? textValue(candidate.row, "source_type", { maximum: 100 }) ?? "Supabase dashboard recovery",
      source_url: textValue(candidate.row, "source_url", { maximum: 2_000 }),
      source_reference: textValue(candidate.row, "source_reference", { maximum: 1_000 }),
      source_observed_at: timestampValue(candidate.row, "source_observed_at"),
      login_enabled: loginEnabled,
      dispatch_enabled: dispatchEnabled,
      is_primary: isPrimary,
      active,
      created_at: timestampValue(candidate.row, "created_at", exportedAt),
      updated_at: timestampValue(candidate.row, "updated_at", exportedAt),
      verified_by_label: textValue(candidate.row, "verified_by_label", { maximum: 200 }),
      verification_note: textValue(candidate.row, "verification_note", { maximum: 4_000 }),
      derived_from_contact_id: textValue(candidate.row, "derived_from_contact_id", { maximum: 100 }),
    };
    state.tables.get("med250_pharmacy_contacts").push(mapped);
    if (dispatchEnabled) {
      const list = dispatchContactsByPharmacy.get(candidate.pharmacyId) ?? [];
      list.push(mapped);
      dispatchContactsByPharmacy.set(candidate.pharmacyId, list);
      if (isPrimary || !primaryDispatchByPharmacy.has(candidate.pharmacyId)) primaryDispatchByPharmacy.set(candidate.pharmacyId, mapped);
    }
  }
  const mappedContacts = state.tables.get("med250_pharmacy_contacts");
  const mappedContactById = new Map(mappedContacts.map((row) => [row.id, row]));
  const contactDepth = new Map();
  const visitingContacts = new Set();
  const depthOfContact = (row) => {
    if (contactDepth.has(row.id)) return contactDepth.get(row.id);
    if (visitingContacts.has(row.id)) throw new Error("Pharmacy contact derivation contains a cycle.");
    visitingContacts.add(row.id);
    let depth = 0;
    if (row.derived_from_contact_id) {
      const parent = mappedContactById.get(row.derived_from_contact_id);
      if (!parent) {
        row.derived_from_contact_id = null;
        addWarning(state, "dawanear_pharmacy_contacts", "contact_derivation_parent_not_recovered", 1, false);
      } else {
        depth = depthOfContact(parent) + 1;
      }
    }
    visitingContacts.delete(row.id);
    contactDepth.set(row.id, depth);
    return depth;
  };
  mappedContacts.sort((left, right) => depthOfContact(left) - depthOfContact(right) || left.id.localeCompare(right.id));

  for (const [e164, pharmacyIds] of [...numberPharmacies].sort(([left], [right]) => left.localeCompare(right))) {
    const ids = [...pharmacyIds].sort();
    const retired = ids.length === 0;
    const ambiguous = ids.length > 1;
    state.tables.get("med250_known_pharmacy_numbers").push({
      e164,
      resolution_status: retired ? "retired" : ambiguous ? "ambiguous" : "resolved",
      pharmacy_id: ids.length === 1 ? ids[0] : null,
      source: "supabase_dashboard_recovery",
      source_evidence: stableJson({ import_snapshot: manifest.source_snapshot_sha256, pharmacy_ids: ids }),
      reviewed_at: ambiguous ? null : exportedAt,
      created_at: exportedAt,
      updated_at: exportedAt,
    });
  }

  const pharmacyRows = state.tables.get("med250_pharmacies");
  for (const { row, id, point } of pharmacyInput.values()) {
    const active = booleanValue(row, "is_active", true);
    const licenceExpiry = dateValue(row, "license_expires_on");
    const licenceStatus = !active ? "suspended" : licenceExpiry && licenceExpiry < exportedDate ? "expired" : licenceExpiry ? "current" : "pending";
    const sourceGeocodeStatus = textValue(row, "geocode_status", { maximum: 30 }) ?? "pending";
    const geocodeStatus = sourceGeocodeStatus === "verified" && validRwandaPoint(point) ? "verified" : sourceGeocodeStatus === "rejected" ? "rejected" : sourceGeocodeStatus === "candidate" ? "candidate" : "pending";
    const dispatchEnabled = active && licenceStatus === "current" && geocodeStatus === "verified"
      && booleanValue(row, "marketplace_approved", false)
      && (dispatchContactsByPharmacy.get(id)?.length ?? 0) > 0;
    const registryType = textValue(row, "registry_type", { maximum: 30 });
    pharmacyRows.push({
      id,
      name: textValue(row, "name", { required: true, maximum: 180 }),
      latitude: validRwandaPoint(point) ? point.latitude : null,
      longitude: validRwandaPoint(point) ? point.longitude : null,
      licence_status: licenceStatus,
      licence_expires_on: licenceExpiry,
      licence_number: textValue(row, "license_number", { maximum: 200 }),
      address: textValue(row, "google_formatted_address", { maximum: 1_000 }) ?? textValue(row, "sector_cell_raw", { maximum: 1_000 }),
      google_maps_url: textValue(row, "google_maps_url", { maximum: 2_000 }),
      momo_code: textValue(row, "momo_code", { maximum: 64 }),
      marketplace_approved: booleanValue(row, "marketplace_approved", false),
      dispatch_enabled: dispatchEnabled,
      registry_entry_key: textValue(row, "registry_entry_key", { maximum: 300 }),
      registry_type: new Set(["retail", "online"]).has(registryType) ? registryType : null,
      fda_source_serial: numberValue(row, "fda_source_serial", { integer: true, minimum: 1 }),
      responsible_professional: textValue(row, "responsible_professional", { maximum: 500 }),
      responsible_professional_registration: textValue(row, "responsible_professional_registration", { maximum: 200 }),
      province: textValue(row, "province", { maximum: 200 }),
      district: textValue(row, "district", { maximum: 200 }),
      sector_cell_raw: textValue(row, "sector_cell_raw", { maximum: 1_000 }),
      source_name: textValue(row, "source_name", { maximum: 500 }),
      source_url: textValue(row, "source_url", { maximum: 2_000 }),
      geocode_status: geocodeStatus,
      geocode_provider: (() => {
        const provider = textValue(row, "geocode_provider", { maximum: 50 });
        return new Set(["google_places", "government_gis", "governed_registry_import"]).has(provider) ? provider : null;
      })(),
      geocode_reference: textValue(row, "geocode_source_id", { maximum: 500 }) ?? textValue(row, "geocode_review_place_id", { maximum: 500 }),
      geocode_formatted_address: textValue(row, "google_formatted_address", { maximum: 1_000 }),
      geocode_confidence: numberValue(row, "location_confidence", { minimum: 0, maximum: 1 }),
      geocode_checked_at: timestampValue(row, "geocode_checked_at"),
      geocode_reviewed_by: textValue(row, "geocode_reviewed_by", { maximum: 200 }),
      geocode_reviewed_at: timestampValue(row, "geocode_reviewed_at"),
      geocode_review_note: textValue(row, "geocode_review_note", { maximum: 4_000 }),
      created_at: timestampValue(row, "created_at", exportedAt),
      updated_at: timestampValue(row, "updated_at", exportedAt),
    });
  }

  const products = new Map();
  for (const sourceRow of productSources) {
    const row = sourceRow.payload;
    const id = textValue(row, "id", { required: true, maximum: 80 });
    const prescription = textValue(row, "prescription_status", { maximum: 40 }) ?? "unclassified";
    const prescriptionStatus = new Set(["prescription", "non_prescription", "pharmacist_only", "not_applicable", "unclassified"]).has(prescription)
      ? prescription : "unclassified";
    const category = textValue(row, "category", { maximum: 200 }) ?? "Medicines";
    const productType = textValue(row, "product_type", { maximum: 100 }) ?? "human_medicine";
    const sourceRegister = textValue(row, "source_register", { maximum: 200 });
    const descriptionApproved = booleanValue(row, "description_approved", false);
    const mapped = {
      id,
      source_kind: /rwanda fda/i.test(textValue(row, "source_name", { maximum: 500 }) ?? "") || /fda/i.test(sourceRegister ?? "")
        ? "rwanda_fda" : productType === "consumer_product" ? "governed_consumer_catalogue" : "supabase_recovery",
      source_register: sourceRegister,
      source_serial: numberValue(row, "source_serial", { integer: true, minimum: 1 }),
      source_name: textValue(row, "source_name", { maximum: 500 }) ?? "Supabase dashboard recovery",
      source_url: textValue(row, "source_url", { maximum: 2_000 }),
      source_refreshed_at: timestampValue(row, "source_refreshed_at"),
      registration_number: textValue(row, "registration_number", { maximum: 300 }),
      brand_name: textValue(row, "brand_name", { required: true, maximum: 500 }),
      generic_name: textValue(row, "generic_name", { maximum: 500 }),
      strength: textValue(row, "strength", { maximum: 200 }),
      dosage_form: textValue(row, "dosage_form", { maximum: 200 }),
      pack_size: textValue(row, "pack_size", { maximum: 200 }),
      product_type: productType,
      category,
      department: productDepartment(category),
      subcategory: textValue(row, "subcategory", { maximum: 300 }) ?? textValue(row, "generic_name", { maximum: 500 }),
      prescription_status: prescriptionStatus,
      regulatory_status: textValue(row, "regulatory_status", { maximum: 100 }) ?? "unclassified",
      manufacturer: textValue(row, "manufacturer", { maximum: 500 }),
      manufacturer_country: textValue(row, "manufacturer_country", { maximum: 200 }),
      expiry_date: dateValue(row, "expiry_date"),
      indicative_price_rwf: numberValue(row, "indicative_price_rwf", { integer: true, minimum: 1, maximum: 100_000_000 }),
      indicative_price_basis: textValue(row, "indicative_price_basis", { maximum: 200 }),
      indicative_price_source_url: textValue(row, "indicative_price_source_url", { maximum: 2_000 }),
      indicative_price_updated_at: timestampValue(row, "indicative_price_updated_at"),
      description: textValue(row, "description", { maximum: 2_000 }),
      description_source_name: textValue(row, "description_source_name", { maximum: 500 }),
      description_source_url: textValue(row, "description_source_url", { maximum: 2_000 }),
      description_source_sha256: textValue(row, "description_source_sha256", { maximum: 64 }),
      description_rights_basis: textValue(row, "description_rights_basis", { maximum: 500 }),
      description_rights_reference: textValue(row, "description_rights_reference", { maximum: 500 }),
      description_rights_verified: booleanValue(row, "description_rights_verified", false),
      description_clinical_review_status: textValue(row, "description_clinical_review_status", { maximum: 100 }),
      description_review_note: textValue(row, "description_review_note", { maximum: 1_000 }),
      description_reviewed_by: textValue(row, "description_reviewed_by", { maximum: 160 }),
      description_reviewed_role: textValue(row, "description_reviewed_role", { maximum: 160 }),
      description_reviewed_at: timestampValue(row, "description_reviewed_at"),
      description_approved: descriptionApproved,
      publication_status: "approved",
      compliance_status: "supabase_recovery",
      compliance_evidence_url: null,
      reviewed_by_label: null,
      publication_review_note: "Recovered from checksum-bound MED250 Supabase dashboard export.",
      publication_reviewed_at: exportedAt,
      publication_approved_at: booleanValue(row, "is_active", true) ? exportedAt : null,
      is_orderable: booleanValue(row, "is_orderable", false),
      is_active: booleanValue(row, "is_active", true),
      created_at: timestampValue(row, "created_at", exportedAt),
      updated_at: timestampValue(row, "updated_at", exportedAt),
    };
    if (descriptionApproved && (!mapped.description || !mapped.description_source_sha256 || !/^[a-f0-9]{64}$/.test(mapped.description_source_sha256))) {
      throw new Error(`Product ${id} has incomplete approved-description evidence.`);
    }
    products.set(id, mapped);
    state.tables.get("med250_catalogue_products").push(mapped);
  }

  for (const sourceRow of sourceRows(source, "dawanear_product_images")) {
    const row = sourceRow.payload;
    const productId = textValue(row, "product_id", { required: true, maximum: 80 });
    const position = numberValue(row, "position", { integer: true, minimum: 1, maximum: 6 });
    if (!products.has(productId)) {
      addWarning(state, "dawanear_product_images", "image_product_not_recovered");
      continue;
    }
    const contentHash = textValue(row, "content_sha256", { maximum: 64 });
    const perceptualHash = textValue(row, "perceptual_hash", { maximum: 16 });
    state.tables.get("med250_product_images").push({
      product_id: productId,
      position,
      r2_key: null,
      legacy_public_url: textValue(row, "public_url", { maximum: 2_000 }),
      source_page_url: textValue(row, "source_page_url", { maximum: 2_000 }),
      source_image_url: textValue(row, "source_image_url", { maximum: 2_000 }),
      source_domain: textValue(row, "source_domain", { maximum: 253 }),
      source_kind: textValue(row, "source_kind", { maximum: 100 }),
      rights_basis: textValue(row, "rights_basis", { maximum: 500 }),
      width: numberValue(row, "width", { integer: true, minimum: 1, maximum: 10_000 }),
      height: numberValue(row, "height", { integer: true, minimum: 1, maximum: 10_000 }),
      quality_score: numberValue(row, "quality_score", { minimum: 0, maximum: 100, fallback: 0 }),
      content_sha256: contentHash && /^[a-f0-9]{64}$/.test(contentHash) ? contentHash : null,
      perceptual_hash: perceptualHash && /^[a-f0-9]{16}$/.test(perceptualHash) ? perceptualHash : null,
      background_removed: booleanValue(row, "background_removed", false),
      approved: false,
      checked_at: timestampValue(row, "checked_at"),
      recovery_receipt_id: null,
      created_at: timestampValue(row, "created_at", exportedAt),
    });
  }

  const knownPharmacyNumbers = new Set(state.tables.get("med250_known_pharmacy_numbers")
    .filter((row) => row.resolution_status !== "retired").map((row) => row.e164));
  const profiles = new Map();
  const verifiedClientNumbers = new Map();
  for (const sourceRow of sourceRows(source, "dawanear_customer_profiles")) {
    const row = sourceRow.payload;
    const userId = textValue(row, "user_id", { required: true, maximum: 100 });
    const e164 = row.whatsapp ? normalizedE164(row.whatsapp) : null;
    if (row.whatsapp && !e164) throw new Error(`Customer profile ${userId} has an invalid WhatsApp number.`);
    const verifiedAt = timestampValue(row, "whatsapp_verified_at");
    if (verifiedAt && knownPharmacyNumbers.has(e164)) throw new Error(`Verified customer profile ${userId} uses a registered pharmacy number.`);
    if (verifiedAt && verifiedClientNumbers.has(e164) && verifiedClientNumbers.get(e164) !== userId) {
      throw new Error("Two verified customer profiles share one WhatsApp identity.");
    }
    if (verifiedAt) verifiedClientNumbers.set(e164, userId);
    profiles.set(userId, {
      row, userId, e164, verifiedAt,
      createdAt: timestampValue(row, "created_at", exportedAt),
      updatedAt: timestampValue(row, "updated_at", exportedAt),
      preferredLanguage: new Set(["en", "rw", "fr"]).has(row.preferred_language) ? row.preferred_language : "en",
    });
  }

  const orderItemsByOrder = new Map();
  for (const sourceRow of sourceRows(source, "dawanear_order_items")) {
    const row = sourceRow.payload;
    const orderId = textValue(row, "order_id", { required: true, maximum: 100 });
    const list = orderItemsByOrder.get(orderId) ?? [];
    list.push({ sourceRow, row });
    orderItemsByOrder.set(orderId, list);
  }

  const canonicalOrders = [];
  const canonicalOrderIds = new Set();
  const actors = new Map();
  const principals = new Map();
  for (const profile of profiles.values()) {
    if (profile.verifiedAt && profile.e164) {
      const actorId = recoveryActorId(profile.e164);
      actors.set(profile.e164, {
        id: actorId, e164: profile.e164, actor_type: "client", pharmacy_id: null, profile_name: null,
        first_seen_at: profile.createdAt, last_seen_at: profile.updatedAt, inbound_message_count: 0,
        created_at: profile.createdAt, updated_at: profile.updatedAt,
      });
    }
    principals.set(profile.userId, {
      id: profile.userId,
      subject_type: "client",
      actor_id: profile.verifiedAt && profile.e164 ? recoveryActorId(profile.e164) : null,
      verified_at: profile.verifiedAt,
      preferred_language: profile.preferredLanguage,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
      last_seen_at: profile.updatedAt,
    });
  }

  for (const sourceRow of sourceRows(source, "dawanear_orders")) {
    const row = sourceRow.payload;
    const id = textValue(row, "id", { required: true, maximum: 100 });
    const userId = textValue(row, "user_id", { required: true, maximum: 100 });
    const profile = profiles.get(userId);
    const orderPhone = row.whatsapp ? normalizedE164(row.whatsapp) : null;
    if (row.whatsapp && !orderPhone) {
      addWarning(state, "dawanear_orders", "order_invalid_whatsapp");
      continue;
    }
    if (profile?.e164 && orderPhone && profile.e164 !== orderPhone) throw new Error(`Order ${id} conflicts with its customer profile WhatsApp number.`);
    const e164 = orderPhone ?? profile?.e164 ?? null;
    const point = parsePostgisPoint(row.customer_location);
    if (!e164 || knownPharmacyNumbers.has(e164) || !validRwandaPoint(point)) {
      addWarning(state, "dawanear_orders", !e164 ? "order_missing_whatsapp" : knownPharmacyNumbers.has(e164) ? "order_uses_pharmacy_number" : "order_invalid_location");
      continue;
    }
    const sourceItems = (orderItemsByOrder.get(id) ?? []).sort((left, right) => {
      const leftCreated = left.row.created_at ?? "";
      const rightCreated = right.row.created_at ?? "";
      return String(leftCreated).localeCompare(String(rightCreated)) || left.sourceRow.sourceKey.localeCompare(right.sourceRow.sourceKey);
    });
    const validItems = sourceItems.filter(({ row: item }) => products.has(String(item.product_id ?? ""))).slice(0, 10);
    if (!validItems.length) {
      addWarning(state, "dawanear_orders", "order_without_recoverable_items");
      continue;
    }
    if (sourceItems.length > validItems.length) addWarning(state, "dawanear_order_items", "order_items_not_canonicalized", sourceItems.length - validItems.length);
    const createdAt = timestampValue(row, "created_at", exportedAt);
    const updatedAt = timestampValue(row, "updated_at", createdAt);
    const actorId = recoveryActorId(e164);
    if (!actors.has(e164)) actors.set(e164, {
      id: actorId, e164, actor_type: "client", pharmacy_id: null, profile_name: null,
      first_seen_at: createdAt, last_seen_at: updatedAt, inbound_message_count: 0,
      created_at: createdAt, updated_at: updatedAt,
    });
    if (!principals.has(userId)) principals.set(userId, {
      id: userId, subject_type: "client", actor_id: null, verified_at: null, preferred_language: "en",
      created_at: createdAt, updated_at: updatedAt, last_seen_at: updatedAt,
    });
    const clientRequestId = textValue(row, "client_request_id", { required: true, maximum: 100 });
    const sourceStatus = textValue(row, "status", { required: true, maximum: 40 });
    const status = mapOrderStatus(sourceStatus);
    if (!status) throw new Error(`Order ${id} has unsupported status ${sourceStatus}.`);
    const locationId = recoveryLocationId(id);
    if (row.prescription_path) addWarning(state, "dawanear_orders", "prescription_media_pending_r2_recovery", 1, false);
    canonicalOrders.push({
      sourceRow, row, id, userId, e164, actorId, point, createdAt, updatedAt, locationId, validItems,
      request: {
        id,
        reference: textValue(row, "reference", { required: true, maximum: 100 }),
        actor_id: actorId,
        customer_e164: e164,
        source: "web_catalogue",
        status,
        location_id: locationId,
        dispatch_limit: 10,
        media_count: 0,
        web_principal_id: userId,
        client_request_id: clientRequestId,
        idempotency_hash: sha256(`${manifest.source_project_ref}:dawanear_orders:${userId}:${clientRequestId}`),
        delivery_preference: new Set(["pickup", "delivery", "either"]).has(row.delivery_preference) ? row.delivery_preference : "either",
        substitutes_allowed: booleanValue(row, "substitutes_allowed", true),
        location_accuracy_m: numberValue(row, "location_accuracy_m", { minimum: 0.01, maximum: 5_000 }),
        prescription_media_id: null,
        selected_offer_id: textValue(row, "selected_offer_id", { maximum: 100 }),
        selected_at: timestampValue(row, "selected_at"),
        broadcast_at: timestampValue(row, "broadcast_at"),
        expires_at: timestampValue(row, "expires_at", new Date(Date.parse(createdAt) + 2 * 60 * 60_000).toISOString()),
        closed_at: new Set(["cancelled", "expired", "completed"]).has(status) ? updatedAt : null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });
    canonicalOrderIds.add(id);
  }

  state.tables.get("med250_actors").push(...[...actors.values()].sort((left, right) => left.e164.localeCompare(right.e164)));
  state.tables.get("med250_web_principals").push(...[...principals.values()].sort((left, right) => left.id.localeCompare(right.id)));
  const newestOrderByActor = new Map();
  for (const order of canonicalOrders) {
    const existing = newestOrderByActor.get(order.actorId);
    if (!existing || existing.createdAt < order.createdAt) newestOrderByActor.set(order.actorId, order);
  }
  for (const order of canonicalOrders) {
    state.tables.get("med250_client_locations").push({
      id: order.locationId,
      actor_id: order.actorId,
      latitude: order.point.latitude,
      longitude: order.point.longitude,
      accuracy_m: order.request.location_accuracy_m,
      address: null,
      label: "Recovered order location",
      source: "web_order",
      capture_key: sha256(`${manifest.source_project_ref}:dawanear_orders:${order.id}:location`),
      is_current: newestOrderByActor.get(order.actorId)?.id === order.id,
      consented_at: order.createdAt,
      captured_at: order.createdAt,
      last_used_at: order.updatedAt,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    });
    state.tables.get("med250_client_requests").push(order.request);
    order.validItems.forEach(({ row }, index) => {
      const product = products.get(String(row.product_id));
      state.tables.get("med250_web_order_items").push({
        id: textValue(row, "id", { required: true, maximum: 100 }),
        request_id: order.id,
        position: index + 1,
        product_id: product.id,
        product_name: product.brand_name.slice(0, 220),
        generic_name: product.generic_name,
        strength: product.strength,
        dosage_form: product.dosage_form,
        pack_size: product.pack_size,
        image_url: null,
        image_r2_key: null,
        quantity: numberValue(row, "quantity", { integer: true, minimum: 1, maximum: 99 }),
        customer_min_rwf: numberValue(row, "customer_min_rwf", { integer: true, minimum: 0 }),
        customer_max_rwf: numberValue(row, "customer_max_rwf", { integer: true, minimum: 0 }),
        substitutes_allowed: booleanValue(row, "substitutes_allowed", true),
        created_at: timestampValue(row, "created_at", order.createdAt),
      });
    });
  }

  const completeOfferByPair = new Map();
  const canonicalOffers = new Map();
  for (const sourceRow of sourceRows(source, "dawanear_offers")) {
    const row = sourceRow.payload;
    const id = textValue(row, "id", { required: true, maximum: 100 });
    const orderId = textValue(row, "order_id", { required: true, maximum: 100 });
    const pharmacyId = textValue(row, "pharmacy_id", { required: true, maximum: 100 });
    if (!canonicalOrderIds.has(orderId) || !pharmacyInput.has(pharmacyId)) {
      addWarning(state, "dawanear_offers", "offer_parent_not_recovered");
      continue;
    }
    const complete = booleanValue(row, "complete", false);
    const sourceStatus = textValue(row, "status", { maximum: 30 }) ?? "draft";
    const status = complete && new Set(["submitted", "selected", "expired", "withdrawn"]).has(sourceStatus) ? sourceStatus : "draft";
    const submittedAt = status === "draft" ? null : timestampValue(row, "submitted_at", timestampValue(row, "created_at", exportedAt));
    const note = textValue(row, "note", { maximum: 2_000 });
    if (note && note.length > 1_000) addWarning(state, "dawanear_offers", "offer_note_truncated", 1, false);
    const mapped = {
      id,
      request_id: orderId,
      pharmacy_id: pharmacyId,
      status,
      complete: status !== "draft",
      total_rwf: numberValue(row, "total_rwf", { integer: true, minimum: 0, maximum: 1_000_000_000, fallback: 0 }),
      fulfilment_method: new Set(["pickup", "delivery", "either"]).has(row.fulfilment_method) ? row.fulfilment_method : "either",
      ready_in_minutes: numberValue(row, "ready_in_minutes", { integer: true, minimum: 0, maximum: 1_440 }),
      note: note?.slice(0, 1_000) ?? null,
      submitted_at: submittedAt,
      created_at: timestampValue(row, "created_at", exportedAt),
      updated_at: timestampValue(row, "updated_at", exportedAt),
    };
    canonicalOffers.set(id, mapped);
    state.tables.get("med250_marketplace_offers").push(mapped);
    if (mapped.complete) completeOfferByPair.set(`${orderId}|${pharmacyId}`, mapped);
  }

  const orderItemIds = new Set(state.tables.get("med250_web_order_items").map((row) => row.id));
  for (const sourceRow of sourceRows(source, "dawanear_offer_items")) {
    const row = sourceRow.payload;
    const offerId = textValue(row, "offer_id", { required: true, maximum: 100 });
    const orderItemId = textValue(row, "order_item_id", { required: true, maximum: 100 });
    const offeredProductId = textValue(row, "offered_product_id", { maximum: 80 });
    if (!canonicalOffers.has(offerId) || !orderItemIds.has(orderItemId) || (offeredProductId && !products.has(offeredProductId))) {
      addWarning(state, "dawanear_offer_items", "offer_item_parent_not_recovered");
      continue;
    }
    const available = booleanValue(row, "available", false);
    const note = textValue(row, "note", { maximum: 1_000 });
    if (note && note.length > 500) addWarning(state, "dawanear_offer_items", "offer_item_note_truncated", 1, false);
    state.tables.get("med250_marketplace_offer_items").push({
      id: textValue(row, "id", { required: true, maximum: 100 }),
      offer_id: offerId,
      order_item_id: orderItemId,
      offered_product_id: available ? offeredProductId : null,
      available,
      is_substitute: available && booleanValue(row, "is_substitute", false),
      unit_price_rwf: available ? numberValue(row, "unit_price_rwf", { integer: true, minimum: 1, maximum: 100_000_000 }) : null,
      quantity: available ? numberValue(row, "quantity", { integer: true, minimum: 1, maximum: 99 }) : null,
      note: note?.slice(0, 500) ?? null,
      created_at: timestampValue(row, "created_at", exportedAt),
    });
  }

  const recipientsByOrder = new Map();
  for (const sourceRow of sourceRows(source, "dawanear_order_recipients")) {
    const row = sourceRow.payload;
    const orderId = textValue(row, "order_id", { required: true, maximum: 100 });
    const list = recipientsByOrder.get(orderId) ?? [];
    list.push({ sourceRow, row });
    recipientsByOrder.set(orderId, list);
  }
  for (const order of canonicalOrders) {
    const candidates = (recipientsByOrder.get(order.id) ?? []).sort((left, right) => (
      numberValue(left.row, "distance_m", { minimum: 0 }) - numberValue(right.row, "distance_m", { minimum: 0 })
      || String(left.row.pharmacy_id).localeCompare(String(right.row.pharmacy_id))
    ));
    if (candidates.length > 10) addWarning(state, "dawanear_order_recipients", "historical_recipients_above_nearest_ten", candidates.length - 10);
    for (const { row } of candidates.slice(0, 10)) {
      const pharmacyId = textValue(row, "pharmacy_id", { required: true, maximum: 100 });
      const contact = primaryDispatchByPharmacy.get(pharmacyId);
      if (!pharmacyInput.has(pharmacyId) || !contact) {
        addWarning(state, "dawanear_order_recipients", "recipient_without_governed_whatsapp");
        continue;
      }
      const offer = completeOfferByPair.get(`${order.id}|${pharmacyId}`);
      state.tables.get("med250_request_recipients").push({
        request_id: order.id,
        pharmacy_id: pharmacyId,
        recipient_e164: contact.e164,
        distance_m: numberValue(row, "distance_m", { minimum: 0 }),
        response_status: offer ? "can_fulfil" : null,
        dispatched_at: timestampValue(row, "notified_at", order.request.broadcast_at ?? order.createdAt),
        responded_at: offer?.submitted_at ?? null,
      });
    }
  }

  for (const sourceRow of sourceRows(source, "dawanear_central_price_contributions")) {
    const row = sourceRow.payload;
    const pharmacyId = textValue(row, "pharmacy_id", { required: true, maximum: 100 });
    const productId = textValue(row, "product_id", { required: true, maximum: 80 });
    if (!pharmacyInput.has(pharmacyId) || !products.has(productId)) {
      addWarning(state, "dawanear_central_price_contributions", "price_contribution_parent_not_recovered");
      continue;
    }
    const status = textValue(row, "outcome", { required: true, maximum: 30 });
    if (!new Set(["initialized", "lowered", "not_lower"]).has(status)) throw new Error("Central price contribution has an unsupported outcome.");
    state.tables.get("med250_catalogue_price_contributions").push({
      id: textValue(row, "id", { required: true, maximum: 100 }),
      pharmacy_id: pharmacyId,
      product_id: productId,
      submitted_price_rwf: numberValue(row, "submitted_price_rwf", { integer: true, minimum: 1, maximum: 100_000_000 }),
      previous_price_rwf: numberValue(row, "previous_central_price_rwf", { integer: true, minimum: 1, maximum: 100_000_000 }),
      resulting_price_rwf: numberValue(row, "resulting_central_price_rwf", { integer: true, minimum: 1, maximum: 100_000_000 }),
      contribution_status: status,
      created_at: timestampValue(row, "created_at", exportedAt),
    });
  }

  for (const sourceRow of sourceRows(source, "dawanear_public_metric_approvals")) {
    const row = sourceRow.payload;
    const key = textValue(row, "metric_key", { required: true, maximum: 100 });
    if (!new Set(["ready_pharmacy_count", "typical_response_time"]).has(key)) throw new Error("Public metric approval has an unsupported key.");
    state.tables.get("med250_public_metric_approvals").push({
      metric_key: key,
      approved: booleanValue(row, "approved", false),
      reviewed_by: textValue(row, "reviewed_by", { maximum: 500 }),
      evidence_reference: textValue(row, "evidence_reference", { maximum: 2_000 }),
      approved_at: timestampValue(row, "approved_at"),
      expires_at: timestampValue(row, "expires_at"),
      updated_at: timestampValue(row, "updated_at", exportedAt),
    });
  }

  return state;
}

function columnsForRows(rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    if (stableJson(Object.keys(row)) !== stableJson(columns)) throw new Error("Canonical row columns are inconsistent.");
  }
  return columns;
}

function countQuery(tables) {
  return `${tables.map((table) => `SELECT ${sqlLiteral(table)} AS entity, COUNT(*) AS row_count FROM ${table};`).join("\n")}\n`;
}

async function loadAndVerifyManifest(manifestPath) {
  const manifestBytes = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Recovery manifest is not valid JSON.");
  }
  if (manifest.schema_version !== DASHBOARD_RECOVERY_SCHEMA || manifest.source_platform !== "supabase_dashboard_csv") {
    throw new Error("Recovery manifest schema is unsupported.");
  }
  exactProjectRef(manifest.source_project_ref);
  manifest.exported_at = exactIso(manifest.exported_at, "manifest exported_at");
  if (!Array.isArray(manifest.tables) || !manifest.tables.length || manifest.tables.length > 100) {
    throw new Error("Recovery manifest table inventory is invalid.");
  }
  const snapshot = sha256(stableJson({
    schema_version: manifest.schema_version,
    source_project_ref: manifest.source_project_ref,
    exported_at: manifest.exported_at,
    tables: manifest.tables,
  }));
  if (snapshot !== manifest.source_snapshot_sha256) throw new Error("Recovery manifest snapshot hash does not match its table inventory.");
  return { manifest, manifestBytes, manifestSha256: sha256(manifestBytes) };
}

export async function buildDashboardRecovery({ manifestPath, target, importedAt, outputDir }) {
  const normalizedTarget = exactTarget(target);
  const normalizedImportedAt = exactIso(importedAt, "imported-at");
  const { manifest, manifestSha256 } = await loadAndVerifyManifest(manifestPath);
  const manifestDirectory = resolve(manifestPath, "..");
  const source = new Map();
  let totalRows = 0;
  for (const entry of manifest.tables) {
    if (SENSITIVE_TABLES.has(entry.source_table)) throw new Error(`${entry.source_table} is prohibited from recovery.`);
    if (basename(entry.file_name) !== entry.file_name) throw new Error("Recovery manifest file names must not traverse directories.");
    const loaded = await loadCsvFile(join(manifestDirectory, entry.file_name), entry.source_table);
    if (sha256(loaded.bytes) !== entry.content_sha256) throw new Error(`${entry.source_table} changed after the manifest was created.`);
    if (loaded.rows.length !== entry.row_count || stableJson(loaded.headers) !== stableJson(entry.headers)) {
      throw new Error(`${entry.source_table} no longer matches the manifest row or header inventory.`);
    }
    if (stableJson(loaded.policy.key) !== stableJson(entry.source_key_columns)) throw new Error(`${entry.source_table} source-key policy changed.`);
    source.set(entry.source_table, loaded);
    totalRows += loaded.rows.length;
  }
  const state = buildCanonicalRows(source, manifest);
  const importId = `dashboard-${manifest.source_snapshot_sha256.slice(0, 32)}`;
  const sourceTableCounts = Object.fromEntries(manifest.tables.map((entry) => [entry.source_table, entry.row_count]));
  const canonicalTableCounts = Object.fromEntries(CANONICAL_INSERT_ORDER.map((table) => [table, state.tables.get(table).length]));
  const rawOnlyTableCounts = Object.fromEntries(manifest.tables
    .filter((entry) => entry.canonical_policy.startsWith("raw_only"))
    .map((entry) => [entry.source_table, entry.row_count]));
  const preflightTables = [
    "med250_dashboard_recovery_imports",
    "med250_dashboard_recovery_files",
    "med250_dashboard_recovery_rows",
    "med250_dashboard_recovery_plans",
    "med250_dashboard_recovery_verifications",
    ...CANONICAL_INSERT_ORDER,
  ];
  const expectedReadbackCounts = {
    med250_dashboard_recovery_imports: 1,
    med250_dashboard_recovery_files: manifest.tables.length,
    med250_dashboard_recovery_rows: totalRows,
    med250_dashboard_recovery_plans: 1,
    ...canonicalTableCounts,
  };
  const planBody = {
    schema_version: DASHBOARD_RECOVERY_SCHEMA,
    import_id: importId,
    source_project_ref: manifest.source_project_ref,
    source_snapshot_sha256: manifest.source_snapshot_sha256,
    manifest_sha256: manifestSha256,
    target: normalizedTarget,
    imported_at: normalizedImportedAt,
    source_table_counts: sourceTableCounts,
    canonical_table_counts: canonicalTableCounts,
    raw_only_table_counts: rawOnlyTableCounts,
    skipped_row_counts: state.skippedRowCounts,
    warning_counts: state.warningCounts,
    preflight_tables: preflightTables,
    expected_readback_counts: expectedReadbackCounts,
  };
  const planSha256 = sha256(stableJson(planBody));
  const plan = { ...planBody, plan_sha256: planSha256 };

  const statements = ["PRAGMA foreign_keys = ON;"];
  statements.push(...renderInsertStatements("med250_dashboard_recovery_imports", [
    "id", "source_project_ref", "exported_at", "source_snapshot_sha256", "manifest_sha256",
    "table_count", "row_count", "target", "imported_at",
  ], [{
    id: importId,
    source_project_ref: manifest.source_project_ref,
    exported_at: manifest.exported_at,
    source_snapshot_sha256: manifest.source_snapshot_sha256,
    manifest_sha256: manifestSha256,
    table_count: manifest.tables.length,
    row_count: totalRows,
    target: normalizedTarget,
    imported_at: normalizedImportedAt,
  }]));
  statements.push(...renderInsertStatements("med250_dashboard_recovery_files", [
    "import_id", "source_table", "file_name", "content_sha256", "row_count", "headers",
  ], manifest.tables.map((entry) => ({
    import_id: importId,
    source_table: entry.source_table,
    file_name: entry.file_name,
    content_sha256: entry.content_sha256,
    row_count: entry.row_count,
    headers: stableJson(entry.headers),
  }))));
  const rawRows = [];
  for (const entry of manifest.tables) {
    for (const row of source.get(entry.source_table).rows) {
      rawRows.push({
        import_id: importId,
        source_table: entry.source_table,
        source_row_number: row.rowNumber,
        source_key: row.sourceKey,
        payload_sha256: row.payloadSha256,
        payload: stableJson(row.payload),
        imported_at: normalizedImportedAt,
      });
    }
  }
  statements.push(...renderInsertStatements("med250_dashboard_recovery_rows", [
    "import_id", "source_table", "source_row_number", "source_key", "payload_sha256", "payload", "imported_at",
  ], rawRows));
  for (const table of CANONICAL_INSERT_ORDER) {
    const rows = state.tables.get(table);
    statements.push(...renderInsertStatements(table, columnsForRows(rows), rows));
  }
  statements.push(...renderInsertStatements("med250_dashboard_recovery_plans", [
    "import_id", "plan_sha256", "expected_readback_counts", "source_table_counts",
    "canonical_table_counts", "raw_only_table_counts", "skipped_row_counts", "warning_counts", "prepared_at",
  ], [{
    import_id: importId,
    plan_sha256: planSha256,
    expected_readback_counts: stableJson(expectedReadbackCounts),
    source_table_counts: stableJson(sourceTableCounts),
    canonical_table_counts: stableJson(canonicalTableCounts),
    raw_only_table_counts: stableJson(rawOnlyTableCounts),
    skipped_row_counts: stableJson(state.skippedRowCounts),
    warning_counts: stableJson(state.warningCounts),
    prepared_at: normalizedImportedAt,
  }]));

  const sql = `${statements.join("\n\n")}\n`;
  for (const statement of sql.split(/;\s*(?:\n|$)/)) {
    if (Buffer.byteLength(statement) > MAX_SQL_STATEMENT_BYTES) throw new Error("Generated recovery SQL exceeded its D1 statement limit.");
  }
  const destination = resolve(outputDir);
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(join(destination, "recovery-import.sql"), sql, { mode: 0o600 }),
    writeFile(join(destination, "recovery-plan.json"), `${stableJson(plan, 2)}\n`, { mode: 0o600 }),
    writeFile(join(destination, "preflight-readback.sql"), countQuery(preflightTables), { mode: 0o600 }),
    writeFile(join(destination, "postimport-readback.sql"), countQuery(Object.keys(expectedReadbackCounts)), { mode: 0o600 }),
  ]);
  return plan;
}

function wranglerRows(value) {
  if (!Array.isArray(value)) throw new Error("Wrangler readback must be a JSON array.");
  const results = value.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
  const counts = {};
  for (const row of results) {
    const entity = String(row?.entity ?? "");
    const count = Number(row?.row_count);
    if (!entity || !Number.isSafeInteger(count) || count < 0 || Object.hasOwn(counts, entity)) {
      throw new Error("Wrangler readback contains an invalid or duplicate count row.");
    }
    counts[entity] = count;
  }
  return counts;
}

async function loadPlanAndReadback(planPath, readbackPath) {
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const readback = wranglerRows(JSON.parse(await readFile(readbackPath, "utf8")));
  if (plan.schema_version !== DASHBOARD_RECOVERY_SCHEMA || sha256(stableJson(Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "plan_sha256"),
  ))) !== plan.plan_sha256) throw new Error("Recovery plan hash is invalid.");
  return { plan, readback };
}

function assertExactCounts(expected, observed, label) {
  for (const [entity, count] of Object.entries(expected)) {
    if (observed[entity] !== count) throw new Error(`${label} failed for ${entity}: expected ${count}, observed ${observed[entity] ?? "missing"}.`);
  }
}

export async function verifyRecoveryPreflight({ planPath, readbackPath }) {
  const { plan, readback } = await loadPlanAndReadback(planPath, readbackPath);
  assertExactCounts(Object.fromEntries(plan.preflight_tables.map((table) => [table, 0])), readback, "Recovery preflight");
  return { target: plan.target, empty_table_count: plan.preflight_tables.length, plan_sha256: plan.plan_sha256 };
}

export async function verifyRecoveryReadback({ planPath, readbackPath, verifiedAt, receiptOutput }) {
  const { plan, readback } = await loadPlanAndReadback(planPath, readbackPath);
  assertExactCounts(plan.expected_readback_counts, readback, "Recovery readback");
  const normalizedVerifiedAt = exactIso(verifiedAt, "verified-at");
  const verificationId = `dashboard-verification-${plan.source_snapshot_sha256.slice(0, 32)}`;
  const rows = [{
    id: verificationId,
    import_id: plan.import_id,
    plan_sha256: plan.plan_sha256,
    observed_counts: stableJson(readback),
    target: plan.target,
    verified_at: normalizedVerifiedAt,
  }];
  const receipt = `${renderInsertStatements("med250_dashboard_recovery_verifications", [
    "id", "import_id", "plan_sha256", "observed_counts", "target", "verified_at",
  ], rows).join("\n")}\n`;
  await writeFile(receiptOutput, receipt, { mode: 0o600 });
  return { verification_id: verificationId, target: plan.target, plan_sha256: plan.plan_sha256 };
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || !tokens[index + 1] || tokens[index + 1].startsWith("--")) {
      throw new Error(`Invalid argument ${token}.`);
    }
    args[token.slice(2)] = tokens[index + 1];
    index += 1;
  }
  return { command, args };
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  let result;
  if (command === "manifest") {
    result = await prepareDashboardManifest({
      sourceDir: args["source-dir"], projectRef: args["project-ref"],
      exportedAt: args["exported-at"], outputPath: args.output,
    });
    result = { source_snapshot_sha256: result.source_snapshot_sha256, table_count: result.tables.length,
      row_count: result.tables.reduce((sum, table) => sum + table.row_count, 0) };
  } else if (command === "build") {
    result = await buildDashboardRecovery({
      manifestPath: args.manifest, target: args.target,
      importedAt: args["imported-at"], outputDir: args["output-dir"],
    });
    result = { import_id: result.import_id, plan_sha256: result.plan_sha256, target: result.target,
      warning_counts: result.warning_counts, skipped_row_counts: result.skipped_row_counts };
  } else if (command === "verify-preflight") {
    result = await verifyRecoveryPreflight({ planPath: args.plan, readbackPath: args.readback });
  } else if (command === "verify-readback") {
    result = await verifyRecoveryReadback({
      planPath: args.plan, readbackPath: args.readback,
      verifiedAt: args["verified-at"], receiptOutput: args["receipt-output"],
    });
  } else {
    throw new Error("Use manifest, build, verify-preflight, or verify-readback.");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dashboard recovery failed."}\n`);
    process.exitCode = 1;
  });
}
