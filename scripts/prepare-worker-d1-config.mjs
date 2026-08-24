import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const serverDirectory = join(root, "dist", "server");
const revisionPattern = /^[a-f0-9]{40}$/;
const d1DatabaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const accountSidPattern = /^AC[a-f0-9]{32}$/i;
const contentSidPattern = /^HX[a-f0-9]{32}$/i;
const whatsappSenderPattern = /^whatsapp:\+[1-9][0-9]{7,14}$/;
const e164Pattern = /^[1-9][0-9]{7,14}$/;
const execFileAsync = promisify(execFile);

function isLocalPlaceholderDatabaseId(value) {
  return /^00000000-0000-4000-8000-0000000000\d{2}$/.test(value);
}

export const requiredWorkerSecretNames = Object.freeze([
  "MED250_ADMIN_TOKEN",
  "MED250_HEALTH_PROBE_TOKEN",
  "MED250_OTP_ENCRYPTION_SECRET",
  "MED250_OTP_SECRET",
  "TURNSTILE_SECRET_KEY",
  "TWILIO_API_KEY",
  "TWILIO_API_SECRET",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_LOCATION_LINK_SECRET",
]);

const contentSidNames = Object.freeze([
  "TWILIO_CLIENT_LOCATION_CAPTURE_CONTENT_SID",
  "TWILIO_CLIENT_LOCATION_CHOICE_CONTENT_SID",
  "TWILIO_CUSTOMER_OTP_CONTENT_SID",
  "TWILIO_PHARMACY_CLIENT_MEDIA_REQUEST_CONTENT_SID",
  "TWILIO_PHARMACY_OTP_CONTENT_SID",
  "TWILIO_PHARMACY_REQUEST_CONTENT_SID",
]);

function exactEnvironmentValue(environment, name) {
  const value = String(environment[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required to prepare a Worker-D1 deployment.`);
  return value;
}

function deploymentOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MED250_DEPLOYMENT_ORIGIN must be an exact HTTPS origin.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== "/"
  ) {
    throw new Error("MED250_DEPLOYMENT_ORIGIN must be an exact HTTPS origin.");
  }
  if (parsed.origin !== "https://med-250.com") {
    throw new Error("Production Worker-D1 configuration requires https://med-250.com.");
  }
  return parsed.origin;
}

function d1DatabaseId(environment, name) {
  const value = exactEnvironmentValue(environment, name).toLowerCase();
  if (!d1DatabaseIdPattern.test(value) || isLocalPlaceholderDatabaseId(value)) {
    throw new Error(`${name} must be a real Cloudflare D1 database UUID, not a local placeholder.`);
  }
  return value;
}

function queueNames(config) {
  const producers = config?.queues?.producers ?? [];
  const consumers = config?.queues?.consumers ?? [];
  return {
    producers: producers.map((entry) => entry?.queue),
    consumers: consumers.map((entry) => entry?.queue),
  };
}

function assertGeneratedResourceBoundary(config, target) {
  const suffix = "production";
  const expectedBucket = `med250-private-media-${suffix}`;
  const buckets = (config.r2_buckets ?? []).filter((entry) => entry?.binding === "PRIVATE_MEDIA");
  if (buckets.length !== 1 || buckets[0].bucket_name !== expectedBucket) {
    throw new Error(`Generated ${target} config must bind PRIVATE_MEDIA to ${expectedBucket}.`);
  }
  const queues = queueNames(config);
  const dispatch = `med250-whatsapp-dispatch-${suffix}`;
  const deadLetter = `med250-whatsapp-dispatch-dlq-${suffix}`;
  if (queues.producers.length !== 1 || queues.producers[0] !== dispatch) {
    throw new Error(`Generated ${target} config must produce only to ${dispatch}.`);
  }
  if (!queues.consumers.includes(dispatch) || !queues.consumers.includes(deadLetter)) {
    throw new Error(`Generated ${target} config must consume both ${dispatch} and ${deadLetter}.`);
  }
  if (config?.assets?.binding !== "ASSETS" || config?.images?.binding !== "IMAGES") {
    throw new Error("Generated Worker config is missing the governed assets or images binding.");
  }
}

function configuredProviderValues(environment, origin) {
  const accountSid = exactEnvironmentValue(environment, "TWILIO_ACCOUNT_SID");
  const from = exactEnvironmentValue(environment, "TWILIO_WHATSAPP_FROM");
  const adminWhatsapp = exactEnvironmentValue(environment, "MED250_ADMIN_WHATSAPP").replace(/\D/g, "");
  if (!accountSidPattern.test(accountSid)) throw new Error("TWILIO_ACCOUNT_SID is invalid.");
  if (!whatsappSenderPattern.test(from)) throw new Error("TWILIO_WHATSAPP_FROM must use whatsapp:+E164 format.");
  if (!e164Pattern.test(adminWhatsapp)) throw new Error("MED250_ADMIN_WHATSAPP is invalid.");
  const contentSids = Object.fromEntries(contentSidNames.map((name) => {
    const value = exactEnvironmentValue(environment, name);
    if (!contentSidPattern.test(value)) throw new Error(`${name} is not a valid Twilio Content SID.`);
    return [name, value];
  }));
  return validatedProviderValues({
    MED250_ADMIN_WHATSAPP: adminWhatsapp,
    MED250_ALLOWED_ORIGINS: origin,
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_WHATSAPP_FROM: from,
    TWILIO_WHATSAPP_WEBHOOK_URL: `${origin}/api/twilio/whatsapp/inbound`,
    TWILIO_WHATSAPP_STATUS_CALLBACK_URL: `${origin}/api/twilio/whatsapp/status`,
    ...contentSids,
  }, origin);
}

function validatedProviderValues(providerValues, origin) {
  if (!providerValues || typeof providerValues !== "object" || Array.isArray(providerValues)) {
    throw new Error("Provider deployment values are required.");
  }
  if (!accountSidPattern.test(String(providerValues.TWILIO_ACCOUNT_SID ?? ""))) {
    throw new Error("TWILIO_ACCOUNT_SID is invalid.");
  }
  if (!whatsappSenderPattern.test(String(providerValues.TWILIO_WHATSAPP_FROM ?? ""))) {
    throw new Error("TWILIO_WHATSAPP_FROM must use whatsapp:+E164 format.");
  }
  if (!e164Pattern.test(String(providerValues.MED250_ADMIN_WHATSAPP ?? ""))) {
    throw new Error("MED250_ADMIN_WHATSAPP is invalid.");
  }
  if (providerValues.MED250_ALLOWED_ORIGINS !== origin) {
    throw new Error("MED250_ALLOWED_ORIGINS must equal the deployment origin.");
  }
  if (providerValues.TWILIO_WHATSAPP_WEBHOOK_URL !== `${origin}/api/twilio/whatsapp/inbound`) {
    throw new Error("TWILIO_WHATSAPP_WEBHOOK_URL must match the deployment origin.");
  }
  if (providerValues.TWILIO_WHATSAPP_STATUS_CALLBACK_URL !== `${origin}/api/twilio/whatsapp/status`) {
    throw new Error("TWILIO_WHATSAPP_STATUS_CALLBACK_URL must match the deployment origin.");
  }
  for (const name of contentSidNames) {
    if (!contentSidPattern.test(String(providerValues[name] ?? ""))) {
      throw new Error(`${name} is not a valid Twilio Content SID.`);
    }
  }
  return { ...providerValues };
}

export function prepareWorkerD1Config(generated, {
  target,
  origin,
  releaseRevision,
  d1DatabaseId: databaseId,
  providerValues,
}) {
  if (!generated || typeof generated !== "object" || Array.isArray(generated)) {
    throw new Error("Generated Wrangler config must be an object.");
  }
  if (target !== "production") throw new Error("Target must be production; MED250 has no staging deployment.");
  if (!revisionPattern.test(releaseRevision)) throw new Error("Release revision must be an exact lowercase 40-character Git SHA.");
  if (!d1DatabaseIdPattern.test(databaseId) || isLocalPlaceholderDatabaseId(databaseId)) {
    throw new Error("The D1 database ID must be a real lowercase Cloudflare UUID, not a local placeholder.");
  }
  const exactOrigin = deploymentOrigin(origin);
  const exactProviderValues = validatedProviderValues(providerValues, exactOrigin);
  assertGeneratedResourceBoundary(generated, target);

  const config = structuredClone(generated);
  for (const generatedOnlyKey of ["configPath", "userConfigPath", "topLevelName", "definedEnvironments", "legacy_env"]) {
    delete config[generatedOnlyKey];
  }
  const name = "med250-marketplace-gikundiro";
  const vars = Object.fromEntries(Object.entries(config.vars ?? {}).filter(([key]) => (
    !key.includes("SUPABASE") && !key.startsWith("NEXT_PUBLIC_MED250_") && key !== "NEXT_PUBLIC_MARKETPLACE_MODE"
  )));
  Object.assign(vars, {
    MED250_RELEASE_MODE: "live",
    MED250_BACKEND_MODE: "worker-d1",
    MED250_RELEASE_REVISION: releaseRevision,
    NEXT_PUBLIC_MED250_DEPLOYMENT_MODE: "live",
    NEXT_PUBLIC_MED250_DEPLOYMENT_ORIGIN: exactOrigin,
    NEXT_PUBLIC_MED250_INDEXING_MODE: "public",
    NEXT_PUBLIC_MARKETPLACE_MODE: "live",
    NEXT_PUBLIC_SITE_URL: exactOrigin,
    NEXT_PUBLIC_MED250_OBSERVABILITY: "cloud",
    ...exactProviderValues,
  });

  const result = {
    ...config,
    name,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: "med-250.com", custom_domain: true }],
    vars,
    d1_databases: [{
      binding: "DB",
      database_name: `med250-${target}`,
      database_id: databaseId,
      migrations_dir: "db/d1/migrations",
    }],
  };
  result.secrets = { required: [...requiredWorkerSecretNames] };
  return result;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : "";
}

async function gitRevision() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

async function artifactRevision(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && !/^wrangler\.worker-d1\./.test(entry.name)) files.push(path);
    }
  }
  await visit(directory);
  files.sort((left, right) => relative(directory, left).localeCompare(relative(directory, right)));
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(directory, path));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 40);
}

export async function run(environment = process.env) {
  const target = argumentValue("--target") || environment.MED250_DEPLOYMENT_TARGET?.trim() || "production";
  if (target !== "production") throw new Error("--target must be production; MED250 has no staging deployment.");
  const sourceConfigPath = resolve(argumentValue("--source") || join(serverDirectory, "wrangler.json"));
  const outputConfigPath = resolve(argumentValue("--output") || join(serverDirectory, `wrangler.worker-d1.${target}.json`));
  const requestedRevision = argumentValue("--revision") || environment.MED250_RELEASE_REVISION?.trim() || "git";
  if (!new Set(["git", "artifact"]).has(requestedRevision) && !revisionPattern.test(requestedRevision)) {
    throw new Error("--revision must be git, artifact, or an exact lowercase 40-character revision.");
  }
  if (requestedRevision === "artifact") throw new Error("Artifact revisions are not permitted for production deployment.");
  const releaseRevision = requestedRevision === "git"
    ? await gitRevision()
    : requestedRevision === "artifact" ? await artifactRevision(serverDirectory) : requestedRevision;
  const origin = deploymentOrigin(exactEnvironmentValue(environment, "MED250_DEPLOYMENT_ORIGIN"));
  const databaseId = d1DatabaseId(environment, "MED250_D1_DATABASE_ID");
  const providerMode = argumentValue("--provider-mode") || "required";
  if (providerMode !== "required") throw new Error("--provider-mode must be required for production deployment.");
  const providerValues = configuredProviderValues(environment, origin);
  const generated = JSON.parse(await readFile(sourceConfigPath, "utf8"));
  const config = prepareWorkerD1Config(generated, {
    target,
    origin,
    releaseRevision,
    d1DatabaseId: databaseId,
    providerValues,
  });
  await stat(join(serverDirectory, config.main));
  await stat(resolve(serverDirectory, config.assets.directory));
  await writeFile(outputConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    status: "prepared",
    target,
    worker: config.name,
    origin,
    releaseRevision,
    revisionKind: requestedRevision === "artifact" ? "artifact_sha256_160" : requestedRevision === "git" ? "git" : "explicit",
    providerMode,
    config: relative(root, outputConfigPath),
    source: basename(sourceConfigPath),
    d1Bindings: config.d1_databases.map((entry) => entry.binding),
    requiredSecretNames: config.secrets?.required ?? [],
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
