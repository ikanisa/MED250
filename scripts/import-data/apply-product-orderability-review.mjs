import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

const REVIEW_COLUMNS = [
  "product_id",
  "registration_number",
  "prescription_status",
  "is_orderable",
  "reviewer",
  "reviewed_at",
  "note",
];
const REVIEW_STATUSES = new Set(["prescription", "otc", "pharmacist_only"]);
const DATABASE_STATUS = Object.freeze({
  prescription: "prescription",
  otc: "non_prescription",
  pharmacist_only: "pharmacist_only",
});
const CURRENT_REGULATORY_STATUSES = new Set(["valid", "expiring_soon"]);
const PAGE_SIZE = 1_000;
const CANONICAL_ID = /^rwanda-fda-hm-\d{4,}$/;

function usage() {
  return [
    "Usage:",
    "  npm run data:review-products -- --reviewed <review.csv>        # validate/dry run",
    "  npm run data:review-products -- --reviewed <review.csv> --apply # apply reviewed rows",
    "",
    "Required private environment variables:",
    "  SUPABASE_URL",
    "  SUPABASE_SECRET_KEY (recommended) or SUPABASE_SERVICE_ROLE_KEY (legacy)",
  ].join("\n");
}

function parseArgs(values) {
  const parsed = { apply: false, reviewed: "" };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") {
      if (parsed.apply) throw new Error("--apply may be supplied only once.");
      parsed.apply = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (value !== "--reviewed") throw new Error(`Unexpected argument: ${value}\n\n${usage()}`);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --reviewed.\n\n${usage()}`);
    if (parsed.reviewed) throw new Error("--reviewed may be supplied only once.");
    parsed.reviewed = next;
    index += 1;
  }
  if (!parsed.reviewed) throw new Error(`A completed reviewed CSV is required.\n\n${usage()}`);
  return parsed;
}

function parseCsv(text, sourcePath) {
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
  if (cell || row.length > 0) {
    row.push(cell);
    rawRows.push(row);
  }

  const headers = rawRows.shift()?.map((header, index) => {
    const normalized = header.trim();
    return index === 0 ? normalized.replace(/^\uFEFF/, "") : normalized;
  });
  if (!headers?.length) throw new Error(`${sourcePath}: CSV is empty.`);
  if (new Set(headers).size !== headers.length) throw new Error(`${sourcePath}: duplicate CSV header names.`);
  if (JSON.stringify(headers) !== JSON.stringify(REVIEW_COLUMNS)) {
    throw new Error(`${sourcePath}: headers must be exactly ${REVIEW_COLUMNS.join(",")}`);
  }

  return rawRows
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values, index) => {
      const line = index + 2;
      if (values.length !== headers.length) {
        throw new Error(`${sourcePath}: row ${line} has ${values.length} fields; expected ${headers.length}.`);
      }
      return {
        line,
        values: Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex].trim()])),
      };
    });
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeRegistrationNumber(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function parseReviewedAt(value, line, now) {
  const reviewedAt = requiredText(value, `row ${line} reviewed_at`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(reviewedAt)) {
    throw new Error(`row ${line} reviewed_at must be an ISO 8601 timestamp with a timezone.`);
  }
  const timestamp = new Date(reviewedAt);
  if (Number.isNaN(timestamp.valueOf())) throw new Error(`row ${line} reviewed_at is not a valid timestamp.`);
  if (timestamp.valueOf() > now.valueOf() + 5 * 60 * 1_000) {
    throw new Error(`row ${line} reviewed_at cannot be in the future.`);
  }
  return timestamp.toISOString();
}

function validateReviewRows(rows, now) {
  if (rows.length === 0) throw new Error("The reviewed CSV has no review rows. Nothing can be activated.");
  const identifiers = new Set();

  return rows.map(({ line, values }) => {
    const productId = values.product_id;
    const registrationNumber = values.registration_number;
    if (Boolean(productId) === Boolean(registrationNumber)) {
      throw new Error(`row ${line} must contain exactly one of product_id or registration_number.`);
    }
    if (productId && !CANONICAL_ID.test(productId)) {
      throw new Error(`row ${line} product_id is not a canonical MED250 human-medicine ID.`);
    }

    const identifier = productId ? `id:${productId}` : `registration:${normalizeRegistrationNumber(registrationNumber)}`;
    if (identifiers.has(identifier)) throw new Error(`row ${line} repeats reviewed identifier ${identifier}.`);
    identifiers.add(identifier);

    const prescriptionStatus = values.prescription_status.toLowerCase();
    if (!REVIEW_STATUSES.has(prescriptionStatus)) {
      throw new Error(`row ${line} prescription_status must be prescription, otc, or pharmacist_only.`);
    }
    if (values.is_orderable !== "true" && values.is_orderable !== "false") {
      throw new Error(`row ${line} is_orderable must be exactly true or false.`);
    }

    return {
      line,
      productId: productId || null,
      registrationNumber: registrationNumber || null,
      prescriptionStatus,
      databasePrescriptionStatus: DATABASE_STATUS[prescriptionStatus],
      isOrderable: values.is_orderable === "true",
      reviewer: requiredText(values.reviewer, `row ${line} reviewer`),
      reviewedAt: parseReviewedAt(values.reviewed_at, line, now),
      note: requiredText(values.note, `row ${line} note`),
    };
  });
}

function requireElevatedKey(value) {
  const key = requiredText(value, "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (key.startsWith("sb_publishable_")) {
    throw new Error("A publishable browser key cannot run the controlled product review.");
  }
  if (key.startsWith("sb_secret_")) return key;
  const parts = key.split(".");
  if (parts.length !== 3) throw new Error("The elevated Supabase key is neither an sb_secret key nor a service_role JWT.");
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.role !== "service_role") throw new Error("JWT role is not service_role");
  } catch {
    throw new Error("The elevated Supabase key is not a valid service_role JWT.");
  }
  return key;
}

function requireSupabaseUrl(value) {
  const raw = requiredText(value, "SUPABASE_URL");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }
  return url.toString().replace(/\/$/, "");
}

async function loadProducts(supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("dawanear_products")
      .select("id,registration_number,product_type,prescription_status,regulatory_status,expiry_date,is_orderable,is_active,source_refreshed_at,updated_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not load dawanear_products: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  if (rows.length === 0) throw new Error("dawanear_products is empty; import and verify the official human-medicine register first.");
  return rows;
}

function resolveReviews(reviews, products, now) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const byRegistration = new Map();
  for (const product of products) {
    const key = normalizeRegistrationNumber(product.registration_number);
    if (!key) continue;
    byRegistration.set(key, [...(byRegistration.get(key) ?? []), product]);
  }

  const today = now.toISOString().slice(0, 10);
  const resolvedIds = new Set();
  return reviews.map((review) => {
    let product;
    if (review.productId) {
      product = byId.get(review.productId);
      if (!product) throw new Error(`row ${review.line} references unknown product_id ${review.productId}.`);
    } else {
      const key = normalizeRegistrationNumber(review.registrationNumber);
      const matches = byRegistration.get(key) ?? [];
      if (matches.length === 0) throw new Error(`row ${review.line} references unknown registration_number ${review.registrationNumber}.`);
      if (matches.length > 1) {
        throw new Error(`row ${review.line} registration_number ${review.registrationNumber} is ambiguous across ${matches.length} products; use a canonical product_id after regulatory review.`);
      }
      [product] = matches;
    }

    if (resolvedIds.has(product.id)) throw new Error(`row ${review.line} resolves to duplicate target product ${product.id}.`);
    resolvedIds.add(product.id);
    if (product.product_type !== "human_medicine") {
      throw new Error(`row ${review.line} targets ${product.id}, which is not an imported human medicine.`);
    }
    if (!product.is_active) throw new Error(`row ${review.line} targets inactive product ${product.id}.`);
    if (!CURRENT_REGULATORY_STATUSES.has(product.regulatory_status)) {
      throw new Error(`row ${review.line} targets ${product.id} with non-current regulatory status ${product.regulatory_status}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(product.expiry_date ?? "") || product.expiry_date < today) {
      throw new Error(`row ${review.line} targets expired or undated product ${product.id}.`);
    }
    const sourceRefreshedAt = new Date(product.source_refreshed_at ?? "");
    if (Number.isNaN(sourceRefreshedAt.valueOf()) || new Date(review.reviewedAt) < sourceRefreshedAt) {
      throw new Error(`row ${review.line} review predates the current source snapshot for ${product.id}; review the refreshed record again.`);
    }

    return {
      ...review,
      id: product.id,
      canonicalRegistrationNumber: product.registration_number,
      currentPrescriptionStatus: product.prescription_status,
      currentIsOrderable: product.is_orderable,
      regulatoryStatus: product.regulatory_status,
      expiryDate: product.expiry_date,
      sourceRefreshedAt: product.source_refreshed_at,
      expectedUpdatedAt: product.updated_at,
    };
  });
}

function planSummary(resolved, reviewSha256, apply) {
  return {
    mode: apply ? "apply" : "dry-run",
    reviewSha256,
    reviewedRows: resolved.length,
    activations: resolved.filter((row) => row.isOrderable && !row.currentIsOrderable).length,
    deactivations: resolved.filter((row) => !row.isOrderable && row.currentIsOrderable).length,
    classificationChanges: resolved.filter((row) => row.databasePrescriptionStatus !== row.currentPrescriptionStatus).length,
    unchanged: resolved.filter((row) => row.databasePrescriptionStatus === row.currentPrescriptionStatus && row.isOrderable === row.currentIsOrderable).length,
    products: resolved.map((row) => ({
      id: row.id,
      registrationNumber: row.canonicalRegistrationNumber,
      prescriptionStatus: row.databasePrescriptionStatus,
      isOrderable: row.isOrderable,
      reviewer: row.reviewer,
      reviewedAt: row.reviewedAt,
    })),
  };
}

async function applyReviews(supabase, resolved) {
  let applied = 0;
  for (const row of resolved) {
    const { data, error } = await supabase
      .from("dawanear_products")
      .update({
        prescription_status: row.databasePrescriptionStatus,
        is_orderable: row.isOrderable,
      })
      .eq("id", row.id)
      .eq("product_type", "human_medicine")
      .eq("regulatory_status", row.regulatoryStatus)
      .eq("expiry_date", row.expiryDate)
      .eq("updated_at", row.expectedUpdatedAt)
      .select("id,prescription_status,is_orderable")
      .maybeSingle();
    if (error) {
      throw new Error(`Stopped after ${applied} updates; ${row.id} failed: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Stopped after ${applied} updates; ${row.id} changed after validation. Dry-run again with a freshly exported review.`);
    }
    if (data.id !== row.id || data.prescription_status !== row.databasePrescriptionStatus || data.is_orderable !== row.isOrderable) {
      throw new Error(`Stopped after ${applied} updates; ${row.id} did not verify after update.`);
    }
    applied += 1;
  }
  return applied;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reviewCsv = await readFile(args.reviewed, "utf8");
  const reviewSha256 = createHash("sha256").update(reviewCsv).digest("hex");
  const now = new Date();
  const reviews = validateReviewRows(parseCsv(reviewCsv, args.reviewed), now);

  const url = requireSupabaseUrl(process.env.SUPABASE_URL);
  const serviceRoleKey = requireElevatedKey(
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const resolved = resolveReviews(reviews, await loadProducts(supabase), now);
  const summary = planSummary(resolved, reviewSha256, args.apply);

  if (!args.apply) {
    console.log(JSON.stringify({ ...summary, applied: 0, nextStep: "Review this dry-run, then rerun with --apply." }, null, 2));
    return;
  }

  const applied = await applyReviews(supabase, resolved);
  console.log(JSON.stringify({ ...summary, applied, verified: applied === resolved.length }, null, 2));
}

main().catch((error) => {
  console.error(`PRODUCT REVIEW ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
