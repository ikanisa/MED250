import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverDirectory = join(root, "dist", "server");
const sourceConfigPath = join(serverDirectory, "wrangler.json");
const outputConfigPath = join(serverDirectory, "wrangler.gikundiro.json");
const deploymentOrigin = "https://med-250.com";
const revisionPattern = /^[a-f0-9]{40}$/;
const execFileAsync = promisify(execFile);

async function gitRevision() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : "";
}

const requestedRevision = argumentValue("--revision") || process.env.MED250_RELEASE_REVISION?.trim() || "git";
const releaseRevision = requestedRevision === "git" ? await gitRevision() : requestedRevision;
if (!revisionPattern.test(releaseRevision)) {
  throw new Error("MED250 live release revision must be an exact lowercase 40-character Git commit SHA.");
}

const generated = JSON.parse(await readFile(sourceConfigPath, "utf8"));
for (const generatedOnlyKey of [
  "configPath",
  "userConfigPath",
  "topLevelName",
  "definedEnvironments",
  "legacy_env",
]) {
  delete generated[generatedOnlyKey];
}

const optionalPublicRuntimeKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
];
const optionalPublicRuntime = Object.fromEntries(optionalPublicRuntimeKeys
  .map((key) => [key, process.env[key]?.trim()])
  .filter((entry) => entry[1]));

const deployment = {
  ...generated,
  name: "med250-marketplace-gikundiro",
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: "med-250.com", custom_domain: true }],
  vars: {
    MED250_RELEASE_MODE: "live",
    MED250_RELEASE_REVISION: releaseRevision,
    NEXT_PUBLIC_MED250_DEPLOYMENT_MODE: "live",
    NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN: deploymentOrigin,
    NEXT_PUBLIC_MARKETPLACE_MODE: "live",
    NEXT_PUBLIC_SITE_URL: deploymentOrigin,
    NEXT_PUBLIC_MED250_OBSERVABILITY: "cloud",
    ...optionalPublicRuntime,
  },
};

await stat(join(serverDirectory, deployment.main));
await stat(resolve(serverDirectory, deployment.assets.directory));
await writeFile(outputConfigPath, `${JSON.stringify(deployment, null, 2)}\n`);

console.log(JSON.stringify({
  status: "prepared",
  worker: deployment.name,
  origin: deploymentOrigin,
  releaseRevision,
  config: relative(root, outputConfigPath),
  source: basename(sourceConfigPath),
}, null, 2));
