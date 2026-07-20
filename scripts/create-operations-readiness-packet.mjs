import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCsv } from "./import-data/verify-duplicate-register-review.mjs";

const RETAIL_PATH = "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv";
const ONLINE_PATH = "data/imports/rwanda-fda-online-pharmacies-may-2026.csv";
const GPS_LEDGER_PATH = "docs/launch/evidence/gps-readiness-review-ledger-pending-2026-07-16.json";
const WHATSAPP_LEDGER_PATH = "docs/launch/evidence/whatsapp-readiness-review-ledger-pending-2026-07-16.json";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function registryRows(retailRows, onlineRows) {
  return [
    ...retailRows.map((row) => ({ ...row, registry_type: "retail", registry_entry_key: `retail-2026-05-${row.source_serial}` })),
    ...onlineRows.map((row) => ({ ...row, registry_type: "online", registry_entry_key: `online-2026-05-${row.source_serial}` })),
  ].sort((left, right) => left.registry_entry_key.localeCompare(right.registry_entry_key, "en"));
}

function publicRegistryRow(row) {
  return {
    registry_entry_key: row.registry_entry_key,
    registry_type: row.registry_type,
    source_serial: row.source_serial,
    name: row.name,
    council_registration_number: row.council_registration_number,
    province: row.province,
    district: row.district,
    sector_cell_raw: row.sector_cell_raw,
    license_expiration_date: row.license_expiration_date,
  };
}

function buildReviewSection({ gate, ledger, rows }) {
  return {
    gate,
    title: ledger.title,
    current_artifact: {
      path: gate === "MED250_GATE_GPS_READY" ? GPS_LEDGER_PATH : WHATSAPP_LEDGER_PATH,
      status: ledger.status,
      total_records: ledger.total_records,
      pending_records: ledger.pending_records,
      blocked_records: ledger.blocked_records,
    },
    allowed_decisions: ledger.allowed_decisions,
    private_review_fields: ledger.private_review_fields,
    completion_instructions: ledger.completion_instructions,
    rows: rows.map((row) => ({
      ...publicRegistryRow(row),
      decision: null,
      reviewer: null,
      reviewed_at: null,
      redacted_rationale: null,
    })),
  };
}

export function buildOperationsReadinessPacket({
  retailRows,
  onlineRows,
  gpsLedger,
  whatsappLedger,
  sourceDigests,
}) {
  const rows = registryRows(retailRows, onlineRows);
  return {
    schema_version: "1",
    release: "med250-production",
    classification: "operations review packet for GPS and WhatsApp readiness; contains no phone numbers, coordinates, credentials or owner approval",
    generated_from: sourceDigests,
    summary: {
      registry_record_count: rows.length,
      retail_record_count: retailRows.length,
      online_record_count: onlineRows.length,
      gps_pending_records: gpsLedger.pending_records,
      whatsapp_pending_records: whatsappLedger.pending_records,
    },
    review_rules: [
      "Use this packet as the public registry index only; keep precise coordinates and contact values in the controlled private operations ledger.",
      "Do not infer GPS readiness from a map search, name-only candidate, generated coordinate, or public listing without authoritative premises evidence.",
      "Do not infer WhatsApp authority from an ordinary public phone number, map listing, shared number, or browser observation.",
      "Every completed decision must include reviewer identity, role, timezone-qualified timestamp, source version, outcome, and redacted rationale in the controlled private ledger.",
      "After all rows are decided, complete the redacted launch evidence artifact and record it with npm run launch:evidence:record.",
    ],
    review_sections: [
      buildReviewSection({ gate: "MED250_GATE_GPS_READY", ledger: gpsLedger, rows }),
      buildReviewSection({ gate: "MED250_GATE_WHATSAPP_READY", ledger: whatsappLedger, rows }),
    ],
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const known = new Set(outputIndex >= 0 ? ["--output", outputPath] : []);
  const unknown = process.argv.slice(2).filter((argument) => !known.has(argument));
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const [retailSource, onlineSource, gpsLedgerSource, whatsappLedgerSource] = await Promise.all([
    readFile(RETAIL_PATH, "utf8"),
    readFile(ONLINE_PATH, "utf8"),
    readFile(GPS_LEDGER_PATH, "utf8"),
    readFile(WHATSAPP_LEDGER_PATH, "utf8"),
  ]);
  const packet = buildOperationsReadinessPacket({
    retailRows: parseCsv(retailSource, RETAIL_PATH).rows,
    onlineRows: parseCsv(onlineSource, ONLINE_PATH).rows,
    gpsLedger: JSON.parse(gpsLedgerSource),
    whatsappLedger: JSON.parse(whatsappLedgerSource),
    sourceDigests: {
      retail_registry: { path: RETAIL_PATH, sha256: sha256(retailSource) },
      online_registry: { path: ONLINE_PATH, sha256: sha256(onlineSource) },
      gps_pending_ledger: { path: GPS_LEDGER_PATH, sha256: sha256(gpsLedgerSource) },
      whatsapp_pending_ledger: { path: WHATSAPP_LEDGER_PATH, sha256: sha256(whatsappLedgerSource) },
    },
  });
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, serialized, "utf8");
    console.log(JSON.stringify({
      status: "written",
      output: outputPath,
      registry_record_count: packet.summary.registry_record_count,
      review_section_count: packet.review_sections.length,
    }, null, 2));
  } else {
    process.stdout.write(serialized);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
