import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const REVIEW_COLUMNS = Object.freeze([
  "record_type",
  "normalized_identifier",
  "source_references",
  "source_row_count",
  "decision",
  "reviewer",
  "reviewed_at",
  "note",
]);

export const REVIEW_DECISIONS = Object.freeze([
  "pending",
  "accepted_source_duplicate",
  "blocked_source_correction",
]);

function normalizedIdentifier(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function parseCsv(text, sourcePath = "CSV") {
  const rawRows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell);
      rawRows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  if (quoted) throw new Error(`${sourcePath}: unterminated quoted CSV field.`);
  if (cell || row.length) {
    row.push(cell);
    rawRows.push(row);
  }
  const headers = rawRows.shift()?.map((header, index) => (
    index === 0 ? header.replace(/^\uFEFF/, "") : header
  ));
  if (!headers?.length) throw new Error(`${sourcePath}: CSV is empty.`);
  if (new Set(headers).size !== headers.length) throw new Error(`${sourcePath}: duplicate CSV headers.`);
  const rows = rawRows
    .filter((values) => values.some((value) => value !== ""))
    .map((values, index) => {
      if (values.length !== headers.length) {
        throw new Error(`${sourcePath}: row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
      }
      return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    });
  return { headers, rows };
}

function collectDuplicateGroups(rows, recordType, identifierForRow, referenceForRow) {
  const groups = new Map();
  for (const row of rows) {
    const identifier = normalizedIdentifier(identifierForRow(row));
    if (!identifier) continue;
    const references = groups.get(identifier) ?? [];
    references.push(referenceForRow(row));
    groups.set(identifier, references);
  }
  return [...groups.entries()]
    .filter(([, references]) => references.length > 1)
    .map(([identifier, references]) => ({
      key: `${recordType}:${identifier}`,
      recordType,
      identifier,
      references: references.sort(),
      rowCount: references.length,
    }));
}

export function deriveDuplicateGroups(productRows, retailRows, onlineRows) {
  return [
    ...collectDuplicateGroups(
      productRows,
      "product_registration",
      (row) => row.registration_number,
      (row) => `product:${row.source_serial}`,
    ),
    ...collectDuplicateGroups(
      [
        ...retailRows.map((row) => ({ ...row, registry_type: "retail" })),
        ...onlineRows.map((row) => ({ ...row, registry_type: "online" })),
      ],
      "pharmacy_professional_registration",
      (row) => row.council_registration_number,
      (row) => `${row.registry_type}:${row.source_serial}`,
    ),
  ].sort((left, right) => left.key.localeCompare(right.key));
}

function validReviewTimestamp(value, now) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.valueOf() <= now.valueOf() + 5 * 60 * 1_000;
}

export function assessDuplicateReview(expectedGroups, reviewRows, { strict = false, now = new Date() } = {}) {
  const errors = [];
  const expected = new Map(expectedGroups.map((group) => [group.key, group]));
  const seen = new Set();
  const decisionCounts = Object.fromEntries(REVIEW_DECISIONS.map((decision) => [decision, 0]));

  for (let index = 0; index < reviewRows.length; index += 1) {
    const row = reviewRows[index];
    const line = index + 2;
    const recordType = String(row.record_type ?? "").trim();
    const identifier = normalizedIdentifier(row.normalized_identifier);
    const key = `${recordType}:${identifier}`;
    if (seen.has(key)) {
      errors.push(`row ${line}: duplicate review key ${key}`);
      continue;
    }
    seen.add(key);
    const group = expected.get(key);
    if (!group) {
      errors.push(`row ${line}: ${key} is not a current duplicate source group`);
      continue;
    }
    const references = String(row.source_references ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
    if (JSON.stringify(references) !== JSON.stringify(group.references)) {
      errors.push(`row ${line}: source references do not match the current imports`);
    }
    if (Number(row.source_row_count) !== group.rowCount || !/^\d+$/.test(String(row.source_row_count ?? ""))) {
      errors.push(`row ${line}: source_row_count must be ${group.rowCount}`);
    }
    const decision = String(row.decision ?? "").trim();
    if (!REVIEW_DECISIONS.includes(decision)) {
      errors.push(`row ${line}: decision must be ${REVIEW_DECISIONS.join(", ")}`);
      continue;
    }
    decisionCounts[decision] += 1;
    const reviewer = String(row.reviewer ?? "").trim();
    const reviewedAt = String(row.reviewed_at ?? "").trim();
    const note = String(row.note ?? "").trim();
    if (decision === "pending") {
      if (reviewer || reviewedAt || note) errors.push(`row ${line}: pending decisions cannot contain review metadata`);
      if (strict) errors.push(`row ${line}: ${key} is still pending review`);
    } else {
      if (!reviewer) errors.push(`row ${line}: reviewer is required for ${decision}`);
      if (!note) errors.push(`row ${line}: note is required for ${decision}`);
      if (!validReviewTimestamp(reviewedAt, now)) {
        errors.push(`row ${line}: reviewed_at must be a valid, non-future ISO 8601 timestamp with timezone`);
      }
      if (strict && decision === "blocked_source_correction") {
        errors.push(`row ${line}: ${key} remains blocked for source correction`);
      }
    }
  }

  for (const group of expectedGroups) {
    if (!seen.has(group.key)) errors.push(`missing review row for ${group.key}`);
  }

  return {
    valid: errors.length === 0,
    strict,
    expectedGroupCount: expectedGroups.length,
    reviewedRowCount: reviewRows.length,
    decisionCounts,
    errors,
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createPendingReviewCsv(groups) {
  const lines = [REVIEW_COLUMNS.join(",")];
  for (const group of groups) {
    lines.push([
      group.recordType,
      group.identifier,
      group.references.join(";"),
      group.rowCount,
      "pending",
      "",
      "",
      "",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const strict = process.argv.includes("--strict");
  const emit = process.argv.includes("--emit-pending");
  const knownArgs = new Set(["--strict", "--emit-pending"]);
  const unknown = process.argv.slice(2).filter((value) => !knownArgs.has(value));
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);

  const [products, retail, online] = await Promise.all([
    readFile("data/imports/rwanda-fda-products-july-2026.csv", "utf8"),
    readFile("data/imports/rwanda-fda-retail-pharmacies-may-2026.csv", "utf8"),
    readFile("data/imports/rwanda-fda-online-pharmacies-may-2026.csv", "utf8"),
  ]);
  const groups = deriveDuplicateGroups(
    parseCsv(products, "products").rows,
    parseCsv(retail, "retail pharmacies").rows,
    parseCsv(online, "online pharmacies").rows,
  );
  if (emit) {
    process.stdout.write(createPendingReviewCsv(groups));
    return;
  }

  const reviewPath = "data/imports/duplicate-register-review.csv";
  const review = parseCsv(await readFile(reviewPath, "utf8"), reviewPath);
  if (JSON.stringify(review.headers) !== JSON.stringify(REVIEW_COLUMNS)) {
    throw new Error(`${reviewPath}: headers must be exactly ${REVIEW_COLUMNS.join(",")}`);
  }
  const result = assessDuplicateReview(groups, review.rows, { strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
