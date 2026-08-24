import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const workRoot = join(root, "work");
const rebuildRoot = join(workRoot, "catalogue-media-rebuild");
const recovery = join(root, "scripts", "cloudflare-media-recovery.mjs");
const bundlesRoot = join(workRoot, "cloudflare-media-recovery-production-shards");
const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const CONFIRMATION = "MED250 CLOUDFLARE MEDIA PRODUCTION";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : fallback;
}

function governedPath(value, parent, label) {
  const path = resolve(root, value);
  if (path !== parent && !path.startsWith(`${parent}${sep}`)) throw new Error(`${label} escapes its governed work directory`);
  return path;
}

function positiveInteger(value, label, fallback) {
  if (value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

async function runStreaming(args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [recovery, ...args], { cwd: root, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Media recovery child failed with ${signal ? `signal ${signal}` : `exit ${code}`}`));
    });
  });
}

async function bundleExists(directory) {
  try {
    await Promise.all([access(join(directory, "bundle.json")), access(join(directory, "import.sql"))]);
    return true;
  } catch {
    return false;
  }
}

async function receiptAlreadyVerified(directory) {
  try {
    await execFileAsync(process.execPath, [recovery, "verify", "--bundle", directory], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (argument("--confirm") !== CONFIRMATION) throw new Error(`Apply requires --confirm '${CONFIRMATION}'`);
  const indexPath = governedPath(
    argument("--index", "work/catalogue-media-rebuild/shards/index.json"),
    rebuildRoot,
    "Shard index",
  );
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const { snapshot_sha256: snapshot, ...core } = index;
  if (!SHA256.test(String(snapshot ?? "")) || sha256(stableJson(core)) !== snapshot) throw new Error("Shard index checksum is invalid");
  if (!Array.isArray(index.shards) || index.shards.length !== index.shard_count) throw new Error("Shard index counts are invalid");
  const start = positiveInteger(argument("--start"), "--start", 1);
  const limit = positiveInteger(argument("--limit"), "--limit", index.shards.length);
  const selected = index.shards.slice(start - 1, start - 1 + limit);
  if (!selected.length) throw new Error("No indexed shards were selected");

  let applied = 0;
  let retained = 0;
  for (const shard of selected) {
    const manifest = governedPath(shard.manifest, rebuildRoot, "Shard manifest");
    const bundle = governedPath(
      join(bundlesRoot, `${String(shard.number).padStart(4, "0")}-${shard.snapshot_sha256.slice(0, 16)}`),
      bundlesRoot,
      "Shard bundle",
    );
    if (!await bundleExists(bundle)) {
      await runStreaming(["build", "--manifest", manifest, "--target", "production", "--output", bundle]);
    }
    if (await receiptAlreadyVerified(bundle)) {
      retained += 1;
      process.stdout.write(`${JSON.stringify({ event: "cloudflare_media_shard_retained", shard: shard.number, receipt_verified: true })}\n`);
      continue;
    }
    await runStreaming(["apply", "--bundle", bundle, "--confirm", CONFIRMATION]);
    applied += 1;
  }
  process.stdout.write(`${JSON.stringify({
    event: "cloudflare_media_shards_complete",
    selected_shards: selected.length,
    applied_shards: applied,
    retained_shards: retained,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "cloudflare_media_shards_failed", error: error instanceof Error ? error.message : "Shard recovery failed" }, null, 2));
  process.exitCode = 1;
});
