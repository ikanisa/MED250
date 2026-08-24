import { pathToFileURL } from "node:url";
import { callWorkerOperator, resolveWorkerOperatorEndpoint } from "./worker-operator-client.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commands = new Set(["generate", "inspect", "approve"]);

function readOptions(argv) {
  const [command, ...tokens] = argv;
  if (!commands.has(command)) {
    throw new Error("Command must be generate, inspect, or approve.");
  }
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

function requireUuid(value) {
  const pharmacyId = String(value || "").trim();
  if (!uuidPattern.test(pharmacyId)) throw new Error("--pharmacy-id must be a valid UUID.");
  return pharmacyId;
}

export function buildGeocodePayload(argv) {
  const { command, options } = readOptions(argv);
  if (command === "generate") {
    exactOptions(options, new Set(["pharmacy-id", "batch-limit"]));
    const payload = { action: "generate" };
    if (options["pharmacy-id"]) payload.pharmacy_id = requireUuid(options["pharmacy-id"]);
    if (options["batch-limit"]) {
      const batchLimit = Number(options["batch-limit"]);
      if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 25) {
        throw new Error("--batch-limit must be an integer from 1 to 25.");
      }
      payload.batch_limit = batchLimit;
    }
    return payload;
  }

  if (command === "inspect") {
    exactOptions(options, new Set(["pharmacy-id"]));
    return { action: "inspect", pharmacy_id: requireUuid(options["pharmacy-id"]) };
  }

  exactOptions(options, new Set(["pharmacy-id", "google-place-id", "reviewed-by", "review-note"]));
  const placeId = String(options["google-place-id"] || "").trim();
  const reviewedBy = String(options["reviewed-by"] || "").trim();
  const reviewNote = String(options["review-note"] || "").trim();
  if (!placeId || placeId.length > 300) throw new Error("--google-place-id is required and must be at most 300 characters.");
  if (reviewedBy.length < 3 || reviewedBy.length > 200) throw new Error("--reviewed-by must be 3-200 characters.");
  if (reviewNote.length < 10 || reviewNote.length > 2000) throw new Error("--review-note must be 10-2000 characters.");
  return {
    action: "approve",
    pharmacy_id: requireUuid(options["pharmacy-id"]),
    google_place_id: placeId,
    reviewed_by: reviewedBy,
    review_note: reviewNote,
  };
}

export function resolveGeocodeEndpoint(environment = process.env) {
  return resolveWorkerOperatorEndpoint("/api/internal/operator/geocode", environment);
}

export async function runGeocodeAdmin(argv, { environment = process.env, fetchImpl = fetch } = {}) {
  return callWorkerOperator("/api/internal/operator/geocode", buildGeocodePayload(argv), {
    environment,
    fetchImpl,
    responseLabel: "Geocoder",
  });
}

function help() {
  return [
    "Usage:",
    "  npm run ops:geocode -- generate [--pharmacy-id <uuid>] [--batch-limit <1-25>]",
    "  npm run ops:geocode -- inspect --pharmacy-id <uuid>",
    "  npm run ops:geocode -- approve --pharmacy-id <uuid> --google-place-id <id> --reviewed-by <name> --review-note <evidence>",
    "",
    "Required process environment: MED250_OPERATOR_ORIGIN and MED250_ADMIN_TOKEN.",
    "Approval always affects exactly one staged candidate; batch approval is unsupported.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.length < 3) {
    console.log(help());
  } else {
    try {
      console.log(JSON.stringify(await runGeocodeAdmin(process.argv.slice(2)), null, 2));
    } catch (error) {
      console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Geocode operation failed." }, null, 2));
      process.exitCode = 1;
    }
  }
}
