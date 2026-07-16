import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (
  process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || ""
).trim();
const secretKey = (
  process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || ""
).trim();

function stop(message) {
  console.error(JSON.stringify({ status: "configuration_error", error: message }, null, 2));
  process.exit(2);
}

if (!supabaseUrl) stop("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
if (!secretKey) {
  stop("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required.");
}

let origin;
try {
  origin = new URL(supabaseUrl);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".supabase.co")) {
    throw new Error("invalid Supabase origin");
  }
} catch {
  stop("The Supabase URL must be an HTTPS *.supabase.co origin.");
}

const supabase = createClient(origin.toString(), secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { count: verifiedCount, error: verifiedError } = await supabase
  .from("dawanear_product_images")
  .select("product_id", { count: "exact", head: true })
  .eq("rights_verified", true);

if (verifiedError) stop(`Could not inspect verified image state: ${verifiedError.message}`);
if ((verifiedCount ?? 0) !== 0) {
  stop(
    "Cleanup refused because rights-verified image rows exist; remove only an explicitly reviewed path set.",
  );
}

async function listDirectory(prefix) {
  const output = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from("product-images").list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) stop(`Could not list product-image Storage: ${error.message}`);
    output.push(...data);
    if (data.length < 1000) break;
  }
  return output;
}

const paths = [];
const roots = await listDirectory("v1");
for (const root of roots) {
  if (!root?.name) continue;
  if (root.id) {
    paths.push(`v1/${root.name}`);
    continue;
  }
  const children = await listDirectory(`v1/${root.name}`);
  for (const child of children) {
    if (child?.id && child.name) paths.push(`v1/${root.name}/${child.name}`);
  }
}

const uniquePaths = [...new Set(paths)].sort();
for (let offset = 0; offset < uniquePaths.length; offset += 100) {
  const batch = uniquePaths.slice(offset, offset + 100);
  const { error } = await supabase.storage.from("product-images").remove(batch);
  if (error) stop(`Could not remove unverified Storage objects: ${error.message}`);
}

const remainingRoots = await listDirectory("v1");
let remainingObjectCount = 0;
for (const root of remainingRoots) {
  if (!root?.name) continue;
  if (root.id) {
    remainingObjectCount += 1;
    continue;
  }
  const children = await listDirectory(`v1/${root.name}`);
  remainingObjectCount += children.filter((child) => child?.id).length;
}

const pathSetSha256 = createHash("sha256")
  .update(uniquePaths.join("\n"))
  .digest("hex");

console.log(JSON.stringify({
  status: remainingObjectCount === 0 ? "passed" : "failed",
  verifiedRowsProtected: verifiedCount ?? 0,
  removedObjectCount: uniquePaths.length,
  removedPathSetSha256: pathSetSha256,
  remainingObjectCount,
  identifiersEmitted: false,
}, null, 2));

if (remainingObjectCount !== 0) process.exitCode = 1;
