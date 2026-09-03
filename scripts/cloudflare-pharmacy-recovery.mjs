import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseDashboardCsv } from "./dashboard-recovery.mjs";

const root = resolve(import.meta.dirname, "..");
const workRoot = join(root, "work");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = "med250.cloudflare-pharmacy-recovery.v2";
const SOURCE_PATHS = Object.freeze({
  manifest: "data/imports/source-manifest.json",
  retail: "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv",
  online: "data/imports/rwanda-fda-online-pharmacies-may-2026.csv",
  public_contacts: "work/pharmacy-contact-candidates-merged.csv",
  fda_exact_contacts: "data/imports/rwanda-fda-pharmacy-contacts-exact-review.csv",
  mmi_exact_contacts: "data/imports/mmi-pharmacy-directory-promoted.csv",
  independent_contacts: "data/imports/google-pharmacy-contact-independent-verification.csv",
  government_gis: "data/imports/rwanda-government-pharmacy-gis-matched.csv",
  deep_contact_evidence: "supabase/migrations/20260717090739_import_deeply_verified_pharmacy_phone_contacts.sql",
  delivery_quarantine: "data/imports/whatsapp-contact-delivery-quarantine.csv",
});
const TARGETS = Object.freeze({
  staging: { database_name: "med250-staging" },
  production: { database_name: "med250-production" },
});
const EXPECTED = Object.freeze({
  retail_pharmacies: 766,
  online_pharmacies: 3,
  pharmacies: 769,
  public_contact_rows: 725,
  fda_exact_contact_rows: 7,
  mmi_exact_contact_rows: 77,
  independent_review_rows: 26,
  independent_exact_rows: 3,
  deep_exact_rows: 2,
  government_geocodes: 93,
  delivery_quarantine_rows: 3,
  known_numbers: 309,
  resolved_numbers: 280,
  ambiguous_numbers: 26,
  retired_numbers: 3,
  contacts: 283,
  login_enabled_contacts: 78,
  contact_pharmacies: 264,
  dispatch_eligible_pharmacies: 33,
});
const SHA256 = /^[a-f0-9]{64}$/;
const RWANDA_MOBILE = /^2507[2389][0-9]{7}$/;
const OFFICIAL_SOURCE_NAMES = Object.freeze([
  "Rwanda FDA - Licensed Human Retail Pharmacies May 2026",
  "Rwanda FDA - Licensed Online Pharmacies May 2026",
]);
const GOVERNED_CONTACT_PREFIX = "MED250 governed registry recovery:";
const GOVERNED_NUMBER_SOURCE = "governed_registry_recovery";

const PHARMACY_COLUMNS = Object.freeze([
  "id", "name", "latitude", "longitude", "licence_status", "licence_expires_on",
  "licence_number", "address", "google_maps_url", "momo_code", "marketplace_approved",
  "dispatch_enabled", "registry_entry_key", "registry_type", "fda_source_serial",
  "responsible_professional", "responsible_professional_registration", "province", "district",
  "sector_cell_raw", "source_name", "source_url", "geocode_status", "geocode_provider",
  "geocode_reference", "geocode_formatted_address", "geocode_confidence",
  "geocode_checked_at", "geocode_reviewed_by", "geocode_reviewed_at",
  "geocode_review_note", "created_at", "updated_at",
]);
const CONTACT_COLUMNS = Object.freeze([
  "id", "pharmacy_id", "channel", "e164", "address", "verified_at", "source",
  "source_url", "source_reference", "source_observed_at", "login_enabled",
  "dispatch_enabled", "is_primary", "active", "created_at", "updated_at",
  "verified_by_label", "verification_note", "derived_from_contact_id",
]);
const NUMBER_COLUMNS = Object.freeze([
  "e164", "resolution_status", "pharmacy_id", "source", "source_evidence",
  "reviewed_at", "created_at", "updated_at",
]);

export class PharmacyRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PharmacyRecoveryError";
    this.code = code;
  }
}

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

function canonicalHash(value) {
  return sha256(Buffer.from(stableJson(value), "utf8"));
}

function repositoryPath(value, label) {
  const path = resolve(root, value);
  if (!path.startsWith(`${root}${sep}`)) throw new PharmacyRecoveryError("unsafe_path", `${label} escapes the repository.`);
  return path;
}

function approvedWorkPath(value, label) {
  const path = resolve(value);
  if (path !== workRoot && !path.startsWith(`${workRoot}${sep}`)) {
    throw new PharmacyRecoveryError("unsafe_path", `${label} must be inside the repository work directory.`);
  }
  return path;
}

function exactTarget(value) {
  const target = String(value ?? "").trim().toLowerCase();
  if (!(target in TARGETS)) throw new PharmacyRecoveryError("invalid_target", "Target must be staging or production.");
  return target;
}

function exactIso(value, label) {
  const source = String(value ?? "").trim();
  if (!source || !Number.isFinite(Date.parse(source))) {
    throw new PharmacyRecoveryError("invalid_timestamp", `${label} must be an ISO-8601 timestamp.`);
  }
  return new Date(source).toISOString();
}

function optionalIso(value, fallback) {
  const source = String(value ?? "").trim();
  return source && Number.isFinite(Date.parse(source)) ? new Date(source).toISOString() : fallback;
}

function dateValue(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(normalized) || !Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new PharmacyRecoveryError("invalid_source", `${label} is not a valid date.`);
  }
  return normalized;
}

function text(value, maximum = 2_000) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > maximum) throw new PharmacyRecoveryError("invalid_source", `Source text exceeds ${maximum} characters.`);
  return normalized || null;
}

function requiredText(value, label, maximum = 2_000) {
  const normalized = text(value, maximum);
  if (!normalized) throw new PharmacyRecoveryError("invalid_source", `${label} is required.`);
  return normalized;
}

function sourceUrl(value, label, { required = false } = {}) {
  const normalized = text(value, 2_000);
  if (!normalized) {
    if (required) throw new PharmacyRecoveryError("invalid_source", `${label} is required.`);
    return null;
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new PharmacyRecoveryError("invalid_source", `${label} is not a valid URL.`);
  }
  if (!new Set(["https:", "http:"]).has(parsed.protocol)) {
    throw new PharmacyRecoveryError("invalid_source", `${label} must use HTTP or HTTPS.`);
  }
  return parsed.toString();
}

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PharmacyRecoveryError("invalid_source", `${label} is not a valid integer.`);
  }
  return parsed;
}

function numberValue(value, label, { minimum, maximum } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new PharmacyRecoveryError("invalid_source", `${label} is outside the allowed range.`);
  }
  return parsed;
}

function normalizeRwandaMobile(value, label) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = `250${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 9) digits = `250${digits}`;
  if (!RWANDA_MOBILE.test(digits)) throw new PharmacyRecoveryError("invalid_source", `${label} is not a Rwanda mobile number.`);
  return digits;
}

function phoneList(value, label) {
  const source = String(value ?? "").trim();
  if (!source) return [];
  return [...new Set(source.split(/[;,|\n]+/u).map((entry, index) => normalizeRwandaMobile(entry, `${label} item ${index + 1}`)))];
}

async function inputFile(path) {
  const absolute = repositoryPath(path, "Source input");
  const metadata = await stat(absolute);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 64 * 1024 * 1024) {
    throw new PharmacyRecoveryError("invalid_source", `${path} is not a bounded source file.`);
  }
  const bytes = await readFile(absolute);
  return { path, absolute, bytes, byte_count: bytes.length, sha256: sha256(bytes) };
}

function csvRows(input, expected, label) {
  const parsed = parseDashboardCsv(input.bytes.toString("utf8"));
  if (parsed.rows.length !== expected) {
    throw new PharmacyRecoveryError("source_count_mismatch", `${label} expected ${expected} rows; found ${parsed.rows.length}.`);
  }
  return parsed.rows.map(({ payload }) => payload);
}

function registryKey(type, serial) {
  return `${type}-2026-05-${serial}`;
}

function validateSequential(rows, type) {
  const expected = type === "retail" ? EXPECTED.retail_pharmacies : EXPECTED.online_pharmacies;
  const serials = new Set();
  for (const [index, row] of rows.entries()) {
    const serial = integer(row.source_serial, `${type} row ${index + 2} source_serial`, { minimum: 1, maximum: expected });
    if (serials.has(serial)) throw new PharmacyRecoveryError("duplicate_source", `${type} source serial ${serial} is duplicated.`);
    serials.add(serial);
  }
  for (let serial = 1; serial <= expected; serial += 1) {
    if (!serials.has(serial)) throw new PharmacyRecoveryError("source_count_mismatch", `${type} source serial ${serial} is missing.`);
  }
}

function joinAddress(row) {
  return [row.village, row.gis_cell, row.gis_sector, row.gis_district].map((value) => text(value, 250)).filter(Boolean).join(", ") || null;
}

function buildPharmacyRows(retailRows, onlineRows, gisRows, generatedAt, importedAt) {
  validateSequential(retailRows, "retail");
  validateSequential(onlineRows, "online");
  const gisByKey = new Map();
  for (const [index, row] of gisRows.entries()) {
    const key = requiredText(row.registry_entry_key, `GIS row ${index + 2} registry key`, 100);
    if (gisByKey.has(key)) throw new PharmacyRecoveryError("duplicate_source", `GIS registry key ${key} is duplicated.`);
    gisByKey.set(key, row);
  }
  const importedDate = importedAt.slice(0, 10);
  const sourceRows = [
    ...retailRows.map((row) => ({ row, type: "retail", sourceName: OFFICIAL_SOURCE_NAMES[0] })),
    ...onlineRows.map((row) => ({ row, type: "online", sourceName: OFFICIAL_SOURCE_NAMES[1] })),
  ];
  const rows = sourceRows.map(({ row, type, sourceName }, index) => {
    const serial = integer(row.source_serial, `${type} source serial`, { minimum: 1 });
    const key = registryKey(type, serial);
    const expiry = dateValue(row.license_expiration_date, `${key} licence expiration`);
    const gis = gisByKey.get(key);
    const latitude = gis ? numberValue(gis.latitude, `${key} latitude`, { minimum: -3.0, maximum: -0.8 }) : null;
    const longitude = gis ? numberValue(gis.longitude, `${key} longitude`, { minimum: 28.7, maximum: 30.9 }) : null;
    const sourcePage = sourceUrl(row.source_url, `${key} source URL`, { required: true });
    const geocodeObservedAt = gis ? optionalIso(gis.edited_at, optionalIso(gis.collected_at, generatedAt)) : null;
    return {
      id: key,
      name: requiredText(row.name, `${key} name`, 180),
      latitude,
      longitude,
      licence_status: expiry >= importedDate ? "current" : "expired",
      licence_expires_on: expiry,
      licence_number: null,
      address: text(row.sector_cell_raw, 1_000),
      google_maps_url: null,
      momo_code: null,
      marketplace_approved: 1,
      dispatch_enabled: 0,
      registry_entry_key: key,
      registry_type: type,
      fda_source_serial: serial,
      responsible_professional: text(row.technician, 500),
      responsible_professional_registration: text(row.council_registration_number, 200),
      province: text(row.province, 200),
      district: text(row.district, 200),
      sector_cell_raw: text(row.sector_cell_raw, 1_000),
      source_name: sourceName,
      source_url: sourcePage,
      geocode_status: gis ? "verified" : "pending",
      geocode_provider: gis ? "government_gis" : null,
      geocode_reference: gis ? requiredText(gis.gis_global_id || gis.gis_object_id, `${key} GIS reference`, 500) : null,
      geocode_formatted_address: gis ? joinAddress(gis) : null,
      geocode_confidence: gis ? 1 : null,
      geocode_checked_at: geocodeObservedAt,
      geocode_reviewed_by: gis ? "MED250 government GIS exact-match review" : null,
      geocode_reviewed_at: geocodeObservedAt,
      geocode_review_note: gis ? requiredText(gis.review_reason, `${key} GIS review reason`, 4_000) : null,
      created_at: generatedAt,
      updated_at: generatedAt,
      _source_index: index,
    };
  });
  const keys = new Set(rows.map((row) => row.registry_entry_key));
  if (rows.length !== EXPECTED.pharmacies || keys.size !== EXPECTED.pharmacies) {
    throw new PharmacyRecoveryError("source_count_mismatch", "Pharmacy registry rows are incomplete or duplicated.");
  }
  for (const key of gisByKey.keys()) {
    if (!keys.has(key)) throw new PharmacyRecoveryError("invalid_source", `GIS registry key ${key} is absent from the current registry.`);
  }
  return rows;
}

function addEvidence(map, e164, evidence, pharmacyKeys) {
  if (!pharmacyKeys.has(evidence.pharmacy_id)) {
    throw new PharmacyRecoveryError("invalid_source", `${evidence.kind} references unknown pharmacy ${evidence.pharmacy_id}.`);
  }
  const list = map.get(e164) ?? [];
  const fingerprint = canonicalHash(evidence);
  if (!list.some((entry) => canonicalHash(entry) === fingerprint)) list.push(evidence);
  map.set(e164, list);
}

function evidenceRow({ kind, tier, pharmacyId, sourceName, sourceUrl: url, sourceReference, observedAt, loginAuthority }) {
  return {
    kind,
    tier,
    pharmacy_id: pharmacyId,
    source_name: requiredText(sourceName, `${kind} source name`, 500),
    source_url: sourceUrl(url, `${kind} source URL`, { required: true }),
    source_reference: requiredText(sourceReference, `${kind} source reference`, 1_000),
    observed_at: exactIso(observedAt, `${kind} observed_at`),
    login_authority: loginAuthority === true,
  };
}

function parseDeepContactRows(source) {
  const matches = [...source.matchAll(/jsonb_to_recordset\(\s*'(\[.*?\])'::jsonb/gsu)];
  if (matches.length !== 1) throw new PharmacyRecoveryError("invalid_source", "Deep contact evidence block is missing or duplicated.");
  let rows;
  try {
    rows = JSON.parse(matches[0][1].replaceAll("''", "'"));
  } catch {
    throw new PharmacyRecoveryError("invalid_source", "Deep contact evidence JSON is malformed.");
  }
  if (!Array.isArray(rows) || rows.length !== EXPECTED.deep_exact_rows) {
    throw new PharmacyRecoveryError("source_count_mismatch", "Deep contact evidence row count changed.");
  }
  return rows;
}

function buildNumberEvidence(inputs, pharmacyKeys) {
  const map = new Map();
  const publicRows = csvRows(inputs.public_contacts, EXPECTED.public_contact_rows, "Public-contact audit");
  for (const [index, row] of publicRows.entries()) {
    const numbers = phoneList(row.public_phone_numbers, `Public-contact row ${index + 2}`);
    if (numbers.length === 0) continue;
    const pharmacyId = registryKey("retail", integer(row.source_serial, `Public-contact row ${index + 2} source serial`, { minimum: 1, maximum: EXPECTED.retail_pharmacies }));
    const evidence = evidenceRow({
      kind: "source_verified_public_mobile",
      tier: 200,
      pharmacyId,
      sourceName: "Rwanda FDA or MMI public pharmacy mobile evidence",
      sourceUrl: row.phone_evidence_url,
      sourceReference: row.phone_evidence_reference,
      observedAt: optionalIso(row.checked_at, "2026-07-16T00:00:00Z"),
      loginAuthority: false,
    });
    for (const e164 of numbers) addEvidence(map, e164, evidence, pharmacyKeys);
  }

  const fdaRows = csvRows(inputs.fda_exact_contacts, EXPECTED.fda_exact_contact_rows, "FDA exact-contact review");
  for (const [index, row] of fdaRows.entries()) {
    if (row.review_decision !== "exact_name_and_locality") throw new PharmacyRecoveryError("invalid_source", `FDA exact-contact row ${index + 2} is not approved.`);
    const e164 = normalizeRwandaMobile(row.e164, `FDA exact-contact row ${index + 2}`);
    addEvidence(map, e164, evidenceRow({
      kind: "fda_exact_roster",
      tier: 300,
      pharmacyId: requiredText(row.registry_entry_key, "FDA exact registry key", 100),
      sourceName: "Rwanda FDA retail pharmacy duty roster July-September 2026",
      sourceUrl: row.source_url,
      sourceReference: row.source_reference,
      observedAt: "2026-07-01T00:00:00+02:00",
      loginAuthority: true,
    }), pharmacyKeys);
  }

  const mmiRows = csvRows(inputs.mmi_exact_contacts, EXPECTED.mmi_exact_contact_rows, "MMI exact-contact review");
  for (const [index, row] of mmiRows.entries()) {
    const e164 = normalizeRwandaMobile(row.e164, `MMI exact-contact row ${index + 2}`);
    addEvidence(map, e164, evidenceRow({
      kind: "mmi_exact_directory",
      tier: 300,
      pharmacyId: requiredText(row.registry_entry_key, "MMI exact registry key", 100),
      sourceName: "Rwanda Military Medical Insurance pharmacy partner directory",
      sourceUrl: row.source_url,
      sourceReference: row.source_reference,
      observedAt: "2026-07-16T00:00:00+02:00",
      loginAuthority: true,
    }), pharmacyKeys);
  }

  const independentRows = csvRows(inputs.independent_contacts, EXPECTED.independent_review_rows, "Independent contact review");
  const acceptedIndependent = independentRows.filter((row) => row.decision === "independent_exact_match");
  if (acceptedIndependent.length !== EXPECTED.independent_exact_rows) {
    throw new PharmacyRecoveryError("source_count_mismatch", "Independent exact-contact decision count changed.");
  }
  for (const [index, row] of acceptedIndependent.entries()) {
    const e164 = normalizeRwandaMobile(row.candidate_phone, `Independent exact-contact row ${index + 1}`);
    addEvidence(map, e164, evidenceRow({
      kind: "independent_exact_public_evidence",
      tier: 300,
      pharmacyId: requiredText(row.registry_entry_key, "Independent exact registry key", 100),
      sourceName: requiredText(row.best_evidence_title || row.best_evidence_domain, "Independent evidence name", 500),
      sourceUrl: row.best_evidence_url,
      sourceReference: `Independent exact-match decision with ${integer(row.exact_evidence_count, "Independent evidence count", { minimum: 1 })} corroborating source(s).`,
      observedAt: "2026-07-16T20:33:23Z",
      loginAuthority: false,
    }), pharmacyKeys);
  }

  for (const [index, row] of parseDeepContactRows(inputs.deep_contact_evidence.bytes.toString("utf8")).entries()) {
    const e164 = normalizeRwandaMobile(row.e164, `Deep exact-contact row ${index + 1}`);
    addEvidence(map, e164, evidenceRow({
      kind: "deep_independent_exact_public_evidence",
      tier: 300,
      pharmacyId: requiredText(row.registry_entry_key, "Deep exact registry key", 100),
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      sourceReference: row.source_reference,
      observedAt: row.source_observed_at,
      loginAuthority: false,
    }), pharmacyKeys);
  }
  return map;
}

function preferredEvidence(entries) {
  return [...entries].sort((left, right) =>
    Number(right.login_authority) - Number(left.login_authority)
      || right.tier - left.tier
      || right.observed_at.localeCompare(left.observed_at)
      || left.kind.localeCompare(right.kind)
      || left.pharmacy_id.localeCompare(right.pharmacy_id));
}

function deliveryQuarantines(rows) {
  const quarantines = new Map();
  for (const [index, row] of rows.entries()) {
    const contactId = requiredText(row.contact_id, `Delivery quarantine row ${index + 2} contact_id`, 100);
    if (!/^whatsapp-[a-f0-9]{32}$/.test(contactId)) {
      throw new PharmacyRecoveryError("invalid_source", `Delivery quarantine row ${index + 2} has an invalid contact_id.`);
    }
    if (quarantines.has(contactId)) throw new PharmacyRecoveryError("duplicate_source", `Delivery quarantine contact ${contactId} is duplicated.`);
    quarantines.set(contactId, {
      contact_id: contactId,
      pharmacy_id: requiredText(row.pharmacy_id, `Delivery quarantine row ${index + 2} pharmacy_id`, 100),
      provider: requiredText(row.provider, `Delivery quarantine row ${index + 2} provider`, 100),
      error_code: requiredText(row.error_code, `Delivery quarantine row ${index + 2} error_code`, 40),
      observed_at: exactIso(row.observed_at, `Delivery quarantine row ${index + 2} observed_at`),
      reason: requiredText(row.reason, `Delivery quarantine row ${index + 2} reason`, 500),
    });
  }
  return quarantines;
}

function buildIdentityRows(evidenceByNumber, importedAt, quarantines) {
  const contacts = [];
  const knownNumbers = [];
  const appliedQuarantines = new Set();
  for (const [e164, allEvidence] of [...evidenceByNumber].sort(([left], [right]) => left.localeCompare(right))) {
    const tier = Math.max(...allEvidence.map((entry) => entry.tier));
    const governingEvidence = preferredEvidence(allEvidence.filter((entry) => entry.tier === tier));
    const candidates = [...new Set(governingEvidence.map((entry) => entry.pharmacy_id))].sort();
    const resolved = candidates.length === 1;
    const pharmacyId = resolved ? candidates[0] : null;
    const matching = resolved ? preferredEvidence(governingEvidence.filter((entry) => entry.pharmacy_id === pharmacyId)) : governingEvidence;
    const evidenceSummary = {
      policy: "highest-authority-tier_then_exact-single-pharmacy",
      governing_tier: tier,
      candidate_pharmacy_ids: candidates,
      evidence: matching.map((entry) => ({
        kind: entry.kind,
        pharmacy_id: entry.pharmacy_id,
        source_name: entry.source_name,
        source_url: entry.source_url,
        source_reference: entry.source_reference,
        observed_at: entry.observed_at,
        login_authority: entry.login_authority,
      })),
      subordinate_evidence_count: allEvidence.length - governingEvidence.length,
    };
    const contactId = resolved ? `whatsapp-${sha256(`${pharmacyId}\u0000${e164}`).slice(0, 32)}` : null;
    const quarantine = contactId ? quarantines.get(contactId) : null;
    if (quarantine && quarantine.pharmacy_id !== pharmacyId) {
      throw new PharmacyRecoveryError("invalid_source", `Delivery quarantine ${contactId} does not match its governed pharmacy.`);
    }
    if (quarantine) appliedQuarantines.add(contactId);
    knownNumbers.push({
      e164,
      resolution_status: quarantine ? "retired" : resolved ? "resolved" : "ambiguous",
      pharmacy_id: quarantine ? null : pharmacyId,
      source: GOVERNED_NUMBER_SOURCE,
      source_evidence: stableJson(quarantine ? { ...evidenceSummary, delivery_quarantine: quarantine } : evidenceSummary),
      reviewed_at: quarantine ? quarantine.observed_at : resolved ? matching[0].observed_at : null,
      created_at: importedAt,
      updated_at: importedAt,
    });
    if (!resolved) continue;
    const primaryEvidence = matching[0];
    const loginEnabled = matching.some((entry) => entry.login_authority);
    contacts.push({
      id: contactId,
      pharmacy_id: pharmacyId,
      channel: "whatsapp",
      e164,
      address: null,
      verified_at: primaryEvidence.observed_at,
      source: `${GOVERNED_CONTACT_PREFIX}${primaryEvidence.kind}`,
      source_url: primaryEvidence.source_url,
      source_reference: primaryEvidence.source_reference,
      source_observed_at: primaryEvidence.observed_at,
      login_enabled: quarantine ? 0 : loginEnabled ? 1 : 0,
      dispatch_enabled: quarantine ? 0 : 1,
      is_primary: 0,
      active: quarantine ? 0 : 1,
      created_at: importedAt,
      updated_at: importedAt,
      verified_by_label: quarantine ? "MED250 production delivery verification"
        : loginEnabled ? "MED250 exact official-directory review" : "MED250 governed public-contact review",
      verification_note: quarantine
        ? `Quarantined after ${quarantine.provider} error ${quarantine.error_code}; destination requires pharmacy re-verification.`
        : loginEnabled
        ? "Exact official source mapping retained with pharmacy OTP/login and WhatsApp messaging authority."
        : "Verified Rwanda mobile retained for WhatsApp messaging; OTP/login remains disabled pending ownership verification.",
      derived_from_contact_id: null,
      _tier: tier,
    });
  }
  const unapplied = [...quarantines.keys()].filter((contactId) => !appliedQuarantines.has(contactId));
  if (unapplied.length) {
    throw new PharmacyRecoveryError("invalid_source", `Delivery quarantine contacts are not present in governed evidence: ${unapplied.join(", ")}.`);
  }
  const contactsByPharmacy = new Map();
  for (const contact of contacts.filter((row) => row.active === 1)) {
    const list = contactsByPharmacy.get(contact.pharmacy_id) ?? [];
    list.push(contact);
    contactsByPharmacy.set(contact.pharmacy_id, list);
  }
  for (const list of contactsByPharmacy.values()) {
    list.sort((left, right) => right.login_enabled - left.login_enabled || right._tier - left._tier || left.e164.localeCompare(right.e164));
    list[0].is_primary = 1;
  }
  for (const contact of contacts) delete contact._tier;
  return { contacts: contacts.sort((left, right) => left.id.localeCompare(right.id)), knownNumbers };
}

function exactCounts(pharmacies, contacts, knownNumbers) {
  const dispatchEligible = pharmacies.filter((pharmacy) => pharmacy.dispatch_enabled === 1).length;
  return {
    pharmacies: pharmacies.length,
    retail_pharmacies: pharmacies.filter((row) => row.registry_type === "retail").length,
    online_pharmacies: pharmacies.filter((row) => row.registry_type === "online").length,
    geocoded_pharmacies: pharmacies.filter((row) => row.geocode_status === "verified").length,
    known_numbers: knownNumbers.length,
    resolved_numbers: knownNumbers.filter((row) => row.resolution_status === "resolved").length,
    ambiguous_numbers: knownNumbers.filter((row) => row.resolution_status === "ambiguous").length,
    retired_numbers: knownNumbers.filter((row) => row.resolution_status === "retired").length,
    contacts: contacts.length,
    login_enabled_contacts: contacts.filter((row) => row.login_enabled === 1).length,
    contact_pharmacies: new Set(contacts.map((row) => row.pharmacy_id)).size,
    dispatch_eligible_pharmacies: dispatchEligible,
  };
}

function validateCounts(counts) {
  const expected = {
    pharmacies: EXPECTED.pharmacies,
    retail_pharmacies: EXPECTED.retail_pharmacies,
    online_pharmacies: EXPECTED.online_pharmacies,
    geocoded_pharmacies: EXPECTED.government_geocodes,
    known_numbers: EXPECTED.known_numbers,
    resolved_numbers: EXPECTED.resolved_numbers,
    ambiguous_numbers: EXPECTED.ambiguous_numbers,
    retired_numbers: EXPECTED.retired_numbers,
    contacts: EXPECTED.contacts,
    login_enabled_contacts: EXPECTED.login_enabled_contacts,
    contact_pharmacies: EXPECTED.contact_pharmacies,
    dispatch_eligible_pharmacies: EXPECTED.dispatch_eligible_pharmacies,
  };
  if (stableJson(counts) !== stableJson(expected)) {
    throw new PharmacyRecoveryError("source_count_mismatch", `Pharmacy recovery counts changed: expected ${stableJson(expected)}; observed ${stableJson(counts)}.`);
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function batches(rows, columns, table, updateGuard, { batchSize = 100, immutable = [] } = {}) {
  const statements = [];
  const updateColumns = columns.filter((column) => !new Set(["id", "e164", "created_at", ...immutable]).has(column));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const slice = rows.slice(offset, offset + batchSize);
    const values = slice.map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(", ")})`).join(",\n");
    const conflict = table === "med250_known_pharmacy_numbers" ? "e164" : "id";
    const updates = updateColumns.map((column) => `${column} = excluded.${column}`).join(", ");
    statements.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values}\nON CONFLICT(${conflict}) DO UPDATE SET ${updates}\nWHERE ${updateGuard};`);
  }
  return statements;
}

function importSql(bundle, pharmacies, contacts, knownNumbers) {
  const sourceManifest = {
    schema_version: SCHEMA_VERSION,
    source_snapshot_sha256: bundle.source_snapshot_sha256,
    row_set_sha256: bundle.row_set_sha256,
    input_files: bundle.input_files,
    counts: bundle.counts,
    authority_policy: bundle.authority_policy,
    target: bundle.target,
  };
  const officialNames = OFFICIAL_SOURCE_NAMES.map(sqlLiteral).join(", ");
  const statements = ["PRAGMA foreign_keys = ON;"];
  statements.push(...batches(
    pharmacies, PHARMACY_COLUMNS, "med250_pharmacies",
    `med250_pharmacies.registry_entry_key = excluded.registry_entry_key AND med250_pharmacies.source_name IN (${officialNames})`,
    { immutable: ["registry_entry_key", "registry_type", "fda_source_serial"], batchSize: 20 },
  ));
  statements.push(...batches(
    contacts, CONTACT_COLUMNS, "med250_pharmacy_contacts",
    `med250_pharmacy_contacts.source LIKE ${sqlLiteral(`${GOVERNED_CONTACT_PREFIX}%`)}`,
    { batchSize: 20 },
  ));
  statements.push(...batches(
    knownNumbers, NUMBER_COLUMNS, "med250_known_pharmacy_numbers",
    `med250_known_pharmacy_numbers.source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)}`,
    { batchSize: 5 },
  ));
  statements.push(`INSERT OR IGNORE INTO med250_pharmacy_registry_import_receipts (
  id, source_snapshot_sha256, source_manifest, pharmacy_count, contact_count,
  known_number_count, ambiguous_number_count, dispatch_eligible_count, target, imported_at
)
SELECT ${sqlLiteral(bundle.receipt_id)}, ${sqlLiteral(bundle.source_snapshot_sha256)}, ${sqlLiteral(stableJson(sourceManifest))},
  ${bundle.counts.pharmacies}, ${bundle.counts.contacts}, ${bundle.counts.known_numbers},
  ${bundle.counts.ambiguous_numbers}, ${bundle.counts.dispatch_eligible_pharmacies},
  ${sqlLiteral(bundle.target)}, ${sqlLiteral(bundle.imported_at)}
WHERE (SELECT count(*) FROM med250_pharmacies WHERE source_name IN (${officialNames})) = ${bundle.counts.pharmacies}
  AND (SELECT count(*) FROM med250_pharmacy_contacts WHERE source LIKE ${sqlLiteral(`${GOVERNED_CONTACT_PREFIX}%`)}) = ${bundle.counts.contacts}
  AND (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)}) = ${bundle.counts.known_numbers}
  AND (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)} AND resolution_status = 'ambiguous') = ${bundle.counts.ambiguous_numbers}
  AND (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)} AND resolution_status = 'retired') = ${bundle.counts.retired_numbers}
  AND (SELECT count(*) FROM med250_pharmacies pharmacy
       WHERE pharmacy.source_name IN (${officialNames}) AND pharmacy.dispatch_enabled = 1
         AND pharmacy.marketplace_approved = 1 AND pharmacy.licence_status = 'current'
         AND pharmacy.geocode_status = 'verified' AND pharmacy.latitude IS NOT NULL AND pharmacy.longitude IS NOT NULL
         AND EXISTS (SELECT 1 FROM med250_pharmacy_contacts contact
           WHERE contact.pharmacy_id = pharmacy.id AND contact.channel = 'whatsapp'
             AND contact.verified_at IS NOT NULL AND contact.active = 1 AND contact.dispatch_enabled = 1)) = ${bundle.counts.dispatch_eligible_pharmacies};`);
  return `${statements.join("\n")}\n`;
}

function bundleCore(bundle) {
  const { bundle_sha256, ...core } = bundle;
  void bundle_sha256;
  return core;
}

export async function buildPharmacyRecoveryBundle({ target, importedAt } = {}) {
  const normalizedTarget = exactTarget(target);
  const normalizedImportedAt = exactIso(importedAt, "imported-at");
  const files = await Promise.all(Object.values(SOURCE_PATHS).map(inputFile));
  const inputs = Object.fromEntries(Object.entries(SOURCE_PATHS).map(([name, path]) => [name, files.find((file) => file.path === path)]));
  let manifest;
  try {
    manifest = JSON.parse(inputs.manifest.bytes.toString("utf8"));
  } catch {
    throw new PharmacyRecoveryError("invalid_source", "Pharmacy source manifest JSON is malformed.");
  }
  const generatedAt = exactIso(manifest.generated_at, "source manifest generated_at");
  const retailRows = csvRows(inputs.retail, EXPECTED.retail_pharmacies, "Retail pharmacy register");
  const onlineRows = csvRows(inputs.online, EXPECTED.online_pharmacies, "Online pharmacy register");
  const gisRows = csvRows(inputs.government_gis, EXPECTED.government_geocodes, "Government GIS review");
  const quarantineRows = csvRows(inputs.delivery_quarantine, EXPECTED.delivery_quarantine_rows, "WhatsApp delivery quarantine");
  const pharmacies = buildPharmacyRows(retailRows, onlineRows, gisRows, generatedAt, normalizedImportedAt);
  const pharmacyKeys = new Set(pharmacies.map((row) => row.registry_entry_key));
  const evidenceByNumber = buildNumberEvidence(inputs, pharmacyKeys);
  const { contacts, knownNumbers } = buildIdentityRows(evidenceByNumber, normalizedImportedAt, deliveryQuarantines(quarantineRows));
  const contactPharmacies = new Set(contacts.filter((row) => row.active === 1 && row.dispatch_enabled === 1).map((row) => row.pharmacy_id));
  for (const pharmacy of pharmacies) {
    pharmacy.dispatch_enabled = pharmacy.licence_status === "current"
      && pharmacy.marketplace_approved === 1
      && pharmacy.geocode_status === "verified"
      && contactPharmacies.has(pharmacy.id) ? 1 : 0;
    delete pharmacy._source_index;
  }
  pharmacies.sort((left, right) => left.id.localeCompare(right.id));
  const counts = exactCounts(pharmacies, contacts, knownNumbers);
  validateCounts(counts);
  const inputFiles = files.map(({ path, byte_count, sha256: digest }) => ({ path, byte_count, sha256: digest }));
  const rowSetSha = canonicalHash({ pharmacies, contacts, known_numbers: knownNumbers });
  const authorityPolicy = {
    version: "2026-08-24",
    exact_match_tier: 300,
    public_mobile_tier: 200,
    rule: "Use the highest evidence tier. Resolve only when every highest-tier record identifies one pharmacy; otherwise classify as pharmacy and quarantine login/dispatch.",
    login_rule: "Only exact FDA roster and exact MMI government-directory matches grant retained OTP login authority.",
    messaging_rule: "Every resolved verified Rwanda mobile is a WhatsApp messaging contact; phone-derived contacts never gain OTP authority.",
    dispatch_rule: "Current, marketplace-approved registry row plus verified government coordinates plus resolved verified WhatsApp contact.",
    delivery_quarantine_rule: "A provider-confirmed invalid or restricted WhatsApp destination is inactive for dispatch and login and its governed number is retired until pharmacy re-verification.",
  };
  const sourceSnapshot = canonicalHash({ schema_version: SCHEMA_VERSION, input_files: inputFiles, row_set_sha256: rowSetSha, counts, authority_policy: authorityPolicy });
  const initial = {
    schema_version: SCHEMA_VERSION,
    target: normalizedTarget,
    database_name: TARGETS[normalizedTarget].database_name,
    imported_at: normalizedImportedAt,
    source_snapshot_sha256: sourceSnapshot,
    row_set_sha256: rowSetSha,
    receipt_id: `pharmacy-registry-${sourceSnapshot.slice(0, 24)}-${normalizedTarget}`,
    input_files: inputFiles,
    authority_policy: authorityPolicy,
    counts,
  };
  const provisionalSql = importSql(initial, pharmacies, contacts, knownNumbers);
  const withSql = { ...initial, sql_sha256: sha256(provisionalSql) };
  const sql = importSql(withSql, pharmacies, contacts, knownNumbers);
  if (sha256(sql) !== withSql.sql_sha256) throw new PharmacyRecoveryError("non_deterministic_sql", "Pharmacy recovery SQL is not deterministic.");
  const bundle = { ...withSql, bundle_sha256: canonicalHash(withSql) };
  return { bundle, sql, pharmacies, contacts, knownNumbers };
}

async function verifyInputs(bundle) {
  if (!Array.isArray(bundle.input_files) || bundle.input_files.length !== Object.keys(SOURCE_PATHS).length) {
    throw new PharmacyRecoveryError("invalid_bundle", "Pharmacy bundle input inventory is invalid.");
  }
  for (const expected of bundle.input_files) {
    const actual = await inputFile(expected.path);
    if (actual.byte_count !== expected.byte_count || actual.sha256 !== expected.sha256) {
      throw new PharmacyRecoveryError("source_checksum_mismatch", `${expected.path} changed after bundle creation.`);
    }
  }
}

export async function verifyPharmacyRecoveryBundle(bundle, sql) {
  if (!bundle || typeof bundle !== "object" || bundle.schema_version !== SCHEMA_VERSION) {
    throw new PharmacyRecoveryError("invalid_bundle", "Pharmacy recovery bundle schema is unsupported.");
  }
  const target = exactTarget(bundle.target);
  if (bundle.database_name !== TARGETS[target].database_name) {
    throw new PharmacyRecoveryError("environment_mismatch", "Pharmacy bundle database does not match its target.");
  }
  if (!SHA256.test(String(bundle.bundle_sha256 ?? "")) || canonicalHash(bundleCore(bundle)) !== bundle.bundle_sha256) {
    throw new PharmacyRecoveryError("bundle_checksum_mismatch", "Pharmacy bundle checksum does not match its content.");
  }
  if (!SHA256.test(String(bundle.sql_sha256 ?? "")) || sha256(sql) !== bundle.sql_sha256) {
    throw new PharmacyRecoveryError("sql_checksum_mismatch", "Pharmacy import SQL checksum does not match the bundle.");
  }
  if (!SHA256.test(String(bundle.source_snapshot_sha256 ?? "")) || !SHA256.test(String(bundle.row_set_sha256 ?? ""))) {
    throw new PharmacyRecoveryError("invalid_bundle", "Pharmacy bundle source checksums are invalid.");
  }
  validateCounts(bundle.counts);
  await verifyInputs(bundle);
  return bundle;
}

export async function writePharmacyRecoveryBundle(output, bundle, sql) {
  const directory = approvedWorkPath(output, "--output");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "bundle.json"), `${stableJson(bundle, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "import.sql"), sql, { mode: 0o600 });
  return directory;
}

export async function readPharmacyRecoveryBundle(directory) {
  const bundleDirectory = approvedWorkPath(directory, "--bundle");
  let bundle;
  let sql;
  try {
    [bundle, sql] = await Promise.all([
      readFile(join(bundleDirectory, "bundle.json"), "utf8").then(JSON.parse),
      readFile(join(bundleDirectory, "import.sql"), "utf8"),
    ]);
  } catch {
    throw new PharmacyRecoveryError("invalid_bundle", "Pharmacy bundle.json or import.sql is missing or malformed.");
  }
  await verifyPharmacyRecoveryBundle(bundle, sql);
  return { bundle, sql, directory: bundleDirectory };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new PharmacyRecoveryError("missing_argument", `${name} requires a value.`);
  return value;
}

async function wranglerCommand(args, maxBuffer = 8 * 1024 * 1024) {
  try {
    return await execFileAsync(wrangler, args, { cwd: root, maxBuffer });
  } catch (error) {
    const message = String(error?.stderr || error?.stdout || error?.message || "Wrangler command failed.").trim();
    throw new PharmacyRecoveryError("cloudflare_command_failed", message.slice(0, 4_000));
  }
}

function sourceNamesSql() {
  return OFFICIAL_SOURCE_NAMES.map(sqlLiteral).join(", ");
}

function readbackSql(bundle) {
  return `SELECT
    receipt.id, receipt.source_snapshot_sha256, receipt.pharmacy_count, receipt.contact_count,
    receipt.known_number_count, receipt.ambiguous_number_count, receipt.dispatch_eligible_count,
    (SELECT count(*) FROM med250_pharmacies WHERE source_name IN (${sourceNamesSql()})) AS observed_pharmacies,
    (SELECT count(*) FROM med250_pharmacy_contacts WHERE source LIKE ${sqlLiteral(`${GOVERNED_CONTACT_PREFIX}%`)}) AS observed_contacts,
    (SELECT count(*) FROM med250_pharmacy_contacts WHERE source LIKE ${sqlLiteral(`${GOVERNED_CONTACT_PREFIX}%`)} AND login_enabled = 1) AS observed_login_contacts,
    (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)}) AS observed_known_numbers,
    (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source = ${sqlLiteral(GOVERNED_NUMBER_SOURCE)} AND resolution_status = 'ambiguous') AS observed_ambiguous_numbers,
    (SELECT count(*) FROM med250_pharmacies WHERE source_name IN (${sourceNamesSql()}) AND dispatch_enabled = 1) AS observed_dispatch_eligible
  FROM med250_pharmacy_registry_import_receipts receipt WHERE receipt.id = ${sqlLiteral(bundle.receipt_id)};`;
}

function parseD1Json(stdout, code) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new PharmacyRecoveryError(code, "D1 pharmacy readback was not valid JSON.");
  }
  if (payload?.[0]?.success !== true) throw new PharmacyRecoveryError(code, "D1 pharmacy query failed.");
  return payload?.[0]?.results?.[0];
}

async function remoteReadback(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", readbackSql(bundle), "--json",
  ]);
  const row = parseD1Json(stdout, "d1_readback_mismatch");
  if (
    row?.id !== bundle.receipt_id
    || row?.source_snapshot_sha256 !== bundle.source_snapshot_sha256
    || Number(row?.pharmacy_count) !== bundle.counts.pharmacies
    || Number(row?.contact_count) !== bundle.counts.contacts
    || Number(row?.known_number_count) !== bundle.counts.known_numbers
    || Number(row?.ambiguous_number_count) !== bundle.counts.ambiguous_numbers
    || Number(row?.dispatch_eligible_count) !== bundle.counts.dispatch_eligible_pharmacies
    || Number(row?.observed_pharmacies) !== bundle.counts.pharmacies
    || Number(row?.observed_contacts) !== bundle.counts.contacts
    || Number(row?.observed_login_contacts) !== bundle.counts.login_enabled_contacts
    || Number(row?.observed_known_numbers) !== bundle.counts.known_numbers
    || Number(row?.observed_ambiguous_numbers) !== bundle.counts.ambiguous_numbers
    || Number(row?.observed_dispatch_eligible) !== bundle.counts.dispatch_eligible_pharmacies
  ) throw new PharmacyRecoveryError("d1_readback_mismatch", "D1 pharmacy recovery receipt does not match the bundle.");
  return row;
}

function preflightSql(bundle) {
  return `SELECT
    (SELECT count(*) FROM med250_pharmacy_registry_import_receipts WHERE id = ${sqlLiteral(bundle.receipt_id)}) AS receipt_count,
    (SELECT count(*) FROM med250_pharmacies WHERE source_name IN (${sourceNamesSql()})) AS seeded_pharmacies,
    (SELECT count(*) FROM med250_pharmacies
      WHERE (registry_entry_key LIKE 'retail-2026-05-%' OR registry_entry_key LIKE 'online-2026-05-%')
        AND (id <> registry_entry_key OR source_name NOT IN (${sourceNamesSql()}))) AS conflicting_pharmacies,
    (SELECT count(*) FROM med250_pharmacy_contacts WHERE source NOT LIKE ${sqlLiteral(`${GOVERNED_CONTACT_PREFIX}%`)}) AS conflicting_contacts,
    (SELECT count(*) FROM med250_known_pharmacy_numbers WHERE source <> ${sqlLiteral(GOVERNED_NUMBER_SOURCE)}) AS conflicting_known_numbers;`;
}

async function remotePreflight(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", preflightSql(bundle), "--json",
  ]);
  const row = parseD1Json(stdout, "d1_preflight_failed");
  const values = ["receipt_count", "seeded_pharmacies", "conflicting_pharmacies", "conflicting_contacts", "conflicting_known_numbers"]
    .map((key) => Number(row?.[key]));
  if (!values.every(Number.isSafeInteger)) throw new PharmacyRecoveryError("d1_preflight_failed", "D1 pharmacy preflight returned invalid counts.");
  const [receiptCount, seededPharmacies, conflictingPharmacies, conflictingContacts, conflictingKnownNumbers] = values;
  if (receiptCount > 1 || seededPharmacies > bundle.counts.pharmacies || conflictingPharmacies || conflictingContacts || conflictingKnownNumbers) {
    throw new PharmacyRecoveryError("d1_preflight_conflict", "D1 contains pharmacy identity rows that require explicit reconciliation before this governed import.");
  }
  return { receipt_count: receiptCount, seeded_pharmacies: seededPharmacies };
}

// This historical source pack joined December contact row numbers to May
// pharmacy row numbers. Keep it readable for forensic comparison, but never
// replay it over the reviewed production register or newly researched points.
export function assertRecoveryApplySafe(bundle) {
  if (bundle.schema_version === 'med250.cloudflare-pharmacy-recovery.v2') {
    throw new PharmacyRecoveryError('legacy_register_epoch_mismatch',
      'Legacy v2 pharmacy recovery apply is disabled: December contact serials are not May registry IDs. Use the audited exact-name/locality association repair and targeted coordinate research scripts.');
  }
}

async function runCli() {
  const command = process.argv[2];
  if (command === "build") {
    const target = exactTarget(argument("--target"));
    const built = await buildPharmacyRecoveryBundle({ target, importedAt: argument("--imported-at") });
    const directory = await writePharmacyRecoveryBundle(argument("--output"), built.bundle, built.sql);
    console.log(JSON.stringify({
      event: "cloudflare_pharmacy_recovery_bundle_built",
      target,
      directory: relative(root, directory),
      bundle_sha256: built.bundle.bundle_sha256,
      source_snapshot_sha256: built.bundle.source_snapshot_sha256,
      counts: built.bundle.counts,
    }, null, 2));
    return;
  }
  if (command !== "apply" && command !== "verify") {
    throw new PharmacyRecoveryError("invalid_command", "Command must be build, apply, or verify.");
  }
  const loaded = await readPharmacyRecoveryBundle(argument("--bundle"));
  const confirmation = `MED250 CLOUDFLARE PHARMACY ${loaded.bundle.target.toUpperCase()}`;
  if (command === "apply") {
    if (argument("--confirm") !== confirmation) {
      throw new PharmacyRecoveryError("confirmation_required", `Apply requires --confirm '${confirmation}'.`);
    }
    assertRecoveryApplySafe(loaded.bundle);
    const preflight = await remotePreflight(loaded.bundle);
    if (preflight.receipt_count === 0) {
      await wranglerCommand([
        "d1", "execute", loaded.bundle.database_name, "--remote", "--config", "wrangler.jsonc",
        "--file", join(loaded.directory, "import.sql"), "--yes",
      ], 32 * 1024 * 1024);
    }
  }
  const receipt = await remoteReadback(loaded.bundle);
  console.log(JSON.stringify({
    event: command === "apply" ? "cloudflare_pharmacy_recovery_applied" : "cloudflare_pharmacy_recovery_verified",
    target: loaded.bundle.target,
    bundle_sha256: loaded.bundle.bundle_sha256,
    source_snapshot_sha256: loaded.bundle.source_snapshot_sha256,
    receipt_id: receipt.id,
    counts: loaded.bundle.counts,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(JSON.stringify({
      event: "cloudflare_pharmacy_recovery_failed",
      code: error instanceof PharmacyRecoveryError ? error.code : "unexpected_error",
      error: error instanceof Error ? error.message : "Pharmacy recovery failed.",
    }, null, 2));
    process.exitCode = 1;
  });
}
