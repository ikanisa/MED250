import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const commands = new Set(["inspect", "approve", "withdraw"]);
const productIdPattern = /^(?:rwanda-fda-hm-[0-9]{4}|AMZ-[A-Z0-9]{10})$/;
const timezoneTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function readOptions(argv) {
  const [command, ...tokens] = argv;
  if (!commands.has(command)) throw new Error("Command must be inspect, approve, or withdraw.");
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: --${key}.`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function exactOptions(options, allowed) {
  const unexpected = Object.keys(options).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`Unsupported option for this command: --${unexpected[0]}.`);
}

function productId(value) {
  const id = String(value ?? "").trim();
  if (!productIdPattern.test(id)) throw new Error("--product-id must be a governed MED+250 product ID.");
  return id;
}

function boundedText(value, option, minimum, maximum) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new Error(`--${option} must be ${minimum}-${maximum} characters.`);
  }
  return result;
}

function timezoneTimestamp(value, option) {
  const result = String(value ?? "").trim();
  if (!timezoneTimestampPattern.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error(`--${option} must be an ISO 8601 timestamp with an explicit timezone.`);
  }
  return result;
}

function httpsUrl(value, option) {
  const result = String(value ?? "").trim();
  let url;
  try { url = new URL(result); } catch { throw new Error(`--${option} must be an HTTPS URL.`); }
  if (url.protocol !== "https:" || result.length > 2000) throw new Error(`--${option} must be an HTTPS URL.`);
  return result;
}

function reviewFields(options) {
  return {
    expected_updated_at: timezoneTimestamp(options["expected-updated-at"], "expected-updated-at"),
    reviewed_by: boundedText(options["reviewed-by"], "reviewed-by", 2, 160),
    reviewed_role: boundedText(options["reviewed-role"], "reviewed-role", 2, 160),
    reviewed_at: timezoneTimestamp(options["reviewed-at"], "reviewed-at"),
    review_note: boundedText(options["review-note"], "review-note", 20, 1000),
  };
}

export async function buildProductDescriptionReviewPayload(argv, { readFileImpl = readFile } = {}) {
  const { command, options } = readOptions(argv);
  const id = productId(options["product-id"]);
  if (command === "inspect") {
    exactOptions(options, new Set(["product-id"]));
    return { action: "inspect", product_id: id };
  }

  const shared = new Set([
    "product-id", "expected-updated-at", "reviewed-by", "reviewed-role",
    "reviewed-at", "review-note",
  ]);
  if (command === "withdraw") {
    exactOptions(options, shared);
    return { action: "withdraw", product_id: id, ...reviewFields(options) };
  }

  exactOptions(options, new Set([
    ...shared,
    "description-file", "source-file", "source-name", "source-url",
    "rights-basis", "rights-reference", "rights-verified",
    "clinical-review-status",
  ]));
  const descriptionPath = boundedText(options["description-file"], "description-file", 1, 2000);
  const sourcePath = boundedText(options["source-file"], "source-file", 1, 2000);
  const [description, sourceBytes] = await Promise.all([
    readFileImpl(descriptionPath, "utf8"),
    readFileImpl(sourcePath),
  ]);
  if (typeof description !== "string") throw new Error("--description-file must contain UTF-8 text.");
  if (description.length < 40 || description.length > 2000 || description.trim() !== description || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new Error("--description-file must contain 40-2000 trimmed characters without control characters.");
  }
  const sourceBuffer = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes);
  if (sourceBuffer.length < 1 || sourceBuffer.length > 2_000_000) {
    throw new Error("--source-file must contain 1-2,000,000 bytes.");
  }
  if (String(options["rights-verified"] ?? "").trim().toLowerCase() !== "yes") {
    throw new Error("--rights-verified must be yes after the exact source rights have been checked.");
  }
  const clinicalReviewStatus = String(options["clinical-review-status"] ?? "").trim().toLowerCase();
  if (!new Set(["approved", "not_required"]).has(clinicalReviewStatus)) {
    throw new Error("--clinical-review-status must be approved or not_required.");
  }

  return {
    action: "approve",
    product_id: id,
    ...reviewFields(options),
    description,
    source_name: boundedText(options["source-name"], "source-name", 2, 160),
    source_url: httpsUrl(options["source-url"], "source-url"),
    source_sha256: createHash("sha256").update(sourceBuffer).digest("hex"),
    rights_basis: boundedText(options["rights-basis"], "rights-basis", 20, 500),
    rights_reference: boundedText(options["rights-reference"], "rights-reference", 12, 500),
    rights_verified: true,
    clinical_review_status: clinicalReviewStatus,
  };
}

export function resolveProductDescriptionReviewEndpoint(environment = process.env) {
  const rawUrl = String(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!rawUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
  const base = new URL(rawUrl);
  if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co")) {
    throw new Error("The Supabase URL must be an HTTPS *.supabase.co origin.");
  }
  return new URL("/functions/v1/review-product-descriptions", base);
}

export async function runProductDescriptionAdmin(argv, {
  environment = process.env,
  fetchImpl = fetch,
  readFileImpl = readFile,
} = {}) {
  const adminToken = String(environment.MED250_ADMIN_TOKEN || environment.DAWANEAR_ADMIN_TOKEN || "").trim();
  if (!adminToken) throw new Error("MED250_ADMIN_TOKEN is required.");
  const payload = await buildProductDescriptionReviewPayload(argv, { readFileImpl });
  const response = await fetchImpl(resolveProductDescriptionReviewEndpoint(environment), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MED250-Admin-Token": adminToken },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  let result;
  try { result = responseText ? JSON.parse(responseText) : {}; }
  catch { result = { error: "Description reviewer returned non-JSON output." }; }
  if (!response.ok) throw new Error(`${result?.error ?? `Description reviewer returned HTTP ${response.status}.`} (HTTP ${response.status})`);
  return result;
}

function help() {
  return [
    "Usage:",
    "  npm run ops:product-descriptions -- inspect --product-id <product-id>",
    "  npm run ops:product-descriptions -- approve --product-id <product-id> --expected-updated-at <inspect timestamp> --description-file <reviewed text file> --source-file <exact source bytes> --source-name <name> --source-url <https-url> --rights-basis <basis> --rights-reference <durable reference> --rights-verified yes --clinical-review-status <approved|not_required> --reviewed-by <name> --reviewed-role <role> --reviewed-at <timestamp with timezone> --review-note <rationale>",
    "  npm run ops:product-descriptions -- withdraw --product-id <product-id> --expected-updated-at <inspect timestamp> --reviewed-by <name> --reviewed-role <role> --reviewed-at <timestamp with timezone> --review-note <reason>",
    "",
    "Required process environment: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and MED250_ADMIN_TOKEN.",
    "Approval reads the description and exact source from files, computes the source SHA-256 locally, and affects exactly one product.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.length < 3) console.log(help());
  else {
    try { console.log(JSON.stringify(await runProductDescriptionAdmin(process.argv.slice(2)), null, 2)); }
    catch (error) {
      console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Description review failed." }, null, 2));
      process.exitCode = 1;
    }
  }
}
