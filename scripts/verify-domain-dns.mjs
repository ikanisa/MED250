import { readFile } from "node:fs/promises";
import { resolve4, resolveCname, resolveTxt } from "node:dns/promises";
import { pathToFileURL } from "node:url";

function normalize(type, value) {
  const trimmed = String(value ?? "").trim();
  if (type === "CNAME") return trimmed.replace(/\.$/, "").toLowerCase();
  return trimmed;
}

export function assessDomainDns(plan, observed) {
  const records = plan.hostnames.flatMap((hostname) => hostname.records).map((record) => {
    const key = `${record.type}:${record.name}`;
    const expected = [...new Set(record.values.map((value) => normalize(record.type, value)))].sort();
    const actual = [...new Set((observed[key] ?? []).map((value) => normalize(record.type, value)))].sort();
    const missing = expected.filter((value) => !actual.includes(value));
    const unexpected = actual.filter((value) => !expected.includes(value));
    return {
      type: record.type,
      name: record.name,
      purpose: record.purpose,
      expected,
      actual,
      matches: missing.length === 0,
      missing,
      unexpected,
    };
  });
  return {
    status: records.every((record) => record.matches) ? "passed" : "pending",
    productionReady: false,
    note: "DNS agreement is necessary but does not prove TLS, Sites activation, application behavior, access policy, or launch approval.",
    recordCount: records.length,
    matchingRecordCount: records.filter((record) => record.matches).length,
    records,
  };
}

async function lookup(record) {
  try {
    if (record.type === "A") return await resolve4(record.name);
    if (record.type === "CNAME") return await resolveCname(record.name);
    if (record.type === "TXT") return (await resolveTxt(record.name)).map((parts) => parts.join(""));
    throw new Error(`Unsupported DNS record type ${record.type}`);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT"].includes(error?.code)) return [];
    throw error;
  }
}

async function main() {
  if (process.argv.length > 2) throw new Error("This command does not accept arguments.");
  const plan = JSON.parse(await readFile("docs/launch/dns/med250-sites-domain-plan.json", "utf8"));
  const observed = {};
  for (const record of plan.hostnames.flatMap((hostname) => hostname.records)) {
    observed[`${record.type}:${record.name}`] = await lookup(record);
  }
  const result = assessDomainDns(plan, observed);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().catch((error) => {
  console.error(JSON.stringify({ status: "error", error: error.message }, null, 2));
  process.exitCode = 1;
});
