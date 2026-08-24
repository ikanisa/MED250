import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const expectedPhysicalUatScenarios = Object.freeze([
  "PREVIEW_FAIL_CLOSED",
  "GPS_DENIAL_RECOVERY",
  "GPS_CONSENT_BOUNDED_DISPATCH",
  "PRESCRIPTION_ENFORCEMENT",
  "RECIPIENT_ISOLATION",
  "WHATSAPP_OTP_LIFECYCLE",
  "COMPLETE_OFFER_AND_SUBSTITUTE",
  "CONTACT_PRIVACY_AND_SELECTION",
  "EXPLICIT_HANDOFFS",
  "CANCELLATION_COMPLETION_EXPIRY",
  "PRESCRIPTION_ACCESS_RETENTION",
  "PRIVACY_SAFE_OPERATIONS",
]);

const allowedStatuses = new Set(["pending", "passed", "failed", "blocked"]);
const prohibitedContent = /(?:\b(?:\+?250)?7\d{8}\b|\b\d{6}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}|\b(?:latitude|longitude|otp|prescription contents?|order id|phone number)\b\s*[:=])/i;
const secretLike = /(?:sb_secret_|service[_-]?role|private[_-]?key|access[_-]?token|password|authorization:\s*bearer|[?&](?:token|secret|password|key)=)/i;

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
    && Number.isFinite(Date.parse(value));
}

function safeReference(reference, rootDir) {
  if (typeof reference !== "string" || !reference.trim()) return "is missing";
  if (secretLike.test(reference)) return "contains secret-like material";
  if (reference.startsWith("https://")) {
    try {
      const url = new URL(reference);
      if (url.username || url.password) return "contains URL credentials";
      return "";
    } catch {
      return "is not a valid HTTPS URL";
    }
  }
  if (isAbsolute(reference) || reference.split(/[\\/]/).includes("..")) return "must be repository-relative or HTTPS";
  if (!existsSync(resolve(rootDir, reference))) return `does not exist at ${reference}`;
  return "";
}

export function validatePhysicalUat(ledger, { strict = false, rootDir = process.cwd(), now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const scenarios = ledger?.scenarios && typeof ledger.scenarios === "object" ? ledger.scenarios : {};
  const names = Object.keys(scenarios).sort();
  const expected = [...expectedPhysicalUatScenarios].sort();
  if (ledger?.schema_version !== "1") errors.push("physical UAT schema_version must be 1");
  if (ledger?.release !== "med250-production") errors.push("physical UAT release must be med250-production");
  if (ledger?.environment !== "controlled-production") errors.push("physical UAT environment must be controlled-production");
  if (!allowedStatuses.has(ledger?.status)) errors.push("physical UAT has an invalid overall status");
  for (const name of expected.filter((name) => !names.includes(name))) errors.push(`missing physical UAT scenario ${name}`);
  for (const name of names.filter((name) => !expected.includes(name))) errors.push(`unexpected physical UAT scenario ${name}`);

  const identityFields = ["customer_identity_label", "pharmacy_identity_label", "unrelated_pharmacy_identity_label"];
  for (const field of identityFields) {
    const value = ledger?.[field];
    if (value && (prohibitedContent.test(value) || secretLike.test(value))) errors.push(`${field} contains a prohibited identifier or secret`);
  }

  const statusCounts = { pending: 0, passed: 0, failed: 0, blocked: 0, invalid: 0 };
  for (const name of expectedPhysicalUatScenarios) {
    const scenario = scenarios[name];
    if (!scenario) continue;
    const status = String(scenario.status ?? "");
    if (!allowedStatuses.has(status)) {
      statusCounts.invalid += 1;
      errors.push(`${name} has invalid status ${status || "missing"}`);
      continue;
    }
    statusCounts[status] += 1;
    if (typeof scenario.title !== "string" || scenario.title.trim().length < 30) errors.push(`${name} needs a concrete title`);
    const note = String(scenario.note ?? "");
    if (prohibitedContent.test(note) || secretLike.test(note)) errors.push(`${name} note contains a prohibited identifier or secret`);
    if (status === "passed") {
      const referenceError = safeReference(scenario.evidence_reference, rootDir);
      if (referenceError) errors.push(`${name} evidence ${referenceError}`);
      if (note.trim().length < 20) errors.push(`${name} passed without a useful redacted note`);
    } else if (strict) {
      errors.push(`${name} is ${status}; production UAT requires passed evidence`);
    }
  }

  if (strict || ledger?.status === "passed") {
    for (const field of identityFields) if (typeof ledger?.[field] !== "string" || ledger[field].trim().length < 3) errors.push(`${field} is required`);
    if (typeof ledger?.executed_by !== "string" || ledger.executed_by.trim().length < 3) errors.push("physical UAT requires a named executor");
    if (!validTimestamp(ledger?.started_at)) errors.push("physical UAT requires a timezone-qualified started_at");
    if (!validTimestamp(ledger?.completed_at)) errors.push("physical UAT requires a timezone-qualified completed_at");
    if (validTimestamp(ledger?.started_at) && validTimestamp(ledger?.completed_at) && Date.parse(ledger.completed_at) < Date.parse(ledger.started_at)) errors.push("physical UAT completed_at precedes started_at");
    if (typeof ledger?.approved_by !== "string" || ledger.approved_by.trim().length < 3) errors.push("physical UAT requires a named approver");
    if (typeof ledger?.approved_role !== "string" || ledger.approved_role.trim().length < 3) errors.push("physical UAT requires an approver role");
    if (!validTimestamp(ledger?.approved_at)) errors.push("physical UAT requires a timezone-qualified approved_at");
    if (validTimestamp(ledger?.approved_at) && Date.parse(ledger.approved_at) > now.getTime() + 300_000) errors.push("physical UAT approval timestamp is in the future");
    if (ledger?.status !== "passed") errors.push("physical UAT overall status must be passed");
  } else if ([ledger?.executed_by, ledger?.started_at, ledger?.completed_at, ledger?.approved_by, ledger?.approved_role, ledger?.approved_at].some(Boolean)) {
    warnings.push("pending physical UAT contains execution or approval metadata; clear it until the controlled run begins");
  }

  return { valid: errors.length === 0, strict, scenarioCount: names.length, statusCounts, errors, warnings };
}

function main() {
  const strict = process.argv.includes("--strict");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--strict");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  const ledger = JSON.parse(readFileSync("data/physical-device-uat.json", "utf8"));
  const result = validatePhysicalUat(ledger, { strict });
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
