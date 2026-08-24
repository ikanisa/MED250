import { pathToFileURL } from "node:url";
import { callWorkerOperator, resolveWorkerOperatorEndpoint } from "./worker-operator-client.mjs";

const commands = new Set(["list", "inspect", "start-review", "compliance-review", "approve", "reject", "unpublish"]);
const decisions = new Map([
  ["start-review", "start_review"],
  ["compliance-review", "compliance_review"],
  ["approve", "approve"],
  ["reject", "reject"],
  ["unpublish", "unpublish"],
]);

function readOptions(argv) {
  const [command, ...tokens] = argv;
  if (!commands.has(command)) throw new Error("Unsupported marketplace product command.");
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
  if (!/^AMZ-[A-Z0-9]{10}$/.test(id)) throw new Error("--product-id must be an AMZ- product ID.");
  return id;
}

function httpsUrl(value, label, required) {
  const url = String(value ?? "").trim();
  if (!url && !required) return undefined;
  if (!url.startsWith("https://") || url.length > 2000) throw new Error(`--${label} must be an HTTPS URL.`);
  return url;
}

export function buildMarketplaceProductPayload(argv) {
  const { command, options } = readOptions(argv);
  if (command === "list") {
    exactOptions(options, new Set(["status", "category", "limit"]));
    const limit = Number(options.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100.");
    return { action: "list", status: options.status ?? "research_candidate", category: options.category ?? "", limit };
  }
  if (command === "inspect") {
    exactOptions(options, new Set(["product-id"]));
    return { action: "inspect", product_id: productId(options["product-id"]) };
  }

  exactOptions(options, new Set([
    "product-id", "expected-updated-at", "reviewed-by", "evidence-note",
    "compliance-evidence-url",
  ]));
  const reviewedBy = String(options["reviewed-by"] ?? "").trim();
  const evidenceNote = String(options["evidence-note"] ?? "").trim();
  const expectedUpdatedAt = String(options["expected-updated-at"] ?? "").trim();
  if (reviewedBy.length < 3 || reviewedBy.length > 200) throw new Error("--reviewed-by must be 3-200 characters.");
  if (evidenceNote.length < 20 || evidenceNote.length > 4000) throw new Error("--evidence-note must be 20-4000 characters.");
  if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new Error("--expected-updated-at must be a valid timestamp copied from inspect.");
  return {
    action: decisions.get(command),
    product_id: productId(options["product-id"]),
    expected_updated_at: expectedUpdatedAt,
    reviewed_by: reviewedBy,
    evidence_note: evidenceNote,
    compliance_evidence_url: httpsUrl(options["compliance-evidence-url"], "compliance-evidence-url", false),
  };
}

export function resolveMarketplaceProductEndpoint(environment = process.env) {
  return resolveWorkerOperatorEndpoint("/api/internal/operator/products", environment);
}

export async function runMarketplaceProductAdmin(argv, { environment = process.env, fetchImpl = fetch } = {}) {
  return callWorkerOperator("/api/internal/operator/products", buildMarketplaceProductPayload(argv), {
    environment,
    fetchImpl,
    responseLabel: "Marketplace reviewer",
  });
}

function help() {
  return [
    "Usage:",
    "  npm run ops:marketplace-products -- list [--status <status>] [--category <department>] [--limit <1-100>]",
    "  npm run ops:marketplace-products -- inspect --product-id <AMZ-id>",
    "  npm run ops:marketplace-products -- start-review --product-id <AMZ-id> --expected-updated-at <timestamp> --reviewed-by <name> --evidence-note <note>",
    "  npm run ops:marketplace-products -- compliance-review ... [--compliance-evidence-url <https-url>]",
    "  npm run ops:marketplace-products -- approve ... [--compliance-evidence-url <https-url>]",
    "  npm run ops:marketplace-products -- reject|unpublish ...",
    "",
    "Required environment: MED250_OPERATOR_ORIGIN and MED250_ADMIN_TOKEN.",
    "Products are central catalogue records; pharmacies are the only sellers and provide offers.",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--help") || process.argv.length < 3) console.log(help());
  else {
    try { console.log(JSON.stringify(await runMarketplaceProductAdmin(process.argv.slice(2)), null, 2)); }
    catch (error) {
      console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Marketplace review failed." }, null, 2));
      process.exitCode = 1;
    }
  }
}
