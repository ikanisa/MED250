import { pathToFileURL } from "node:url";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commands = new Set(["list", "inspect", "approve", "reject"]);

function readOptions(argv) {
  const [command, ...tokens] = argv;
  if (!commands.has(command)) throw new Error("Command must be list, inspect, approve, or reject.");
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

function requireRequestId(value) {
  const requestId = String(value || "").trim();
  if (!uuidPattern.test(requestId)) throw new Error("--request-id must be a valid UUID.");
  return requestId;
}

export function buildContactReviewPayload(argv) {
  const { command, options } = readOptions(argv);
  if (command === "list") {
    exactOptions(options, new Set(["limit"]));
    const limit = Number(options.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("--limit must be an integer from 1 to 50.");
    return { action: "list", limit };
  }
  if (command === "inspect") {
    exactOptions(options, new Set(["request-id"]));
    return { action: "inspect", request_id: requireRequestId(options["request-id"]) };
  }
  exactOptions(options, new Set(["request-id", "reviewed-by", "review-note"]));
  const reviewedBy = String(options["reviewed-by"] || "").trim();
  const reviewNote = String(options["review-note"] || "").trim();
  if (reviewedBy.length < 3 || reviewedBy.length > 200) throw new Error("--reviewed-by must be 3-200 characters.");
  if (reviewNote.length < 10 || reviewNote.length > 2000) throw new Error("--review-note must be 10-2000 characters.");
  return {
    action: command,
    request_id: requireRequestId(options["request-id"]),
    reviewed_by: reviewedBy,
    review_note: reviewNote,
  };
}

export function resolveContactReviewEndpoint(environment = process.env) {
  const rawUrl = String(environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!rawUrl) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required in the process environment.");
  const base = new URL(rawUrl);
  if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co")) {
    throw new Error("The Supabase URL must be an HTTPS *.supabase.co origin.");
  }
  return new URL("/functions/v1/review-pharmacy-contacts", base);
}

export async function runContactReviewAdmin(argv, { environment = process.env, fetchImpl = fetch } = {}) {
  const adminToken = String(environment.DAWANEAR_ADMIN_TOKEN || "").trim();
  if (!adminToken) throw new Error("DAWANEAR_ADMIN_TOKEN is required in the process environment.");
  const response = await fetchImpl(resolveContactReviewEndpoint(environment), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-DawaNear-Admin-Token": adminToken },
    body: JSON.stringify(buildContactReviewPayload(argv)),
  });
  const responseText = await response.text();
  let result;
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = { error: "The contact reviewer returned a non-JSON response." };
  }
  if (!response.ok) {
    const message = typeof result?.error === "string" ? result.error : `Contact reviewer returned HTTP ${response.status}.`;
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  return result;
}

function help() {
  return [
    "Usage:",
    "  npm run ops:contacts -- list [--limit <1-50>]",
    "  npm run ops:contacts -- inspect --request-id <uuid>",
    "  npm run ops:contacts -- approve --request-id <uuid> --reviewed-by <name> --review-note <evidence>",
    "  npm run ops:contacts -- reject --request-id <uuid> --reviewed-by <name> --review-note <reason>",
    "",
    "Required process environment: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and DAWANEAR_ADMIN_TOKEN.",
    "Every decision affects exactly one pending request; batch review is unsupported.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.length < 3) {
    console.log(help());
  } else {
    try {
      console.log(JSON.stringify(await runContactReviewAdmin(process.argv.slice(2)), null, 2));
    } catch (error) {
      console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Contact review failed." }, null, 2));
      process.exitCode = 1;
    }
  }
}
