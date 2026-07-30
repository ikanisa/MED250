import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const configPath = resolve(projectDirectory, "wrangler.jsonc");
const supportedEnvironments = new Set(["gikundiro", "production"]);
const requiredPublicVariables = [
  "NEXT_PUBLIC_MED250_DEPLOYMENT_MODE",
  "NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN",
  "NEXT_PUBLIC_MARKETPLACE_MODE",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_MED250_OBSERVABILITY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
];

export async function loadCloudflareBuildEnvironment(environmentName) {
  if (!supportedEnvironments.has(environmentName)) {
    throw new Error(`Unsupported Cloudflare build environment: ${environmentName || "(missing)"}`);
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const configuredVariables = config.env?.[environmentName]?.vars;
  if (!configuredVariables || typeof configuredVariables !== "object") {
    throw new Error(`wrangler.jsonc does not define vars for ${environmentName}.`);
  }

  for (const variableName of requiredPublicVariables) {
    if (typeof configuredVariables[variableName] !== "string" || !configuredVariables[variableName].trim()) {
      throw new Error(`wrangler.jsonc is missing required ${environmentName} build variable ${variableName}.`);
    }
  }

  return Object.fromEntries(
    Object.entries(configuredVariables)
      .filter(([name, value]) => name.startsWith("NEXT_PUBLIC_") && typeof value === "string")
      .map(([name, value]) => [name, value.trim()]),
  );
}

export async function buildCloudflareEnvironment(environmentName) {
  const publicVariables = await loadCloudflareBuildEnvironment(environmentName);
  const vinextBinary = resolve(
    projectDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vinext.cmd" : "vinext",
  );
  const result = spawnSync(vinextBinary, ["build"], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      ...publicVariables,
      CLOUDFLARE_ENV: environmentName,
      WRANGLER_LOG_PATH: resolve(projectDirectory, ".wrangler", "wrangler.log"),
    },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`vinext production build exited with status ${result.status ?? "unknown"}.`);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  await buildCloudflareEnvironment(process.argv[2]);
}
