import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(".");
const legacyClientAssets = resolve("dist/client/assets");
const vinextClientAssets = resolve("dist/client/_next/static");
const clientAssets = existsSync(legacyClientAssets) ? legacyClientAssets : vinextClientAssets;
const marketplaceAssets = resolve("public/marketplace");
const errors = [];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function bytes(paths) {
  return paths.reduce((total, path) => total + statSync(path).size, 0);
}

function transferBytes(paths) {
  return paths.reduce(
    (total, path) => total + gzipSync(readFileSync(path), { level: 9 }).byteLength,
    0,
  );
}

function enforce(label, actual, maximum) {
  if (actual > maximum) errors.push(`${label} is ${(actual / 1024).toFixed(1)} KiB; budget is ${(maximum / 1024).toFixed(1)} KiB.`);
}

if (!existsSync(clientAssets)) {
  throw new Error("Build assets are missing. Run the production build before checking performance budgets.");
}

const builtAssets = filesUnder(clientAssets);
const javascript = builtAssets.filter((path) => extname(path) === ".js");
const css = builtAssets.filter((path) => extname(path) === ".css");
const marketplaceJavascript = javascript.filter((path) => /marketplace-[^/]+\.js$/.test(path));
const optimizedMarketplaceImages = filesUnder(marketplaceAssets).filter((path) => extname(path) === ".webp");
const wordmark = resolve("public/brand/med-plus-250-wordmark-220.png");

const totals = {
  javascriptRawBytes: bytes(javascript),
  javascriptTransferBytes: transferBytes(javascript),
  cssRawBytes: bytes(css),
  cssTransferBytes: transferBytes(css),
  marketplaceJavascriptRawBytes: bytes(marketplaceJavascript),
  marketplaceJavascriptTransferBytes: transferBytes(marketplaceJavascript),
  initialVisualAssetBytes: bytes([...optimizedMarketplaceImages, wordmark]),
  optimizedMarketplaceImageCount: optimizedMarketplaceImages.length,
};

// Vinext 1.0's hardened runtime adds shared routing code; keep the complete
// browser graph capped tightly while retaining the narrower marketplace budget.
enforce("Total browser JavaScript transfer", totals.javascriptTransferBytes, 256 * 1024);
enforce("Total browser CSS transfer", totals.cssTransferBytes, 40 * 1024);
enforce("Marketplace browser JavaScript transfer", totals.marketplaceJavascriptTransferBytes, 120 * 1024);
enforce("Optimized marketplace visuals plus header wordmark", totals.initialVisualAssetBytes, 100 * 1024);

for (const image of optimizedMarketplaceImages) enforce(relative(root, image), statSync(image).size, 20 * 1024);

const sourceFiles = [resolve("app/brand-logo.tsx"), resolve("app/marketplace.tsx")];
const source = sourceFiles.map((path) => readFileSync(path, "utf8")).join("\n");
if (source.includes("/brand/med-plus-250-wordmark.png")) errors.push("The storefront references the 600 KiB source wordmark instead of its display-sized derivative.");
if (/\/marketplace\/(?:hero-pharmacy-still-life|category-|product-pack-)[^"']*\.png/.test(source)) {
  errors.push("The storefront references a large PNG marketplace visual instead of an optimized WebP derivative.");
}

console.log(JSON.stringify({ status: errors.length ? "failed" : "passed", ...totals, errors }, null, 2));
if (errors.length) process.exitCode = 1;
