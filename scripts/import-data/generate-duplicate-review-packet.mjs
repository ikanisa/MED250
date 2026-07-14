import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { deriveDuplicateGroups, parseCsv } from "./verify-duplicate-register-review.mjs";

const PRODUCT_FIELDS = Object.freeze([
  "brand_name",
  "generic_name",
  "strength",
  "dosage_form",
  "pack_size",
  "shelf_life",
  "manufacturer",
  "manufacturer_country",
  "marketing_authorization_holder",
  "local_technical_representative",
  "registration_date",
  "expiry_date",
  "regulatory_status",
]);

const PHARMACY_FIELDS = Object.freeze([
  "name",
  "technician",
  "province",
  "district",
  "sector_cell_raw",
  "license_expiration_date",
  "registry_type",
]);

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function comparable(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("en");
}

function comparisonForRows(rows, fields) {
  return Object.fromEntries(fields.map((field) => {
    const values = rows.map((row) => ({ reference: row.reference, value: String(row[field] ?? "") }));
    const comparableValues = new Set(values.map(({ value }) => comparable(value)));
    return [field, { same: comparableValues.size === 1, values }];
  }));
}

export function buildDuplicateReviewPacket({ productRows, retailRows, onlineRows, sourceDigests }) {
  const pharmacies = [
    ...retailRows.map((row) => ({ ...row, registry_type: "retail", reference: `retail:${row.source_serial}` })),
    ...onlineRows.map((row) => ({ ...row, registry_type: "online", reference: `online:${row.source_serial}` })),
  ];
  const products = productRows.map((row) => ({ ...row, reference: `product:${row.source_serial}` }));
  const groups = deriveDuplicateGroups(productRows, retailRows, onlineRows).map((group) => {
    const rows = group.recordType === "product_registration"
      ? products.filter((row) => comparable(row.registration_number) === comparable(group.identifier))
      : pharmacies.filter((row) => comparable(row.council_registration_number) === comparable(group.identifier));
    const fields = group.recordType === "product_registration" ? PRODUCT_FIELDS : PHARMACY_FIELDS;
    const comparison = comparisonForRows(rows, fields);
    return {
      key: group.key,
      record_type: group.recordType,
      normalized_identifier: group.identifier,
      source_references: group.references,
      source_row_count: group.rowCount,
      differing_fields: fields.filter((field) => !comparison[field].same),
      identical_fields: fields.filter((field) => comparison[field].same),
      comparison,
    };
  });
  return {
    schema_version: "1",
    classification: "deterministic reviewer context; contains no regulatory decision or recommendation",
    generated_from: sourceDigests,
    summary: {
      group_count: groups.length,
      product_registration_groups: groups.filter((group) => group.record_type === "product_registration").length,
      pharmacy_professional_registration_groups: groups.filter((group) => group.record_type === "pharmacy_professional_registration").length,
    },
    review_rules: [
      "Use the authoritative source and named regulatory reviewer; this packet does not decide whether a repeated identifier is valid.",
      "Record decisions only in data/imports/duplicate-register-review.csv with reviewer, timezone-qualified timestamp and rationale.",
      "Never merge or remove source rows merely to make the strict verifier pass.",
    ],
    groups,
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const known = new Set(outputIndex >= 0 ? ["--output", outputPath] : []);
  const unknown = process.argv.slice(2).filter((argument) => !known.has(argument));
  if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a path.");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const paths = {
    products: "data/imports/rwanda-fda-products-july-2026.csv",
    retail: "data/imports/rwanda-fda-retail-pharmacies-may-2026.csv",
    online: "data/imports/rwanda-fda-online-pharmacies-may-2026.csv",
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [
    name,
    await readFile(path, "utf8"),
  ])));
  const packet = buildDuplicateReviewPacket({
    productRows: parseCsv(sources.products, paths.products).rows,
    retailRows: parseCsv(sources.retail, paths.retail).rows,
    onlineRows: parseCsv(sources.online, paths.online).rows,
    sourceDigests: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, {
      path,
      sha256: sha256(sources[name]),
    }])),
  });
  const serialized = `${JSON.stringify(packet, null, 2)}\n`;
  if (outputPath) {
    await writeFile(resolve(outputPath), serialized, "utf8");
    console.log(JSON.stringify({ status: "written", output: outputPath, ...packet.summary }, null, 2));
  } else {
    process.stdout.write(serialized);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
