import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = resolve(import.meta.dirname, "..");
const workRoot = join(root, "work");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const PRODUCT_ID = /^[A-Za-z0-9-]{1,80}$/;
const R2_KEY = /^catalogue\/[A-Za-z0-9-]{1,80}\/[a-f0-9]{64}-[1-6]\.webp$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const RIGHTS_POLICY_ID = /^[a-z0-9-]{12,120}$/;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const PARTNER_RIGHTS_CONFIRMED_AT = "2026-08-24T00:00:00.000Z";
const PARTNER_RIGHTS_VERIFIED_BY = "MED+250 product owner";
const PARTNER_PORTFOLIO_POLICY_ID = "partner-portfolio-20260824";
const PARTNER_RIGHTS_POLICIES = [
  {
    id: "partner-amazon-20260824",
    name: "Amazon",
    domains: ["amazon.ae", "amazon.ca", "amazon.co.uk", "amazon.co.za", "amazon.com", "amazon.com.au", "amazon.com.br", "amazon.de", "amazon.in", "amazon.sa", "amazon.sg", "media-amazon.com", "ssl-images-amazon.com"],
  },
  {
    id: "partner-walmart-20260824",
    name: "Walmart",
    domains: ["walmart.ca", "walmart.com", "walmart.com.mx", "walmartimages.com"],
  },
  {
    id: "partner-ebay-20260824",
    name: "eBay",
    domains: ["ebay.com", "ebayimg.com"],
  },
];
// Shard orchestration may run up to three non-overlapping production streams.
// Keep each stream bounded so aggregate Cloudflare API pressure stays modest.
const R2_CONCURRENCY = 8;

export class MediaRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MediaRecoveryError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(value) {
  return sha256(Buffer.from(stableJson(value), "utf8"));
}

function objectValue(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MediaRecoveryError("invalid_manifest", `${label} must be a JSON object.`);
  }
  return value;
}

function stringValue(value, label, maximum = 2_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new MediaRecoveryError("invalid_manifest", `${label} is invalid.`);
  }
  return value.trim();
}

function integerValue(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MediaRecoveryError("invalid_manifest", `${label} is invalid.`);
  }
  return value;
}

function approvedWorkPath(value, label) {
  const path = resolve(value);
  if (path !== workRoot && !path.startsWith(`${workRoot}${sep}`)) {
    throw new MediaRecoveryError("unsafe_path", `${label} must be inside the repository work directory.`);
  }
  return path;
}

function repositoryPath(value, label) {
  const path = resolve(root, value);
  if (!path.startsWith(`${root}${sep}`)) throw new MediaRecoveryError("unsafe_path", `${label} escapes the repository.`);
  return path;
}

function imageType(bytes) {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  if (!Number.isFinite(value)) throw new MediaRecoveryError("invalid_manifest", "A numeric media field is invalid.");
  return String(value);
}

function manifestCore(manifest) {
  const { snapshot_sha256: _snapshot, ...core } = manifest;
  return core;
}

function partnerRightsPolicy(sourceDomain) {
  const domain = String(sourceDomain ?? "").trim().toLowerCase().replace(/\.$/, "");
  return PARTNER_RIGHTS_POLICIES.find((policy) => policy.domains.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  )) ?? null;
}

function verifiedRights(image, productId, position) {
  const partner = partnerRightsPolicy(image.source_domain);
  if (partner) {
    return {
      rights_basis: `Rights verified under MED+250 confirmed ${partner.name} partner authorization; exact source URLs, content hash, and recovery receipt retained.`,
      rights_verified: true,
      rights_policy_id: partner.id,
      rights_verified_by: PARTNER_RIGHTS_VERIFIED_BY,
      rights_verified_at: PARTNER_RIGHTS_CONFIRMED_AT,
    };
  }
  if (image.rights_verified !== true) {
    throw new MediaRecoveryError("rights_unverified", `Image rights are not verified for ${productId}/${position}.`);
  }
  const policyId = stringValue(image.rights_policy_id, `rights_policy_id ${productId}/${position}`, 120);
  if (!RIGHTS_POLICY_ID.test(policyId)) {
    throw new MediaRecoveryError("rights_unverified", `Image rights policy is invalid for ${productId}/${position}.`);
  }
  const verifiedAt = stringValue(image.rights_verified_at, `rights_verified_at ${productId}/${position}`, 80);
  if (!Number.isFinite(Date.parse(verifiedAt))) {
    throw new MediaRecoveryError("rights_unverified", `Image rights verification time is invalid for ${productId}/${position}.`);
  }
  return {
    rights_basis: stringValue(image.rights_basis, `rights_basis ${productId}/${position}`, 500),
    rights_verified: true,
    rights_policy_id: policyId,
    rights_verified_by: stringValue(image.rights_verified_by, `rights_verified_by ${productId}/${position}`, 160),
    rights_verified_at: verifiedAt,
  };
}

export function validateSourceManifest(manifest) {
  objectValue(manifest, "Recovery manifest");
  if (manifest.schema_version !== 1) throw new MediaRecoveryError("invalid_manifest", "Recovery manifest schema_version must be 1.");
  if (!PROJECT_REF.test(String(manifest.source_project_ref ?? ""))) {
    throw new MediaRecoveryError("invalid_manifest", "Recovery manifest source project reference is invalid.");
  }
  if (!SHA256.test(String(manifest.snapshot_sha256 ?? ""))) {
    throw new MediaRecoveryError("invalid_manifest", "Recovery manifest snapshot hash is invalid.");
  }
  if (canonicalHash(manifestCore(manifest)) !== manifest.snapshot_sha256) {
    throw new MediaRecoveryError("manifest_checksum_mismatch", "Recovery manifest checksum does not match its content.");
  }
  if (!Array.isArray(manifest.products)) throw new MediaRecoveryError("invalid_manifest", "Recovery manifest products must be an array.");
  return manifest;
}

function governedImage(image, productId, position) {
  objectValue(image, `Image ${productId}/${position}`);
  if (image.recovery_status !== "exact_processed_bytes") return null;
  if (image.product_id !== productId || image.position !== position) {
    throw new MediaRecoveryError("invalid_manifest", `Image identity is inconsistent for ${productId}/${position}.`);
  }
  if (!R2_KEY.test(String(image.r2_key ?? "")) || !SHA256.test(String(image.content_sha256 ?? ""))) {
    throw new MediaRecoveryError("invalid_manifest", `Image key or checksum is invalid for ${productId}/${position}.`);
  }
  const expectedKey = `catalogue/${productId}/${image.content_sha256}-${position}.webp`;
  if (image.r2_key !== expectedKey) throw new MediaRecoveryError("invalid_manifest", `Image key is not canonical for ${productId}/${position}.`);
  const localPath = stringValue(image.exact_cache_path, `exact_cache_path ${productId}/${position}`, 1_000);
  if (
    !localPath.startsWith("data/product-images/cache/")
    && !localPath.startsWith("work/catalogue-media-rebuild/")
    && !localPath.startsWith("work/catalogue-media-acquisition/")
  ) {
    throw new MediaRecoveryError("unsafe_path", `Image cache path is outside the retained media cache for ${productId}/${position}.`);
  }
  const perceptualHash = image.perceptual_hash === null ? null : String(image.perceptual_hash ?? "").toLowerCase();
  if (perceptualHash !== null && !/^[a-f0-9]{16}$/.test(perceptualHash)) {
    throw new MediaRecoveryError("invalid_manifest", `Perceptual hash is invalid for ${productId}/${position}.`);
  }
  const qualityScore = Number(image.quality_score);
  if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100) {
    throw new MediaRecoveryError("invalid_manifest", `Quality score is invalid for ${productId}/${position}.`);
  }
  const rights = verifiedRights(image, productId, position);
  return {
    product_id: productId,
    position,
    r2_key: image.r2_key,
    content_sha256: image.content_sha256,
    perceptual_hash: perceptualHash,
    local_path: localPath,
    byte_count: integerValue(image.exact_byte_count, `exact_byte_count ${productId}/${position}`, 1_000, MAX_IMAGE_BYTES),
    content_type: "image/webp",
    legacy_public_url: stringValue(image.legacy_public_url, `legacy_public_url ${productId}/${position}`),
    source_page_url: stringValue(image.source_page_url, `source_page_url ${productId}/${position}`),
    source_image_url: stringValue(image.source_image_url, `source_image_url ${productId}/${position}`),
    source_domain: stringValue(image.source_domain, `source_domain ${productId}/${position}`, 255),
    source_kind: stringValue(image.source_kind, `source_kind ${productId}/${position}`, 120),
    ...rights,
    width: integerValue(image.width, `width ${productId}/${position}`, 1, 10_000),
    height: integerValue(image.height, `height ${productId}/${position}`, 1, 10_000),
    quality_score: qualityScore,
    checked_at: stringValue(image.checked_at, `checked_at ${productId}/${position}`, 80),
  };
}

async function verifiedObject(record, read = readFile) {
  const absolute = repositoryPath(record.local_path, "Media cache path");
  const file = await stat(absolute);
  if (!file.isFile() || file.size !== record.byte_count || file.size > MAX_IMAGE_BYTES) {
    throw new MediaRecoveryError("media_size_mismatch", `Retained media size does not match ${record.r2_key}.`);
  }
  const bytes = await read(absolute);
  if (imageType(bytes) !== record.content_type || sha256(bytes) !== record.content_sha256) {
    throw new MediaRecoveryError("media_checksum_mismatch", `Retained media checksum does not match ${record.r2_key}.`);
  }
  return { ...record, absolute_path: absolute };
}

function importSql(bundle, receiptManifest) {
  const receiptId = bundle.receipt_id;
  const timestamp = bundle.generated_at;
  const statements = ["PRAGMA foreign_keys = ON;"];
  // D1 remote imports do not accept SQL BEGIN/COMMIT. Stage exact metadata as
  // non-public rows first, create the immutable receipt only after all rows are
  // present, then approve the receipt-bound rows. Every step is idempotent, so
  // an interrupted import is safe to resume and cannot expose partial media.
  // The portfolio authorization is deliberately exact-asset scoped. Register
  // only the checksum-bound objects in this operator-confirmed bundle before
  // the image rows are staged; the D1 rights trigger rejects any mismatch in
  // product, position, hash, or source domain.
  for (const image of bundle.objects) {
    if (image.rights_policy_id !== PARTNER_PORTFOLIO_POLICY_ID) continue;
    statements.push(`INSERT OR IGNORE INTO med250_media_rights_policy_assets (policy_id, product_id, position, content_sha256, source_domain, registered_by, registered_at) VALUES (${[
      sqlString(PARTNER_PORTFOLIO_POLICY_ID), sqlString(image.product_id), sqlNumber(image.position),
      sqlString(image.content_sha256), sqlString(image.source_domain.toLowerCase()),
      sqlString(image.rights_verified_by), sqlString(image.rights_verified_at),
    ].join(", ")});`);
  }
  for (const image of bundle.objects) {
    statements.push(`INSERT INTO med250_product_images (product_id, position, r2_key, legacy_public_url, source_page_url, source_image_url, source_domain, source_kind, rights_basis, rights_verified, rights_policy_id, rights_verified_by, rights_verified_at, width, height, quality_score, content_sha256, perceptual_hash, background_removed, approved, checked_at, recovery_receipt_id, created_at) VALUES (${[
      sqlString(image.product_id), sqlNumber(image.position), sqlString(image.r2_key), sqlString(image.legacy_public_url),
      sqlString(image.source_page_url), sqlString(image.source_image_url), sqlString(image.source_domain), sqlString(image.source_kind),
      sqlString(image.rights_basis), "1", sqlString(image.rights_policy_id), sqlString(image.rights_verified_by), sqlString(image.rights_verified_at),
      sqlNumber(image.width), sqlNumber(image.height), sqlNumber(image.quality_score),
      sqlString(image.content_sha256), sqlString(image.perceptual_hash), "1", "0", sqlString(image.checked_at),
      "NULL", sqlString(timestamp),
    ].join(", ")}) ON CONFLICT(product_id, position) DO UPDATE SET r2_key=excluded.r2_key, legacy_public_url=excluded.legacy_public_url, source_page_url=excluded.source_page_url, source_image_url=excluded.source_image_url, source_domain=excluded.source_domain, source_kind=excluded.source_kind, rights_basis=excluded.rights_basis, rights_verified=1, rights_policy_id=excluded.rights_policy_id, rights_verified_by=excluded.rights_verified_by, rights_verified_at=excluded.rights_verified_at, width=excluded.width, height=excluded.height, quality_score=excluded.quality_score, content_sha256=excluded.content_sha256, perceptual_hash=excluded.perceptual_hash, background_removed=1, approved=0, checked_at=excluded.checked_at, recovery_receipt_id=NULL WHERE med250_product_images.approved = 0;`);
  }
  const expectedRows = JSON.stringify(bundle.objects.map((image) => ({
    product_id: image.product_id,
    position: image.position,
    r2_key: image.r2_key,
    content_sha256: image.content_sha256,
  })));
  statements.push(`WITH expected AS (
  SELECT
    json_extract(value, '$.product_id') AS product_id,
    json_extract(value, '$.position') AS position,
    json_extract(value, '$.r2_key') AS r2_key,
    json_extract(value, '$.content_sha256') AS content_sha256
  FROM json_each(${sqlString(expectedRows)})
)
INSERT OR IGNORE INTO med250_catalogue_media_recovery_receipts (id, source_project_ref, source_snapshot_sha256, import_snapshot_sha256, source_manifest, gallery_count, image_count, byte_count, target, imported_at)
SELECT ${[
    receiptId,
    bundle.source_project_ref,
    bundle.source_snapshot_sha256,
    bundle.import_snapshot_sha256,
    JSON.stringify(receiptManifest),
    bundle.gallery_count,
    bundle.image_count,
    bundle.byte_count,
    bundle.target,
    timestamp,
  ].map(sqlString).join(", ")}
WHERE (SELECT count(*) FROM med250_product_images image JOIN expected USING (product_id, position)
  WHERE image.r2_key = expected.r2_key AND image.content_sha256 = expected.content_sha256
    AND image.background_removed = 1 AND image.rights_verified = 1) = ${bundle.image_count};`);
  for (const image of bundle.objects) {
    statements.push(`UPDATE med250_product_images SET approved = 1, recovery_receipt_id = ${sqlString(receiptId)}
WHERE product_id = ${sqlString(image.product_id)} AND position = ${sqlNumber(image.position)}
  AND r2_key = ${sqlString(image.r2_key)} AND content_sha256 = ${sqlString(image.content_sha256)}
  AND background_removed = 1 AND rights_verified = 1
  AND rights_policy_id = ${sqlString(image.rights_policy_id)}
  AND EXISTS (SELECT 1 FROM med250_catalogue_media_recovery_receipts WHERE id = ${sqlString(receiptId)});`);
  }
  return `${statements.join("\n")}\n`;
}

export async function buildMediaRecoveryBundle(manifestInput, { target, manifestPath = "work/catalogue-media-recovery-manifest.json" } = {}) {
  if (!new Set(["staging", "production"]).has(target)) throw new MediaRecoveryError("invalid_target", "Target must be staging or production.");
  const manifest = validateSourceManifest(manifestInput);
  const objects = [];
  let skippedNonExactGalleries = 0;
  for (const product of manifest.products) {
    objectValue(product, "Recovery product");
    const productId = String(product.product_id ?? "");
    if (!PRODUCT_ID.test(productId) || !Array.isArray(product.images) || product.images.length < 3 || product.images.length > 6) {
      throw new MediaRecoveryError("invalid_manifest", "Recovery product identity or gallery size is invalid.");
    }
    const governed = product.images.map((image, index) => governedImage(image, productId, index + 1));
    if (governed.some((image) => image === null)) {
      skippedNonExactGalleries += 1;
      continue;
    }
    for (const record of governed) objects.push(await verifiedObject(record));
  }
  if (!objects.length) throw new MediaRecoveryError("no_exact_galleries", "No complete exact-byte galleries are recoverable.");
  const galleryCount = new Set(objects.map((object) => object.product_id)).size;
  const byteCount = objects.reduce((sum, object) => sum + object.byte_count, 0);
  const portableObjects = objects.map(({ absolute_path: _absolute, ...object }) => object);
  const importSnapshotSha256 = canonicalHash({ target, objects: portableObjects });
  const generatedAt = new Date().toISOString();
  const receiptId = `media-recovery-${target}-${importSnapshotSha256.slice(0, 24)}`;
  const bundleBase = {
    schema_version: 1,
    target,
    database_name: `med250-${target}`,
    bucket_name: `med250-private-media-${target}`,
    generated_at: generatedAt,
    source_project_ref: manifest.source_project_ref,
    source_manifest_path: relative(root, resolve(manifestPath)),
    source_snapshot_sha256: manifest.snapshot_sha256,
    import_snapshot_sha256: importSnapshotSha256,
    receipt_id: receiptId,
    gallery_count: galleryCount,
    image_count: portableObjects.length,
    byte_count: byteCount,
    skipped_non_exact_galleries: skippedNonExactGalleries,
    objects: portableObjects,
  };
  const receiptManifest = {
    schema_version: 1,
    source_snapshot_sha256: manifest.snapshot_sha256,
    import_snapshot_sha256: importSnapshotSha256,
    exact_gallery_count: galleryCount,
    exact_image_count: portableObjects.length,
    skipped_non_exact_galleries: skippedNonExactGalleries,
  };
  const sql = importSql(bundleBase, receiptManifest);
  const withSql = { ...bundleBase, sql_sha256: sha256(sql) };
  const bundle = { ...withSql, bundle_sha256: canonicalHash(withSql) };
  return { bundle, sql };
}

export async function verifyBundleFiles(bundle, sql, read = readFile) {
  objectValue(bundle, "Cloudflare media bundle");
  const { bundle_sha256: bundleHash, ...base } = bundle;
  if (!SHA256.test(String(bundleHash ?? "")) || canonicalHash(base) !== bundleHash) {
    throw new MediaRecoveryError("bundle_checksum_mismatch", "Cloudflare media bundle checksum is invalid.");
  }
  if (!SHA256.test(String(bundle.sql_sha256 ?? "")) || sha256(sql) !== bundle.sql_sha256) {
    throw new MediaRecoveryError("sql_checksum_mismatch", "Cloudflare media SQL checksum is invalid.");
  }
  if (bundle.database_name !== `med250-${bundle.target}` || bundle.bucket_name !== `med250-private-media-${bundle.target}`) {
    throw new MediaRecoveryError("cross_environment_bundle", "Cloudflare media bundle crosses an environment boundary.");
  }
  const verified = [];
  for (const record of bundle.objects ?? []) verified.push(await verifiedObject(record, read));
  if (verified.length !== bundle.image_count || new Set(verified.map((record) => record.product_id)).size !== bundle.gallery_count) {
    throw new MediaRecoveryError("bundle_count_mismatch", "Cloudflare media bundle counts are inconsistent.");
  }
  if (verified.reduce((sum, record) => sum + record.byte_count, 0) !== bundle.byte_count) {
    throw new MediaRecoveryError("bundle_count_mismatch", "Cloudflare media bundle byte count is inconsistent.");
  }
  return verified;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
}

async function readBundle(directory) {
  const bundleDirectory = approvedWorkPath(directory, "--bundle");
  const [bundleBytes, sql] = await Promise.all([
    readFile(join(bundleDirectory, "bundle.json"), "utf8"),
    readFile(join(bundleDirectory, "import.sql"), "utf8"),
  ]);
  return { directory: bundleDirectory, bundle: JSON.parse(bundleBytes), sql };
}

async function writeBundle(directory, bundle, sql) {
  const output = approvedWorkPath(directory, "--output");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  await Promise.all([
    writeFile(join(output, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }),
    writeFile(join(output, "import.sql"), sql, { encoding: "utf8", mode: 0o600, flag: "wx" }),
  ]);
  return output;
}

async function wranglerCommand(args, maximum = 16 * 1024 * 1024) {
  return execFileAsync(wrangler, args, { cwd: root, maxBuffer: maximum, encoding: "utf8" });
}

function commandOutput(error) {
  return `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
}

async function wranglerR2CommandWithRetry(args, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await wranglerCommand(args);
    } catch (error) {
      const output = commandOutput(error);
      const rateLimited = /429|too many requests|rate.?limit/i.test(output);
      const transientAuth = /401:\s*unauthorized|authentication error/i.test(output);
      const transientGateway = /\b5\d\d:\s|error code 5\d\d|api gateway/i.test(output);
      const transientNetwork = /fetch failed|connectivity issue|econnreset|etimedout|socket hang up/i.test(output);
      const retryLimit = transientAuth
        ? Math.min(attempts, 3)
        : transientGateway || transientNetwork
          ? Math.min(attempts, 6)
          : attempts;
      if ((!rateLimited && !transientAuth && !transientGateway && !transientNetwork) || attempt + 1 >= retryLimit) throw error;
      const backoff = transientAuth
        ? 2_000 * (attempt + 1)
        : transientGateway || transientNetwork
          ? Math.min(30_000, 3_000 * (2 ** attempt))
          : Math.min(60_000, 5_000 * (2 ** attempt));
      await delay(backoff + Math.floor(Math.random() * 1_000));
    }
  }
  throw new MediaRecoveryError("r2_rate_limited", "Cloudflare R2 retry budget was exhausted.");
}

async function remoteObjectHash(bucket, record, temporaryDirectory) {
  const destination = join(temporaryDirectory, sha256(record.r2_key));
  await rm(destination, { force: true });
  try {
    await wranglerR2CommandWithRetry(["r2", "object", "get", `${bucket}/${record.r2_key}`, "--remote", "--file", destination]);
  } catch (error) {
    const output = commandOutput(error);
    if (/specified key does not exist/i.test(output)) return null;
    throw new MediaRecoveryError("r2_readback_command_failed", `R2 could not read ${record.r2_key}: ${output.trim().slice(0, 1_000)}`);
  }
  const bytes = await readFile(destination);
  return { sha256: sha256(bytes), byteCount: bytes.length };
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function remoteObjectHashWithRetry(bucket, record, temporaryDirectory, attempts = 9) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const readback = await remoteObjectHash(bucket, record, temporaryDirectory);
    if (readback) return readback;
    if (attempt + 1 < attempts) await delay(Math.min(30_000, 1_000 * (2 ** attempt)));
  }
  return null;
}

async function forEachConcurrent(values, concurrency, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await operation(values[index], index);
    }
  });
  await Promise.all(workers);
}

async function uploadObjects(bundle, verified) {
  const temporary = await mkdtemp(join(tmpdir(), "med250-r2-verify-"));
  try {
    // Keys are content-addressed by the locally verified SHA-256. Upload before
    // GET so a remote API negative-cache entry cannot hide the new object.
    await forEachConcurrent(verified, R2_CONCURRENCY, async (record) => {
      await wranglerR2CommandWithRetry([
        "r2", "object", "put", `${bundle.bucket_name}/${record.r2_key}`,
        "--remote", "--force", "--file", record.absolute_path,
        "--content-type", record.content_type,
        "--cache-control", "public, max-age=31536000, immutable",
        "--content-disposition", "inline",
      ]);
    });
    let verifiedCount = 0;
    await forEachConcurrent(verified, R2_CONCURRENCY, async (record) => {
      const readback = await remoteObjectHashWithRetry(bundle.bucket_name, record, temporary);
      if (!readback || readback.sha256 !== record.content_sha256 || readback.byteCount !== record.byte_count) {
        throw new MediaRecoveryError("r2_readback_mismatch", `R2 readback failed for ${record.r2_key}: expected ${record.content_sha256}/${record.byte_count}, received ${readback?.sha256 ?? "missing"}/${readback?.byteCount ?? 0}.`);
      }
      verifiedCount += 1;
      if (verifiedCount % 100 === 0) process.stderr.write(`Verified ${verifiedCount}/${verified.length} immutable R2 objects.\n`);
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function d1ReadbackCommand(bundle) {
  return `SELECT r.id, r.gallery_count, r.image_count, r.byte_count, count(i.r2_key) AS approved_images FROM med250_catalogue_media_recovery_receipts r LEFT JOIN med250_product_images i ON i.recovery_receipt_id = r.id AND i.approved = 1 AND i.rights_verified = 1 WHERE r.id = ${sqlString(bundle.receipt_id)} GROUP BY r.id, r.gallery_count, r.image_count, r.byte_count;`;
}

async function d1Readback(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", d1ReadbackCommand(bundle), "--json",
  ]);
  const payload = JSON.parse(stdout);
  const row = payload?.[0]?.results?.[0];
  if (
    payload?.[0]?.success !== true
    || row?.id !== bundle.receipt_id
    || Number(row?.gallery_count) !== bundle.gallery_count
    || Number(row?.image_count) !== bundle.image_count
    || Number(row?.byte_count) !== bundle.byte_count
    || Number(row?.approved_images) !== bundle.image_count
  ) throw new MediaRecoveryError("d1_readback_mismatch", "D1 media recovery receipt does not match the bundle.");
  return row;
}

function d1PreflightCommand(bundle) {
  const expected = bundle.objects.map((record) => ({
    product_id: record.product_id,
    position: record.position,
    r2_key: record.r2_key,
    content_sha256: record.content_sha256,
  }));
  return `WITH expected AS (
    SELECT
      json_extract(value, '$.product_id') AS product_id,
      json_extract(value, '$.position') AS position,
      json_extract(value, '$.r2_key') AS r2_key,
      json_extract(value, '$.content_sha256') AS content_sha256
    FROM json_each(${sqlString(JSON.stringify(expected))})
  )
  SELECT
    (SELECT count(*) FROM med250_catalogue_products WHERE id IN (SELECT DISTINCT product_id FROM expected)) AS product_count,
    (SELECT count(*) FROM med250_product_images image JOIN expected USING (product_id, position)) AS existing_image_count,
    (SELECT count(*) FROM med250_product_images image JOIN expected USING (product_id, position)
      WHERE coalesce(image.r2_key, '') <> expected.r2_key OR coalesce(image.content_sha256, '') <> expected.content_sha256) AS conflicting_image_count,
    (SELECT count(*) FROM med250_catalogue_media_recovery_receipts WHERE id = ${sqlString(bundle.receipt_id)}) AS receipt_count;`;
}

async function d1Preflight(bundle) {
  const { stdout } = await wranglerCommand([
    "d1", "execute", bundle.database_name, "--remote", "--config", "wrangler.jsonc",
    "--command", d1PreflightCommand(bundle), "--json",
  ]);
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new MediaRecoveryError("d1_preflight_failed", "D1 media preflight did not return valid JSON.");
  }
  const row = payload?.[0]?.results?.[0];
  const expectedProducts = new Set(bundle.objects.map((record) => record.product_id)).size;
  if (
    payload?.[0]?.success !== true
    || Number(row?.product_count) !== expectedProducts
    || !Number.isSafeInteger(Number(row?.existing_image_count))
    || Number(row?.existing_image_count) > bundle.image_count
    || Number(row?.conflicting_image_count) !== 0
    || ![0, 1].includes(Number(row?.receipt_count))
  ) throw new MediaRecoveryError("d1_preflight_conflict", "D1 media rows conflict with the checksum-bound bundle or their catalogue products are missing.");
  return row;
}

async function runCli() {
  const command = process.argv[2];
  if (command === "build") {
    const manifestPath = approvedWorkPath(argument("--manifest"), "--manifest");
    const target = argument("--target");
    const output = argument("--output");
    if (!output) throw new MediaRecoveryError("missing_argument", "--output is required.");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const built = await buildMediaRecoveryBundle(manifest, { target, manifestPath });
    const directory = await writeBundle(output, built.bundle, built.sql);
    console.log(JSON.stringify({
      event: "cloudflare_media_recovery_bundle_built",
      target,
      directory: relative(root, directory),
      bundle_sha256: built.bundle.bundle_sha256,
      import_snapshot_sha256: built.bundle.import_snapshot_sha256,
      gallery_count: built.bundle.gallery_count,
      image_count: built.bundle.image_count,
      byte_count: built.bundle.byte_count,
    }, null, 2));
    return;
  }
  if (command !== "apply" && command !== "verify") {
    throw new MediaRecoveryError("invalid_command", "Command must be build, apply, or verify.");
  }
  const loaded = await readBundle(argument("--bundle"));
  const verified = await verifyBundleFiles(loaded.bundle, loaded.sql);
  const expectedConfirmation = `MED250 CLOUDFLARE MEDIA ${loaded.bundle.target.toUpperCase()}`;
  if (command === "apply") {
    if (argument("--confirm") !== expectedConfirmation) {
      throw new MediaRecoveryError("confirmation_required", `Apply requires --confirm '${expectedConfirmation}'.`);
    }
    await d1Preflight(loaded.bundle);
    await uploadObjects(loaded.bundle, verified);
    await wranglerCommand([
      "d1", "execute", loaded.bundle.database_name, "--remote", "--config", "wrangler.jsonc",
      "--file", join(loaded.directory, "import.sql"), "--yes",
    ], 32 * 1024 * 1024);
  }
  const receipt = await d1Readback(loaded.bundle);
  console.log(JSON.stringify({
    event: command === "apply" ? "cloudflare_media_recovery_applied" : "cloudflare_media_recovery_verified",
    target: loaded.bundle.target,
    bundle_sha256: loaded.bundle.bundle_sha256,
    receipt_id: receipt.id,
    gallery_count: Number(receipt.gallery_count),
    image_count: Number(receipt.image_count),
    byte_count: Number(receipt.byte_count),
    r2_objects_locally_verified: verified.length,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(JSON.stringify({
      event: "cloudflare_media_recovery_failed",
      code: error instanceof MediaRecoveryError ? error.code : "unexpected_error",
      error: error instanceof Error ? error.message : "Media recovery failed.",
    }, null, 2));
    process.exitCode = 1;
  });
}
