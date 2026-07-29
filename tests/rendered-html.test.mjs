import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const runtimeCatalog = JSON.parse(await readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"));

function assertCataloguedMessage(source, id, expected) {
  assert.equal(runtimeCatalog.messages[id], expected);
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(source, new RegExp(`marketplace(?:Format)?Message\\("${escapedId}"`));
}

async function render(pathname = "/", envOverrides = {}, origin = "https://med-250.com") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`${origin}${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    ...envOverrides,
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the MED+250 marketplace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src-attr 'none'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /img-src[^;]*https:\/\/uskfnszcdqpcfrhjxitl\.supabase\.co/);
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-site");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("x-permitted-cross-domain-policies"), "none");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const html = await response.text();
  assert.match(html, /<title>MED\+250/);
  assert.match(html, /Health and everyday care/);
  assert.match(html, /Found at the nearest Pharmacy/);
  assert.match(html, /Explore medicines and everyday essentials with confidence/);
  assert.match(html, /Shop products/);
  assert.match(html, /All products/);
  assert.doesNotMatch(html, /Pharmacies confirm availability.+final price on WhatsApp/i);
  assert.match(html, /0\.9% SODIUM CHLORIDE INJECTION/);
  assert.match(html, /All Categories/);
  assert.doesNotMatch(html, /Check licensed pharmacy records/);
  assert.doesNotMatch(html, /Connected private preview/);
  assert.doesNotMatch(html, /marketplace—not a simple pharmacy website/);
  assert.doesNotMatch(html, /class="eyebrow"/);
  const marketBanner = html.match(/<section class="market-banner">[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.doesNotMatch(marketBanner, /WhatsApp/i);
  assert.match(html, /For Pharmacies/);
  assert.match(html, /og:image/);
  assert.match(html, /og-marketplace-v2\.png/);
  assert.match(html, /name="robots" content="(?:index, follow|noindex, nofollow, noarchive)"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/);

  const socialCard = await readFile(new URL("../public/og-marketplace-v2.png", import.meta.url));
  assert.equal(socialCard.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(socialCard.readUInt32BE(16), 1200);
  assert.equal(socialCard.readUInt32BE(20), 630);
  assert.ok(socialCard.byteLength > 300_000, "social card should be a finished marketplace visual, not a tiny placeholder");
});

test("adds category-aware product breadcrumbs and source-backed related products", async () => {
  const [marketplace, productPage, productSeo, productRelated, taxonomy, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-seo.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-related.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/non-prescription-taxonomy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(taxonomy, /catalogueDepartmentForProduct/);
  assert.match(productPage, /getRelatedMarketplaceProducts/);
  assert.match(productPage, /getPublicMarketplaceProducts/);
  assert.match(productPage, /getRelatedMarketplaceProducts\(product, 12\)/);
  assert.match(productPage, /filter\(\(candidate\) => Boolean\(candidate\.imageUrl \?\? candidate\.imageUrls\?\.\[0\]\)\)/);
  assert.match(productPage, /name: department\.label, item: absoluteUrl\(department\.href\)/);
  assertCataloguedMessage(marketplace, "inventory.ddd8bdb51f77", "Similar catalogue products");
  assertCataloguedMessage(marketplace, "inventory.ec2e25a05e2d", "For browsing only — catalogue similarity is not medical advice or a treatment recommendation.");
  assert.match(marketplace, /selectedProductDepartment\?\.href/);
  assert.match(productSeo, /product-related-index\.json/);
  assert.match(productSeo, /selectRelatedCatalogueRecords/);
  assert.match(productRelated, /candidate\.id !== seed\.id/);
  assert.match(productRelated, /candidate\.kind === kind/);
  assert.match(productRelated, /medicineMatch/);
  assert.match(productRelated, /consumerMatch/);
  assert.match(css, /\.product-detail-page>\.related-products/);
});

test("persists catalogue search, filters, sort, and view in the URL", async () => {
  const [marketplace, navigationState] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/catalogue-navigation-state.ts", import.meta.url), "utf8"),
  ]);

  assert.match(navigationState, /setOrDelete\("search", state\.search\.trim\(\), ""\)/);
  assert.match(navigationState, /setOrDelete\("shown", String\(state\.shown\), String\(defaults\.initialProductCount\)\)/);
  assert.match(navigationState, /setOrDelete\("position", state\.position \?\? "", ""\)/);
  assert.match(marketplace, /parseCatalogueNavigationState\(window\.location\.search/);
  assert.match(marketplace, /serializeCatalogueNavigationState\(window\.location\.search/);
  assert.match(marketplace, /withCatalogueReturnPosition\(window\.location\.search, product\.id, visibleCount\)/);
  assert.match(marketplace, /window\.history\.replaceState\(window\.history\.state, "", nextUrl\)/);
  assert.match(marketplace, /window\.addEventListener\("popstate", applyCatalogueUrlState\)/);
  assert.match(marketplace, /onOpen=\{rememberCataloguePosition\}/);
  assert.match(marketplace, /card\.scrollIntoView\(\{ block: "center", behavior: "auto" \}\)/);
  assert.match(marketplace, /focus\(\{ preventScroll: true \}\)/);
});

test("provides a repeat-visit PWA install path without implying offline requests succeed", async () => {
  const [layout, manager, serviceWorker, offlinePage, manifest, css] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pwa-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/offline.html", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const parsedManifest = JSON.parse(manifest);

  assert.match(layout, /<PwaManager \/>/);
  assert.match(manager, /visits >= 2/);
  assert.match(manager, /beforeinstallprompt/);
  assert.match(manager, /DISMISSAL_PERIOD_MS/);
  assert.match(manager, /pharmacy-portal/);
  assertCataloguedMessage(manager, "inventory.c0a9658a1655", "In Safari, tap Share, then Add to Home Screen.");
  assert.match(manager, /registration\.waiting/);
  assert.match(manager, /SKIP_WAITING/);
  assert.match(manager, /if \(!reloadingForUpdate\.current\) return/);
  assert.match(manager, /reloadingForUpdate\.current = true;[\s\S]*waitingWorker\.postMessage/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /caches\.match\(OFFLINE_URL\)/);
  assert.match(offlinePage, /MED\+250 will never show a request as sent while you are offline\./);
  assert.doesNotMatch(offlinePage, /onclick=/);
  assert.equal(parsedManifest.id, "/");
  assert.equal(parsedManifest.scope, "/");
  assert.equal(parsedManifest.display, "standalone");
  assert.match(parsedManifest.description, /availability requests/i);
  assert.doesNotMatch(parsedManifest.description, /place one order/i);
  assert.match(css, /\.pwa-prompt/);
});

test("keeps the production server usable when local vinext provides no Cloudflare bindings", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-no-env`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://med-250.com/", { headers: { accept: "text/html" } }),
    undefined,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await response.text(), /<title>MED\+250/);
});

test("server-renders canonical product metadata and fails image delivery blank without public bindings", async () => {
  const productId = "rwanda-fda-hm-0002";
  const response = await render(`/product/${productId}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  const metadataOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://med-250.com";
  assert.match(html, /<title>Bupicaine heavy \| MED\+250<\/title>/);
  assert.ok(html.includes(`rel="canonical" href="${metadataOrigin}/product/${productId}"`));
  assert.doesNotMatch(html, /storage\/v1\/object\/public\/product-images\/v1\/rwanda-fda-hm-0002\//);
  assert.doesNotMatch(html, /storage\/v1\/render\/image\/public\/product-images/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"alternateName":"BUPICAINE HEAVY"/);
  assert.match(html, /Official catalogue name/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /Manufacturer/);
  assert.match(html, /Rwanda FDA registration/);
  assert.match(html, /Tyche Industries Limited/);
  assert.ok(!html.includes(`"image":"${metadataOrigin}/og-marketplace-v2.png"`));
  assert.doesNotMatch(html, /About this product/);
});

test("server filters similar catalogue cards unless a real public image is available", async () => {
  const [productPage, marketplace] = await Promise.all([
    readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(
    productPage,
    /filter\(\(candidate\) => Boolean\(candidate\.imageUrl \?\? candidate\.imageUrls\?\.\[0\]\)\)/,
  );
  assert.match(marketplace, /className="marketplace-section related-products"/);
  assert.match(marketplace, /className="product-image-wrap"/);
});

test("shows only governed public product descriptions with source attribution", async () => {
  const [marketplace, publicProduct, productPage, migration, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-marketplace-product.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260718133000_govern_public_product_descriptions.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /not description_approved[\s\S]*description_rights_verified[\s\S]*description_reviewed_at is not null/);
  assert.match(migration, /case when governed\.description_approved then governed\.description end as description/);
  assert.match(migration, /Changing an approved product description requires a newer accountable review/);
  assert.match(publicProduct, /description: text\(row, "description"\) \|\| null/);
  assert.match(publicProduct, /descriptionSourceUrl: httpsUrl\(row, "description_source_url"\)/);
  assert.match(productPage, /const remoteProduct = await getPublicMarketplaceProduct\(id\)/);
  assert.match(productPage, /const baseProduct = remoteProduct \?\? \(localProduct \? toMarketplaceProduct\(localProduct\) : null\)/);
  assert.match(productPage, /const description = product\.description \|\|/);
  assert.match(marketplace, /selectedProduct\.description \? <section className="product-description"/);
  assert.match(marketplace, /descriptionSourceUrl\?\.startsWith\("https:\/\/"\)/);
  assert.match(css, /\.product-description \{/);
});

test("keeps previews and workers.dev unindexed while permitting an explicit live custom domain", async () => {
  const previewRobots = await render("/robots.txt");
  assert.equal(previewRobots.status, 200);
  const robotsText = await previewRobots.text();
  const bundleAllowsIndexing = /(?:^|\n)Allow:\s*\//i.test(robotsText);
  if (bundleAllowsIndexing) {
    const expectedSitemapOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://med-250.com";
    assert.match(robotsText, /User-Agent: \*[\s\S]*(?:^|\n)Allow:\s*\//im);
    assert.ok(robotsText.includes(`Sitemap: ${expectedSitemapOrigin}/sitemap.xml`));
  } else {
    assert.match(robotsText, /User-Agent: \*[\s\S]*Disallow: \//i);
  }

  const previewSitemap = await render("/sitemap.xml");
  assert.equal(previewSitemap.status, 200);
  const sitemapText = await previewSitemap.text();
  if (bundleAllowsIndexing) {
    assert.match(sitemapText, /<url>/i);
  } else {
    assert.doesNotMatch(sitemapText, /<url>/i);
  }

  const liveCustomDomain = await render("/", { MED250_RELEASE_MODE: "live" });
  assert.equal(liveCustomDomain.headers.get("x-robots-tag"), null);
  assert.match(liveCustomDomain.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(liveCustomDomain.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(liveCustomDomain.headers.get("cross-origin-resource-policy"), "same-site");
  assert.equal(liveCustomDomain.headers.get("permissions-policy"), "camera=(), geolocation=(self), microphone=()");
  assert.equal(liveCustomDomain.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(liveCustomDomain.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(liveCustomDomain.headers.get("x-content-type-options"), "nosniff");
  assert.equal(liveCustomDomain.headers.get("x-frame-options"), "DENY");

  const workersDev = await render("/", { MED250_RELEASE_MODE: "live" }, "https://med250-marketplace.example.workers.dev");
  assert.equal(workersDev.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("publishes catalog mode for indexing without enabling customer ordering", async () => {
  const catalogHome = await render("/", { MED250_RELEASE_MODE: "catalog" }, "https://med250-rwanda.ikanisa.chatgpt.site");
  assert.equal(catalogHome.headers.get("x-robots-tag"), null);
  const html = await catalogHome.text();
  if (process.env.NEXT_PUBLIC_MARKETPLACE_MODE === "catalog") {
    assert.match(html, /Public catalogue is live/);
    assert.match(html, /Requests coming soon/);
    assert.match(html, /Ordering stays unavailable until verified pharmacies are ready to receive requests/);
    assert.doesNotMatch(html, />Place order</);
  }
});

test("blocks releases when frontend and Worker modes diverge", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-release-config.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_MARKETPLACE_MODE: "live", NEXT_PUBLIC_SITE_URL: "https://med-250.com" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Frontend and Worker release modes do not match/);
});

test("uses committed public preview defaults without weakening live configuration", () => {
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ![
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_MARKETPLACE_MODE",
    "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY",
  ].includes(name)));
  const preview = spawnSync(process.execPath, ["scripts/validate-release-config.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: cleanEnvironment,
  });
  assert.equal(preview.status, 0, preview.stdout);
  assert.match(preview.stdout, /"envFileSource": "\.env\.example"/);
  assert.match(preview.stdout, /Using committed public preview defaults/);

  const publicBrowserKey = spawnSync(process.execPath, ["scripts/validate-release-config.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...cleanEnvironment, NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: "browser-key-with-referrer-restrictions" },
  });
  assert.equal(publicBrowserKey.status, 0, publicBrowserKey.stdout);

  const disguisedServerKey = spawnSync(process.execPath, ["scripts/validate-release-config.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...cleanEnvironment, NEXT_PUBLIC_PRIVATE_API_KEY: "must-not-be-public" },
  });
  assert.equal(disguisedServerKey.status, 1);
  assert.match(disguisedServerKey.stdout, /Server credentials use public variable names: NEXT_PUBLIC_PRIVATE_API_KEY/);

  const live = spawnSync(process.execPath, ["scripts/validate-release-config.mjs", "--live"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: cleanEnvironment,
  });
  assert.equal(live.status, 1);
  assert.match(live.stdout, /NEXT_PUBLIC_MED250_CONTACT_EMAIL is required for live public contact readiness/);
  assert.match(live.stdout, /"envFileSource": null/);
});

test("server-renders every dedicated marketplace route", async () => {
  const routes = [
    ["/categories", /Explore products/],
    ["/category/medicines", /Search by brand, generic name, symptom/],
    ["/category/personal-care", /Beauty &amp; Personal Care/],
    ["/category/baby-family", /Browse source-backed products currently present in this department/],
    ["/category/wellness", /Health &amp; Household/],
  ];
  for (const [pathname, expected] of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), expected, pathname);
  }
  const personalCareHtml = await (await render("/category/personal-care")).text();
  assert.doesNotMatch(personalCareHtml, /makeup, skin care, hair care, fragrance/i);
  const pharmacyResponse = await render("/pharmacies");
  assert.equal(pharmacyResponse.status, 307);
  assert.match(pharmacyResponse.headers.get("location") ?? "", /pharmacy-portal=open/);
});

test("keeps the category index free of a duplicate promotional hero", async () => {
  const categoriesResponse = await render("/categories");
  const categoriesHtml = await categoriesResponse.text();
  assert.match(categoriesHtml, /Explore products/);
  assert.match(categoriesHtml, /category-index-departments/);
  assert.doesNotMatch(categoriesHtml, /category-route-banner|All pharmacy categories/);

  const medicinesResponse = await render("/category/medicines");
  assert.match(await medicinesResponse.text(), /category-route-banner/);
});

test("keeps product cards free of verification and technical ranking labels", async () => {
  const marketplace = await readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(marketplace, /className=\{`rx-badge/);
  assert.doesNotMatch(marketplace, />VERIFY<|>REGISTERED</);
  assert.doesNotMatch(marketplace, /className="match-explanation"/);
  assert.match(marketplace, /const taxonomyLabels = new Set/);
  assert.match(marketplace, /consumerProduct && \(taxonomyLabels\.has\(normalized\)/);
});

test("keeps the basket count light on its primary gradient badge", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.site-header \.bag-button>b\s*\{[\s\S]*color:var\(--color-white\)!important;[\s\S]*-webkit-text-fill-color:var\(--color-white\);[\s\S]*background:var\(--clay-action\);/);
});

test("keeps the header search icon light on its primary gradient button", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.header-search button svg\s*\{[\s\S]*color:var\(--color-white\)!important;[\s\S]*stroke:currentColor;/);
});

test("accepts only privacy-safe bucketed marketplace telemetry", async () => {
  const telemetry = await readFile(new URL("../app/api/telemetry/route.ts", import.meta.url), "utf8");
  const observability = await readFile(new URL("../lib/marketplace-observability.ts", import.meta.url), "utf8");
  const preflight = await readFile(new URL("../scripts/validate-release-config.mjs", import.meta.url), "utf8");

  assert.match(telemetry, /MAX_BODY_BYTES = 2048/);
  assert.match(telemetry, /request\.body\.getReader\(\)/);
  assert.match(telemetry, /reader\.cancel\("telemetry body exceeds byte limit"\)/);
  assert.doesNotMatch(telemetry, /request\.text\(\)/);
  assert.match(telemetry, /EVENT_NAMES\.has\(body\.name\)/);
  assert.match(telemetry, /query_length_bucket/);
  assert.match(telemetry, /duration_ms_bucket/);
  assert.doesNotMatch(telemetry, /phoneNumber|whatsappNumber|latitude|longitude|prescriptionPath|prescriptionData|orderId|pharmacyId|productId/i);
  assert.match(observability, /NEXT_PUBLIC_MED250_OBSERVABILITY === "cloud"/);
  assert.match(observability, /credentials: "omit"/);
  assert.match(preflight, /NEXT_PUBLIC_MED250_OBSERVABILITY=cloud/);

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-telemetry`);
  const { default: worker } = await import(workerUrl.href);
  const accepted = await worker.fetch(new Request("https://med-250.com/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "catalogue_search",
      properties: { queryLength: 7, resultCount: 44, durationMs: 312, unexpected: "discard-me" },
    }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });

  const rejected = await worker.fetch(new Request("https://med-250.com/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "4096" },
    body: JSON.stringify({ name: "unknown_event" }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(rejected.status, 413);

  const rejectedWithoutLength = await worker.fetch(new Request("https://med-250.com/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "catalogue_search", properties: { unexpected: "x".repeat(3000) } }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(rejectedWithoutLength.status, 413);
});

test("server-renders an immediate catalogue and keeps connected previews on paginated search", async () => {
  const [marketplace, page, productSeo, brandLogo] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-seo.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/brand-logo.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /initialProducts=\{getInitialMarketplaceProducts\(\)\}/);
  assert.match(productSeo, /export function getInitialMarketplaceProducts/);
  assert.match(marketplace, /if \(!backendConfigured\) \{[\s\S]*fetch\("\/data\/rwanda-fda-products-july-2026\.csv"\)/);
  assert.match(marketplace, /if \(!backendConfigured \|\| !serverCatalogueAvailable \|\| !serverCatalogueDemanded \|\| initialProductId\) return undefined/);
  assert.match(marketplace, /setServerCatalogueRequested\(true\)/);
  assert.match(marketplace, /startTransition\(\(\) => \{[\s\S]*setCatalogue\(products\)/);
  assert.match(marketplace, /!backendConfigured \|\| !serverCatalogueDemanded \|\| initialProductId \|\| !hierarchyRepresentativeKey/);
  assert.match(marketplace, /hero-pharmacy-still-life\.webp/);
  assert.doesNotMatch(marketplace, /(?:hero-pharmacy-still-life|category-[^"']+|product-pack-[^"']+)\.png/);
  assert.doesNotMatch(marketplace, /product-pack-[^"']+\.webp/);
  assert.match(marketplace, /if \(!resolvedImageUrl\) return null/);
  assert.match(marketplace, /if \(approvedImages\.length !== 3\) return null/);
  assert.match(marketplace, /cardImageUrl \? <Link className="product-image-wrap"/);
  assert.match(brandLogo, /med-plus-250-wordmark-transparent\.webp/);
  assert.doesNotMatch(brandLogo, /med-plus-250-wordmark\.png/);
});

test("implements multilingual product search, match explanations, and responsive result modes", async () => {
  const [marketplace, search, client, searchMigration, marketplaceSearchMigration, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/catalogue-search.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713175533_server_catalogue_search.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715184639_add_amazon_marketplace_catalogue.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(search, /ububabare/);
  assert.match(search, /douleur/);
  assert.match(search, /uruhinja/);
  assert.match(search, /Exact active ingredient/);
  assert.match(search, /Close spelling match/);
  assert.doesNotMatch(marketplace, /className="match-explanation"/);
  assertCataloguedMessage(marketplace, "inventory.47da4e5507b6", "Grid view");
  assertCataloguedMessage(marketplace, "inventory.5d8c3e1b635e", "List view");
  assert.match(marketplace, /function ProductCard/);
  assert.match(marketplace, /className="product-card-content"/);
  assert.match(marketplace, /className="product-card-specs"/);
  assert.match(marketplace, /className="product-image-action" aria-hidden="true"><ArrowRight/);
  assert.match(css, /product-grid\.list-view/);
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.marketplace-section \.product-card \{[\s\S]*?min-height:clamp\(326px,31vw,344px\);[\s\S]*?contain-intrinsic-size:auto clamp\(326px,31vw,344px\);/);
  assert.match(css, /\.marketplace-section \.product-image-wrap \{[\s\S]*?height:clamp\(132px,12\.9vw,150px\);/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?min-height:clamp\(276px,75vw,310px\);[\s\S]*?height:clamp\(104px,28vw,128px\);/);
  assert.match(css, /\.product-card-generic\.is-empty,\s*\.product-card-specs\.is-empty \{ display:none; \}/);
  assert.match(css, /\.marketplace-section \.product-card \.price-line \.product-card-cart \{[\s\S]*?min-height:44px;/);
  assert.match(css, /\.marketplace-section \.product-card \.price-line button[\s\S]*background:var\(--brand-action-gradient\)/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(client, /export async function searchCatalogue/);
  assert.match(client, /dawanear_search_marketplace_catalogue/);
  assert.match(marketplace, /Supabase ranked search/);
  assert.match(marketplace, /for \(let offset = 0; offset < visibleCount; offset \+= 120\)/);
  assert.match(searchMigration, /create extension if not exists pg_trgm with schema extensions/);
  assert.match(searchMigration, /extensions\.similarity/);
  assert.match(searchMigration, /grant execute on function public\.dawanear_search_catalogue/);
  assert.match(searchMigration, /from public, anon, authenticated/);
  assert.match(marketplaceSearchMigration, /grant execute on function public\.dawanear_search_marketplace_catalogue/);
  assert.match(marketplaceSearchMigration, /from public, anon, authenticated/);
});

test("keeps availability requests focused and exposes complete private response states", async () => {
  const marketplace = await readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8");

  assertCataloguedMessage(marketplace, "inventory.9833e6ac40f6", "Use current location");
  assert.doesNotMatch(marketplace, /Your browser will ask for location only when you place the order/);
  assertCataloguedMessage(marketplace, "inventory.1db0e4cd0635", "No response available");
  assertCataloguedMessage(marketplace, "inventory.0ff5e16d4eb0", "Request expired");
  assertCataloguedMessage(marketplace, "inventory.56196683592d", "Cancel request");
  assertCataloguedMessage(marketplace, "status.waiting_for_confirmation", "Waiting for availability confirmations");
  assertCataloguedMessage(marketplace, "inventory.59fe2287713c", "Availability request sent");
  assertCataloguedMessage(marketplace, "inventory.3e1a6c2093f4", "Pickup possible");
  assertCataloguedMessage(marketplace, "inventory.5fbfda7c58b3", "Fulfilment preference");
  assertCataloguedMessage(marketplace, "inventory.84ae33b5cfd4", "Delivery possible");
  assert.doesNotMatch(marketplace, /checkout step|payment integration|public pharmacy profile/i);
});

test("keeps My Requests separate from the request basket", async () => {
  const marketplace = await readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8");

  assert.match(marketplace, /onClick=\{\(\) => setOffersOpen\(true\)\}/);
  assertCataloguedMessage(marketplace, "inventory.a9b90e025a70", "No active requests");
  assertCataloguedMessage(marketplace, "inventory.57f437b24477", "Open request basket");
  assert.match(marketplace, /basketCount === 1 \? "item" : "items"/);
  assert.doesNotMatch(marketplace, /activeOrderId \? setOffersOpen\(true\) : setCartOpen\(true\)/);
});

test("keeps every department discoverable in the compact mobile rail", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.department-cards article:nth-child\(n\+3\) \{ display:grid; \}/);
  assert.doesNotMatch(css, /\.department-cards article:nth-child\(n\+3\) \{ display:none; \}/);
  assert.match(css, /scroll-snap-type:x mandatory/);
});

test("lazy-loads more catalogue products continuously while scrolling", async () => {
  const [marketplace, sourceCatalogJson, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/localization/messages.en-RW.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const sourceCatalog = JSON.parse(sourceCatalogJson);

  assert.match(marketplace, /new IntersectionObserver/);
  assert.match(marketplace, /rootMargin: "800px 0px"/);
  assert.match(marketplace, /setVisibleCount\(\(count\) => count \+ PRODUCT_BATCH_SIZE\)/);
  assert.match(marketplace, /ref=\{productLoadSentinelRef\}/);
  assert.match(marketplace, /data-testid="product-scroll-sentinel"/);
  assert.match(marketplace, /marketplaceMessage\("catalogue\.load_more"\)/);
  assert.equal(sourceCatalog.messages["catalogue.load_more"], "Load more products");
  assert.match(marketplace, /disabled=\{catalogueBusy\}/);
  assertCataloguedMessage(marketplace, "inventory.aef8e0cc6aa3", "Catalogue refresh failed");
  assert.match(marketplace, /setCatalogueRetryKey\(\(key\) => key \+ 1\)/);
  assertCataloguedMessage(marketplace, "inventory.71297d72239d", "The live catalogue could not refresh. The products already shown may be out of date.");
  assertCataloguedMessage(marketplace, "inventory.da287b007270", "All {0} matching products are loaded");
  assert.doesNotMatch(marketplace, /All \{marketplaceNumber\(catalogueMatchCount\)\} matching products are loaded/);
  assert.match(marketplace, /data-product-card=\{product\.id\}/);
  assert.match(marketplace, /loading=\{eager \? "eager" : "lazy"\}/);
  assert.doesNotMatch(marketplace, /Show 48 more products|>See all<\/button>/);
  assert.match(css, /content-visibility:auto/);
  assert.match(css, /contain-intrinsic-size:auto clamp\(326px,31vw,344px\)/);
  assert.match(css, /\.infinite-scroll-sentinel button/);
  assert.match(css, /\.catalogue-error/);
});

test("provides accessible feedback, mobile filters, wizard progress, and resilient loading states", async () => {
  const [marketplace, navigationFeedback, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/navigation-feedback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(marketplace, /data-modal-root="catalogue-filters"/);
  assert.match(marketplace, /aria-describedby="catalogue-filter-description"/);
  assert.doesNotMatch(marketplace, /className="wizard-progress"/);
  assert.match(marketplace, /className="portal-auth-status"/);
  assert.match(marketplace, /aria-describedby="pharmacy-signin-context"/);
  assert.match(marketplace, /className="order-wizard-progress"/);
  assert.match(marketplace, /CHECKOUT_STEPS\.filter\(\(item\) => item\.id !== 3\)/);
  assert.match(marketplace, /--order-step-count/);
  assert.match(marketplace, /previousCheckoutStepRef/);
  assert.ok(marketplace.indexOf("const [checkoutStep") < marketplace.indexOf("const previousCheckoutStepRef"));
  assert.match(marketplace, /querySelector<HTMLElement>\("\[data-checkout-step-focus\]"\)/);
  assert.match(marketplace, /data-checkout-step-focus tabIndex=\{-1\}/);
  assertCataloguedMessage(marketplace, "inventory.4ed9052cf4be", "Review and send your availability request");
  assertCataloguedMessage(marketplace, "inventory.acbb998d8243", "Continue to details");
  assertCataloguedMessage(marketplace, "inventory.dcea8abbdff0", "Review request");
  assert.match(marketplace, /setCheckoutStep\(customerWhatsappVerified \? 4 : 3\)/);
  assert.match(marketplace, /setCheckoutStep\(4\)/);
  assert.match(marketplace, /className="catalogue-skeleton"/);
  assert.match(marketplace, /aria-busy=\{ordering\}/);
  assert.match(navigationFeedback, /navigator\.onLine/);
  assert.match(navigationFeedback, /window\.addEventListener\("offline"/);
  assertCataloguedMessage(navigationFeedback, "inventory.8b6721dc2ac7", "Connection restored");
  assert.doesNotMatch(marketplace, /intelligent matches|Brand, generic name, symptom, strength and form|smart-filter-summary/);
  assert.match(css, /\.mobile-filter-button/);
  assert.doesNotMatch(css, /\.smart-filter-summary/);
  assert.match(css, /\.feedback-toast/);
  assert.match(css, /\.product-card-skeleton/);
  assert.match(css, /\.filter-dialog/);
  assert.match(css, /\.drawer\.order-wizard/);
  assert.match(css, /footer\.order-wizard-actions/);
  assert.match(css, /\.order-primary-action/);
  assert.match(css, /--clay-page:linear-gradient/);
  assert.match(css, /--clay-surface:linear-gradient/);
  assert.match(css, /--clay-shadow:/);
  assert.match(css, /MED\+250 soft-gradient claymorphism system/);
  assert.match(css, /\.order-review-item[\s\S]*background:var\(--clay-surface\)/);
  assert.match(marketplace, /className="sr-only" role="status">\{recentlyAddedBrand\}/);
  assert.match(css, /\.saved-whatsapp-row/);
  assert.match(css, /\.order-review-item>\.cart-item-copy>b \{[^}]*-webkit-line-clamp:2/);
  assert.match(css, /footer\.order-wizard-actions[\s\S]*background:linear-gradient/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("applies performance, accessibility, responsive, and motion safeguards site-wide", async () => {
  const [marketplace, navigationFeedback, manager, errorPage, globalError, sourceCatalogJson, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/navigation-feedback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pwa-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/global-error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/localization/messages.en-RW.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const sourceCatalog = JSON.parse(sourceCatalogJson);

  assert.match(marketplace, /lazy\(\(\) => import\("\.\/turnstile"\)\)/);
  assert.match(marketplace, /lazy\(\(\) => import\("\.\/google-map-location-picker"\)\)/);
  assertCataloguedMessage(marketplace, "inventory.4e279b7170a2", "Opening map…");
  assert.match(marketplace, /<Suspense fallback=\{<FeatureLoading label=\{marketplaceMessage\("inventory\.4e279b7170a2"\)\}/);
  assert.match(marketplace, /useDebouncedValue\(deferredQuery, 220\)/);
  assert.match(marketplace, /if \(!backendConfigured \|\| initialTaxonomy\.length\) return undefined/);
  assert.match(marketplace, /<Link href="\/categories"><Menu/);
  assert.doesNotMatch(marketplace, /<a href="\/categories"><Menu/);
  assert.match(navigationFeedback, /document\.documentElement\.setAttribute\("data-navigation", "pending"\)/);
  assert.match(navigationFeedback, /getClientRects\(\)\.length > 0/);
  assert.match(navigationFeedback, /querySelectorAll<HTMLElement>\("h1, \[data-route-focus\]"\)/);
  assert.match(navigationFeedback, /\.find\(isRendered\) \?\? currentMain/);
  assert.match(navigationFeedback, /ROUTE_FOCUS_STABILIZATION_MS/);
  assert.match(navigationFeedback, /ROUTE_CONTENT_OBSERVATION_MS/);
  assert.match(navigationFeedback, /ROUTE_CONTENT_OBSERVATION_MS = NAVIGATION_FEEDBACK_TIMEOUT_MS/);
  assert.match(navigationFeedback, /contentObserver\.observe\(document\.body/);
  assert.match(navigationFeedback, /new MutationObserver/);
  assert.match(navigationFeedback, /activeElement === main/);
  assert.match(navigationFeedback, /window\.addEventListener\("popstate", startFeedback\)/);
  assert.match(manager, /requestIdleCallback/);
  assert.match(errorPage, /TRANSIENT_ERROR_PATTERN/);
  assert.match(errorPage, /marketplaceMessage\("error\.reconnecting_title"\)/);
  assert.match(globalError, /marketplaceMessage\("error\.global_title"\)/);
  assert.equal(sourceCatalog.messages["error.reconnecting_title"], "Reconnecting to the marketplace");
  assert.equal(sourceCatalog.messages["error.global_title"], "MED+250 needs to reconnect");
  assert.match(css, /html\[data-navigation="pending"\] body \{ cursor:progress; \}/);
  assert.match(css, /\.commerce-nav>a \{ min-width:44px; min-height:44px/);
  assert.match(css, /\.desktop-filter-controls select \{ min-height:44px; \}/);
  assert.match(css, /\.view-toggle>button \{ width:44px; height:44px; \}/);
  assert.match(css, /\.product-breadcrumbs>a \{ min-width:44px; min-height:44px/);
  assert.match(css, /\.related-products-heading>a \{ min-width:44px; min-height:44px/);
  assert.match(css, /footer nav>a,footer nav>button,\.info-header nav>a \{ min-width:44px; min-height:44px/);
  assert.match(css, /@media \(prefers-contrast:more\)/);
  assert.match(css, /@media \(forced-colors:active\)/);
  assert.match(css, /@media \(prefers-reduced-transparency:reduce\)/);
});

test("gives immediate route feedback and keeps product navigation work responsive", async () => {
  const [layout, navigationFeedback, routeLoading, productLoading, productPage, publicProduct, marketplace, css] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/navigation-feedback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/loading.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product/[id]/loading.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-marketplace-product.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<NavigationFeedback \/>/);
  assert.match(navigationFeedback, /data-testid="navigation-feedback"/);
  assert.match(navigationFeedback, /role="status"/);
  assert.match(navigationFeedback, /aria-live="polite"/);
  assertCataloguedMessage(navigationFeedback, "inventory.f53b55a15cf2", "Opening page…");
  assert.match(navigationFeedback, /document\.addEventListener\("click", beginNavigation, true\)/);
  assert.match(navigationFeedback, /destination\.origin !== window\.location\.origin/);
  assert.match(navigationFeedback, /destination\.pathname === current\.pathname/);
  assert.match(productLoading, /Opening product details…/);
  assert.match(productLoading, /aria-busy="true"/);
  assertCataloguedMessage(routeLoading, "inventory.7b580d07d3ed", "Health and everyday care. Found at the nearest Pharmacy.");
  assertCataloguedMessage(routeLoading, "inventory.697e2082d670", "Loading current products and your request tools…");
  assert.doesNotMatch(productPage, /getPublicCatalogueTaxonomy/);
  assert.match(publicProduct, /import \{ cache \} from "react"/);
  assert.match(publicProduct, /getPublicMarketplaceProduct = cache/);
  assert.match(publicProduct, /getPublicProductImages = cache/);
  assert.match(marketplace, /router\.prefetch\(productHref\)/);
  assert.match(marketplace, /onMouseEnter=\{preloadProduct\}/);
  assert.match(marketplace, /onFocus=\{preloadProduct\}/);
  assert.match(marketplace, /onTouchStart=\{preloadProduct\}/);
  assert.match(css, /\.navigation-feedback\.is-visible/);
  assert.match(css, /\.product-route-loading-shell/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.product-route-loading-shell \{ grid-template-columns:1fr/);
});

test("requires international customer WhatsApp and restores on-device order preferences", async () => {
  const [marketplace, client, migration] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715180536_expand_med250_customer_whatsapp_e164_20260715.sql", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /getCountries\(\)/);
  assert.match(marketplace, /getCountryCallingCode/);
  assertCataloguedMessage(marketplace, "inventory.36ca78914773", "WhatsApp country code");
  assert.match(marketplace, /aria-label=\{marketplaceMessage\("inventory\.36ca78914773"\)\}/);
  assertCataloguedMessage(marketplace, "inventory.dd0285bfd9b4", "Verified once and remembered");
  assert.match(marketplace, /customerWhatsappVerified && !editingCustomerWhatsapp/);
  assert.match(marketplace, /setCheckoutStep\(customerWhatsappVerified \? 4 : 3\)/);
  assert.match(marketplace, /CUSTOMER_PREFERENCES_STORAGE_KEY/);
  assert.match(marketplace, /coordinates: coordinates/);
  assert.match(marketplace, /applyMapLocation/);
  assertCataloguedMessage(marketplace, "inventory.98740bcd8423", "Map location saved for nearby pharmacy matching.");
  assert.match(marketplace, /isLegacyManualLocation/);
  assert.doesNotMatch(marketplace, /optional · saved to your customer profile/);
  assert.doesNotMatch(marketplace, /Anonymous sign-in is an identity control/);
  assert.match(client, /normalizeInternationalWhatsapp/);
  assert.match(migration, /\^\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.match(migration, /Pharmacy identity and OTP[\s\S]*Rwanda-only/);
});

test("uses device detection or an embedded Google Maps pin instead of raw coordinates", async () => {
  const [marketplace, mapPicker, css, environment] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/google-map-location-picker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assertCataloguedMessage(marketplace, "inventory.9833e6ac40f6", "Use current location");
  assertCataloguedMessage(marketplace, "inventory.964c5724503c", "Choose on map");
  assert.match(marketplace, /GoogleMapLocationPicker/);
  assert.match(marketplace, /NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/);
  assert.doesNotMatch(marketplace, /Use coordinates instead|manualLatitude|manualLongitude|applyManualLocation/);
  assert.match(mapPicker, /maps\.googleapis\.com\/maps\/api\/js/);
  assert.match(mapPicker, /draggable: true/);
  assert.match(mapPicker, /map\.addListener\("click"/);
  assert.match(mapPicker, /new maps\.Geocoder\(\)/);
  assert.match(mapPicker, /componentRestrictions: \{ country: "RW" \}/);
  assert.match(css, /\.map-location-picker/);
  assert.match(css, /\.location-choice-row/);
  assert.doesNotMatch(css, /manual-location/);
  assert.match(environment, /NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=/);
});

test("uses availability-request language and only the four MED+250 brand accents", async () => {
  const [marketplace, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assertCataloguedMessage(marketplace, "inventory.1bf36d90e261", "Add to request");
  assert.match(marketplace, /className="product-card-cart"/);
  assert.match(marketplace, /<ShoppingCart size=\{19\}/);
  assert.doesNotMatch(marketplace, /"Check availability"|>Check availability</);
  assert.doesNotMatch(marketplace, /product-card-request/);
  assert.match(marketplace, /className=\{`product-prescription-status status-\$\{status\}`\}/);
  assert.match(marketplace, /<small>\{marketplaceMessage\("product\.price_label"\)\}<\/small>/);
  assert.doesNotMatch(marketplace, /<small>\{status\}<\/small>/);
  assert.doesNotMatch(marketplace, /<small>Central indicative price<\/small>/);
  assertCataloguedMessage(marketplace, "inventory.e0f65214f68f", "Your request basket");
  assertCataloguedMessage(marketplace, "inventory.f9c2f1181763", "added to your request");
  assert.match(css, /\.product-card-cart[\s\S]*grid-column:2/);
  assert.match(marketplace, /basketCount === 1 \? "item" : "items"/);
  assert.doesNotMatch(marketplace, /basketCount === 1 \? "product" : "products"/);
  assertCataloguedMessage(marketplace, "inventory.2db32b4e0ab8", "Send availability request");
  assertCataloguedMessage(marketplace, "inventory.126834c25aaf", "We'll ask nearby pharmacies to confirm — no payment yet.");
  assert.doesNotMatch(marketplace, /"Add to cart"|Your cart|added to your cart|"Add to order"|>Order basket<\/span>|One order\./);
  assert.match(css, /--brand-green:#5cdd63/);
  assert.match(css, /--brand-orange:#ff7048/);
  assert.match(css, /--brand-rose:#d98a9d/);
  assert.match(css, /--brand-violet:#7878e8/);
  assert.doesNotMatch(css, /#091747|#18275f|#302f70|#2042c7|#2544cc|#14853e|#167d3b|#df4b26|#ce3f1e|#7377d9|#3f3f9b|#d94b28|brand-violet-deep/);
});

test("hides field labels when their source value is absent and uses readable gradient chrome", async () => {
  const [marketplace, client, productPage, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/product/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const placeholder of [
    "Price range from pharmacies",
    "Price confirmed after ordering",
    "Price confirmed by responding pharmacies",
    "Not stated",
    "Not configured",
    "Pack size unavailable",
    "WhatsApp not provided",
    "Confirm timing on WhatsApp",
    "Confirm on WhatsApp",
    "Price on WhatsApp",
    "No pharmacy-specific price is published",
  ]) {
    assert.doesNotMatch(marketplace, new RegExp(placeholder));
    assert.doesNotMatch(productPage, new RegExp(placeholder));
  }
  assert.match(marketplace, /const priced = hasPriceData\(product\)/);
  assert.match(marketplace, /\{priced \? <div><small>\{marketplaceMessage\("product\.price_label"\)\}<\/small>/);
  assert.match(marketplace, /\{hasPriceData\(selectedProduct\) \? <div><span>\{marketplaceMessage\("product\.price_label"\)\}<\/span>/);
  assert.doesNotMatch(marketplace, /Reference only|confirm availability and final price on WhatsApp/i);
  assert.match(marketplace, /<ProductDetailsList product=\{selectedProduct\} \/>/);
  assert.match(productPage, /additionalProperty:[\s\S]*\.filter\(Boolean\)/);
  assert.doesNotMatch(client, /Responding pharmacy|Selected pharmacy|Licensed pharmacy|Registered product/);
  assert.match(css, /--brand-shell-gradient:linear-gradient/);
  assert.match(css, /--brand-nav-gradient:linear-gradient/);
  assert.match(css, /--brand-action-gradient:var\(--clay-action\)/);
  assert.match(css, /\.site-header \.brand,[\s\S]*\.bag-button>span,[\s\S]*color:var\(--color-ink-soft\)/);
  assert.match(css, /\.commerce-nav a,[\s\S]*\.commerce-nav a:last-child,[\s\S]*color:var\(--color-ink-soft\)/);
  assert.match(css, /\.product-detail-buy button[\s\S]*color:var\(--color-white\)!important;[\s\S]*-webkit-text-fill-color:var\(--color-white\)/);
});

test("removes the pharmacy callout and uses the requested pharmacy label", async () => {
  const [marketplace, sitemap] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  ]);

  assertCataloguedMessage(marketplace, "navigation.pharmacies", "For Pharmacies");
  assert.doesNotMatch(marketplace, /Represent a pharmacy\?|Open pharmacy portal|>Pharmacy portal</);
  assert.doesNotMatch(marketplace, /inventory\.cd4aeead1c2e/);
  assert.doesNotMatch(marketplace, /href="\/accessibility"|className="network-strip"/);
  assert.doesNotMatch(sitemap, /accessibility/);
});

test("opens the basket after add and provides a rotating product gallery", async () => {
  const [marketplace, taxonomy, css, designQa] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/non-prescription-taxonomy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../design/design-qa.md", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /function add\(product: Product\)[\s\S]*setCartOpen\(true\);[\s\S]*product_added/);
  assert.match(marketplace, /loadCatalogueProductsByIds\(productIds\)/);
  assert.match(marketplace, /\.\.\.refreshed,[\s\S]*quantity: item\.quantity,[\s\S]*substitutesAllowed: Boolean\(item\.substitutesAllowed\)/);
  assert.match(marketplace, /order-review-item[\s\S]*<ProductVisual product=\{item\} small \/>/);
  assert.match(marketplace, /className="sr-only" role="status">\{recentlyAddedBrand\}/);
  assert.match(marketplace, /className="cart-item-copy"/);
  assert.match(marketplace, /function ProductGallery/);
  assert.match(marketplace, /function productTitleClass\(title: string\)/);
  assert.match(marketplace, /length >= 160[\s\S]*product-title-very-long/);
  assert.match(marketplace, /<h1 className=\{productTitleClass\(selectedProductDisplayTitle\)\}>/);
  assert.match(marketplace, /className="product-mobile-heading"/);
  assert.match(marketplace, /className="product-desktop-heading"/);
  assertCataloguedMessage(marketplace, "inventory.dec875a808c7", "Official catalogue name");
  assert.match(marketplace, /<img src=\{resolvedImageUrl\}/);
  assert.doesNotMatch(marketplace, /<Image src=\{resolvedImageUrl\}/);
  assert.match(marketplace, /Supabase image-transform endpoint is not/);
  assert.match(marketplace, /window\.setInterval[\s\S]*4800/);
  assert.match(marketplace, /setAutoRotate\(false\)/);
  assert.match(marketplace, /onTouchStart[\s\S]*onTouchEnd/);
  assertCataloguedMessage(marketplace, "inventory.a62eceff26be", "Show previous product image");
  assertCataloguedMessage(marketplace, "inventory.a33d991e228f", "Show next product image");
  assertCataloguedMessage(marketplace, "inventory.bd6967f40b86", "Pause automatic gallery rotation");
  assertCataloguedMessage(marketplace, "inventory.b4d7ceb54bd8", "Resume automatic gallery rotation");
  assert.match(marketplace, /aria-roledescription="carousel"/);
  assert.match(marketplace, /function HeroArtworkCarousel\(\)[\s\S]*useState\(false\)/);
  assert.match(marketplace, /product-gallery-dots/);
  assert.match(marketplace, /function HeroArtworkCarousel/);
  assert.equal((marketplace.match(/src: "\/marketplace\/category-[^"]+\.webp"/g) ?? []).length, 4);
  assert.match(marketplace, /heroArtworkSlides\.length\), 5200/);
  assertCataloguedMessage(marketplace, "inventory.e6690f92c82a", "Pause rotating hero images");
  assertCataloguedMessage(marketplace, "inventory.39085a9d9671", "Resume rotating hero images");
  assert.match(marketplace, /<HeroArtworkCarousel \/>/);
  assert.match(css, /\.hero-art-track \{[^}]*transition:transform/);
  assert.match(css, /\.hero-art-slide:nth-child\(4\)/);
  assert.match(marketplace, /data-card-variant=\{\(index % 4\) \+ 1\}/);
  assert.match(marketplace, /className="product-card-category"/);
  assert.match(marketplace, /className="product-image-action" aria-hidden="true"><ArrowRight/);
  assert.match(css, /Premium editorial product cards/);
  assert.match(css, /\.marketplace-section \.product-card\[data-card-variant="4"\]/);
  assert.match(css, /\.product-card-category \{/);
  assert.match(marketplace, /function ProductDetailsList/);
  assertCataloguedMessage(marketplace, "inventory.32593214650f", "Product information");
  assert.match(marketplace, /product-gallery-thumbnails/);
  assert.match(marketplace, /aria-controls="product-gallery-stage"/);
  assert.match(css, /\.product-gallery-slide\.active/);
  assert.match(css, /\.product-gallery-thumbnail\[aria-pressed="true"\]/);
  assert.match(css, /\.product-detail-page \{[^}]*min-height:0;[^}]*grid-template-columns:minmax\(0,1\.08fr\) minmax\(clamp\(320px,38vw,440px\),\.92fr\)/);
  assert.match(css, /\.product-gallery \{[^}]*min-height:0;[^}]*grid-template-columns:clamp\(88px,9vw,112px\) minmax\(0,1fr\);[^}]*grid-template-rows:clamp\(420px,45vw,520px\) auto;[^}]*align-content:start/);
  assert.match(css, /\.product-gallery-thumbnails \{[^}]*grid-column:1;[^}]*grid-row:1;[^}]*align-self:start/);
  assert.match(css, /\.product-gallery-status \{[^}]*grid-column:2;[^}]*grid-row:2;[^}]*align-self:start/);
  assert.match(css, /\.product-detail-copy h1 \{[^}]*font:800 clamp\(30px,2\.9vw,40px\)\/1\.04[^}]*text-wrap:balance/);
  assert.match(css, /\.product-detail-copy h1\.product-title-very-long \{[^}]*font-size:clamp\(22px,2vw,28px\)[^}]*text-wrap:pretty/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.product-detail-copy h1 \{[^}]*font-size:clamp\(27px,7\.5vw,34px\)/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.product-detail-copy h1\.product-title-very-long \{[^}]*font-size:clamp\(21px,5\.8vw,25px\)/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.product-mobile-heading \{[^}]*display:block/);
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.product-desktop-heading \{ display:none; \}/);
  assert.match(designQa, /Every design element, asset, layout, and interactive component must adapt/);
  assert.match(designQa, /Content determines component height/);
  assert.match(css, /\.product-gallery-status/);
  assert.match(css, /\.product-gallery-dots button\[aria-current="true"\]/);
  assert.match(css, /\.product-specification-list>div/);
  assert.match(css, /\.product-detail-buy \{ margin:0; padding:12px 14px max\(12px,env\(safe-area-inset-bottom\)\); position:fixed/);
  assert.match(css, /grid-template-columns:clamp\(88px,9vw,112px\) minmax\(0,1fr\)/);
  assert.match(css, /rotateY\(-18deg\)/);
  assert.match(css, /rotateY\(18deg\)/);
  assert.match(css, /#marketplace-content \.product-detail-buy button/);
  assert.match(css, /\.commerce-nav \{[^}]*grid-template-columns:repeat\(5,max-content\);[^}]*justify-content:space-between/);
  for (const department of ["Beauty & Personal Care", "Baby", "Health & Household"]) assert.match(taxonomy, new RegExp(department.replace("&", "&")));
  assert.match(taxonomy, /prescriptionStatus !== "non_prescription"/);
});

test("keeps MED+250 product-first, WhatsApp-first, and hides unconfirmed pharmacies", async () => {
  const [marketplace, client, confirmationMigration, privacyMigration, directoryMigration, directoryFunctionMigration, pharmacyRoute] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713130531_product_first_private_confirmations.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713130652_hide_unconfirmed_pharmacies.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713143519_hide_public_pharmacy_directory_view.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713165437_revoke_private_pharmacy_directory_function.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/pharmacies/page.tsx", import.meta.url), "utf8"),
  ]);

  assertCataloguedMessage(marketplace, "inventory.2db32b4e0ab8", "Send availability request");
  assertCataloguedMessage(marketplace, "inventory.e23b5b835d4b", "Pharmacies that confirmed availability");
  assertCataloguedMessage(marketplace, "whatsapp.continue_with_pharmacy", "Continue on WhatsApp");
  assert.doesNotMatch(marketplace, /Pay pharmacy with MoMo|Pay with MoMo/);
  assert.doesNotMatch(marketplace, /Shared with \$\{recipientCount\}|No eligible pharmacy matched|register-verified partner/);
  assert.match(client, /dawanear_my_confirmed_offers/);
  assert.doesNotMatch(client.slice(client.indexOf("export async function loadOffers"), client.indexOf("export async function selectOffer")), /dawanear_pharmacy_directory/);
  assert.match(confirmationMigration, /revoke select on table public\.dawanear_pharmacies from anon, authenticated/);
  assert.match(confirmationMigration, /and offer\.complete/);
  assert.match(privacyMigration, /revoke select on table public\.dawanear_order_recipients from anon, authenticated/);
  assert.match(privacyMigration, /complete[\s\S]*status in \('submitted', 'selected'\)/);
  assert.match(directoryMigration, /revoke all on table public\.dawanear_pharmacy_directory[\s\S]*from public, anon, authenticated/);
  assert.match(directoryFunctionMigration, /revoke execute on function dawanear_private\.dawanear_public_pharmacy_directory\(\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(client, /loadPharmacyDirectory|DirectoryPharmacy/);
  assert.match(pharmacyRoute, /redirect\("\/\?pharmacy-portal=open"\)/);
});

test("keeps the launch candidate honest, connected, and free of simulated fulfilment", async () => {
  const [page, marketplace, client, migration, layout, css, packageJson, pharmacyCsv, geocoder, cleanup, productReview] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260712162437_install_med250_marketplace.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../public/data/rwanda-fda-pharmacies-may-2026.csv", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/geocode-pharmacies/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/cleanup-prescriptions/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-data/apply-product-orderability-review.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(page, /getPublicCatalogueTaxonomy/);
  assert.match(page, /getPublicTrustMetrics\(\)/);
  assert.match(page, /<Marketplace initialProducts=\{getInitialMarketplaceProducts\(\)\} initialTaxonomy=\{initialTaxonomy\} initialTrustMetrics=\{initialTrustMetrics\} \/>/);
  assert.match(client, /signInAnonymously/);
  assert.match(client, /dawanear_create_order/);
  assert.match(client, /p_client_request_id/);
  assert.match(client, /packSize/);
  assert.match(client, /dawanear_close_order/);
  assert.match(client, /dawanear-prescriptions/);
  assert.match(client, /postgres_changes/);
  assert.match(client, /dawanear_my_active_orders/);
  assert.match(client, /dawanear_pharmacy_selected_orders/);
  assert.match(client, /dawanear_pharmacy_notifications/);
  assert.match(client, /deletePrescription/);
  assert.match(client, /signOutPharmacy/);
  assert.match(client, /prescription_access_seconds_remaining/);
  assert.match(client, /Math\.min\(10 \* 60, remainingSeconds\)/);
  assert.match(marketplace, /navigator\.geolocation/);
  assert.match(marketplace, /getPharmacySupabase/);
  assert.match(marketplace, /wa\.me/);
  assert.match(marketplace, /NEXT_PUBLIC_MARKETPLACE_MODE/);
  assert.match(marketplace, /recipientCount/);
  assert.match(marketplace, /pendingOrderAttempt/);
  assertCataloguedMessage(marketplace, "inventory.1287db5ab987", "This request may already have been saved. Retry the same secure request; local reset is disabled.");
  assertCataloguedMessage(marketplace, "inventory.9d2a9c58f97e", "This request may already have been saved. Retry the same secure request so MED+250 can recover its receipt; resetting is disabled.");
  assert.match(marketplace, /detectNativeLocation/);
  assert.doesNotMatch(marketplace, /locationConsent|broadcastConsent/);
  assert.match(marketplace, /pendingOrderAttempt\?\.rpcAttempted/);
  assert.match(marketplace, /isCompatibleSubstitute/);
  assert.match(marketplace, /normalizedSubstitutionField\(product\.packSize\)/);
  assertCataloguedMessage(marketplace, "inventory.937f6a721f25", "Finish request");
  assert.match(marketplace, /Promise\.allSettled/);
  assertCataloguedMessage(marketplace, "inventory.e3ecf041cb1d", "Pharmacy contact unavailable");
  assert.doesNotMatch(marketplace, /const quotes|Vine Pharmacy|setTimeout\(\(\) => \{ setOrdering/);
  assert.doesNotMatch(marketplace, /pack-box|pill-one|Google Maps candidate/);
  assert.doesNotMatch(marketplace, /Beauty & wellness/);
  assert.match(marketplace, /disabled=\{selectionLocked\}/);
  assertCataloguedMessage(marketplace, "inventory.e866672f84cd", "Only pharmacies that confirm every requested product will appear here. {0}");
  assert.doesNotMatch(marketplace, /Pay with MoMo|Pay pharmacy with MoMo/);
  assertCataloguedMessage(marketplace, "inventory.f20b73d631ff", "Sign out of pharmacy portal");
  assert.match(migration, /dawanear_create_order/);
  assert.match(migration, /p_client_request_id/);
  assert.match(migration, /dawanear_close_order/);
  assert.match(migration, /dawanear_submit_offer/);
  assert.match(migration, /dawanear_contribute_price/);
  assert.match(migration, /dawanear_my_active_orders/);
  assert.match(migration, /dawanear_pharmacy_selected_orders/);
  assert.match(migration, /dawanear_pharmacy_notifications/);
  assert.match(migration, /bool_or\(p\.prescription_status = 'prescription'\)/);
  assert.match(migration, /ceil\(r\.distance_m \/ 500\.0\) \* 500\.0/);
  assert.match(migration, /dawanear_prescriptions_owner_delete/);
  assert.match(migration, /client_request_id uuid not null/);
  assert.match(migration, /dawanear_orders_one_active_per_user_uidx/);
  assert.match(migration, /dawanear_expire_timed_out_selected_orders/);
  assert.match(migration, /dawanear_maintenance_state/);
  assert.match(migration, /dawanear_prescription_cleanup_claims/);
  assert.match(migration, /dawanear_claim_prescription_cleanup/);
  assert.match(migration, /dawanear_claim_orphan_prescription_cleanup/);
  assert.match(migration, /dawanear_recover_expired_prescription_cleanup_claims/);
  assert.match(migration, /dawanear_finalize_prescription_cleanup/);
  assert.match(migration, /prescription_access_seconds_remaining/);
  assert.match(migration, /requested_product\.pack_size/);
  assert.match(migration, /selected_at > now\(\) - interval '24 hours'/);
  assert.match(layout, /MED\+250/);
  assert.match(layout, /og-marketplace-v2\.png/);
  assert.match(css, /@media \(max-width:760px\)/);
  assert.doesNotMatch(pharmacyCsv.split("\n", 1)[0], /google_|phone|whatsapp/i);
  assert.match(geocoder, /dawanear_pharmacies/);
  assert.doesNotMatch(geocoder, /marketplace_pharmacies|app_metadata|user_metadata/);
  assert.match(cleanup, /DAWANEAR_CRON_TOKEN/);
  assert.match(cleanup, /dawanear-prescriptions/);
  assert.match(cleanup, /offset,/);
  assert.match(cleanup, /orphan_scan_complete/);
  assert.match(cleanup, /selected_access_hours: 24/);
  assert.match(cleanup, /folder_cursor/);
  assert.match(cleanup, /perFolderLimit/);
  assert.match(cleanup, /dawanear_claim_prescription_cleanup/);
  assert.match(cleanup, /dawanear_claim_orphan_prescription_cleanup/);
  assert.match(cleanup, /dawanear_recover_expired_prescription_cleanup_claims/);
  assert.match(cleanup, /dawanear_finalize_prescription_cleanup/);
  assert.match(productReview, /SUPABASE_SECRET_KEY/);
  assert.match(productReview, /pharmacist_only/);
  assert.match(productReview, /\.update\(\{[\s\S]*prescription_status:[\s\S]*is_orderable:/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../data/imports/pharmacies-map-matched.csv", import.meta.url)));
  await assert.rejects(access(new URL("../data/imports/pharmacies-map-review.csv", import.meta.url)));
});

test("isolates persistent customer and pharmacy auth sessions without storage collisions", async () => {
  const [supabaseModule, client] = await Promise.all([
    readFile(new URL("../lib/supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(supabaseModule, /storageKey: "med250-customer-auth"/);
  assert.match(supabaseModule, /PHARMACY_SESSION_KEY = "med250-pharmacy-auth"/);
  assert.match(supabaseModule, /customerSupabase[\s\S]*detectSessionInUrl: false/);
  assert.match(supabaseModule, /__med250CustomerSupabase \?\?=/);
  assert.match(supabaseModule, /getPharmacySupabase\(\)[\s\S]*accessToken:/);
  assert.match(supabaseModule, /refreshPharmacyAccessToken/);
  assert.match(supabaseModule, /savePharmacySession/);
  assert.equal((supabaseModule.match(/createClient\(/g) ?? []).length, 2);
  assert.doesNotMatch(supabaseModule, /export const supabase\s*=/);
  assert.match(client, /backendConfigured = supabaseConfigured/);

  const customerSessionSection = client.slice(
    client.indexOf("export async function ensureAnonymousCustomer"),
    client.indexOf("export async function hasPermanentPharmacySession"),
  );
  const pharmacySessionSection = client.slice(client.indexOf("export async function requestPharmacyWhatsappOtp"));
  assert.match(customerSessionSection, /requireCustomerBackend/);
  assert.match(pharmacySessionSection, /requirePharmacyBackend/);
  const pharmacySignOutSection = client.slice(
    client.indexOf("export async function signOutPharmacy"),
    client.indexOf("export async function verifyPharmacyWhatsappOtp"),
  );
  assert.match(pharmacySignOutSection, /requirePharmacyBackend/);
  assert.match(pharmacySignOutSection, /clearPharmacySession/);
  assert.doesNotMatch(pharmacySignOutSection, /requireCustomerBackend|customerSupabase/);
  assert.match(pharmacySessionSection, /dawanear-pharmacy-send-otp/);
  assert.match(pharmacySessionSection, /dawanear-pharmacy-verify-otp/);
  assert.match(pharmacySessionSection, /savePharmacySession/);
  assert.doesNotMatch(pharmacySessionSection, /auth\.setSession/);
  assert.doesNotMatch(pharmacySessionSection, /signInWithOtp|verifyOtp/);
});

test("protects new anonymous customer sessions with Turnstile in live mode", async () => {
  const [marketplace, client, widget, worker, preflight] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/turnstile.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/validate-release-config.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /hasAnonymousCustomerSession/);
  assert.match(marketplace, /NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.match(marketplace, /<Turnstile/);
  assert.match(client, /signInAnonymously\(cleanedCaptchaToken/);
  assert.match(client, /captchaToken: cleanedCaptchaToken/);
  assert.match(widget, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(widget, /"expired-callback"/);
  assert.match(widget, /"error-callback"/);
  assert.match(worker, /script-src[^\n]*challenges\.cloudflare\.com/);
  assert.match(worker, /script-src[^\n]*maps\.googleapis\.com/);
  assert.match(worker, /script-src[^\n]*static\.cloudflareinsights\.com/);
  assert.match(worker, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.match(preflight, /Live release validation requires NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  assert.doesNotMatch(preflight, /Live release validation requires MED250_GATE_/);
});

test("uses WhatsApp Cloud OTP only for pharmacy portal access", async () => {
  const [marketplace, migration, hardeningMigration, contactsMigration, sendOtp, verifyOtp, shared, contactManifest] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713085244_pharmacy_whatsapp_otp_auth.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715180529_med250_security_hardening_20260714.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713094248_pharmacy_contacts.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-send-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/dawanear-pharmacy-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../data/imports/rwanda-fda-pharmacy-contacts-manifest.json", import.meta.url), "utf8"),
  ]);

  assertCataloguedMessage(marketplace, "whatsapp.send_code", "Send code on WhatsApp");
  assertCataloguedMessage(marketplace, "inventory.3be818907a1b", "Open your pharmacy workspace");
  assert.doesNotMatch(marketplace, /SECURE PHARMACY ACCESS/);
  assertCataloguedMessage(marketplace, "inventory.76305e161c53", "Enter the 6-digit code");
  assert.match(marketplace, /autoComplete="one-time-code"/);
  assertCataloguedMessage(marketplace, "inventory.46ea2bdb2842", "WhatsApp number not registered");
  assert.match(marketplace, /250795588248/);
  assertCataloguedMessage(marketplace, "inventory.1a0cae1ddbf6", "Contact admin on WhatsApp");
  assertCataloguedMessage(marketplace, "inventory.6ed73037f10e", "Linked phone and WhatsApp contacts");
  assertCataloguedMessage(marketplace, "inventory.95e154398a4b", "Replace");
  assertCataloguedMessage(marketplace, "inventory.6b0bc4eca709", "Request removal");
  assertCataloguedMessage(marketplace, "inventory.ca06556af647", "Submit contact request");
  assert.doesNotMatch(marketplace, /Email me a sign-in link|Email address|Already signed in but not linked|Submit a claim/);
  assert.doesNotMatch(marketplace, /Customers use anonymous sessions; pharmacy staff use a permanent email identity/);
  assert.match(migration, /dawanear_pharmacy_otp_challenges/);
  assert.match(migration, /code_hash/);
  assert.match(migration, /for update/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(contactsMigration, /dawanear_pharmacy_contacts/);
  assert.match(contactsMigration, /phone_numbers text\[\]/);
  assert.match(contactsMigration, /whatsapp_numbers text\[\]/);
  assert.match(contactsMigration, /is_login_enabled/);
  assert.match(contactsMigration, /dawanear_request_pharmacy_contact_edit/);
  assert.match(contactsMigration, /revoke all on table public\.dawanear_pharmacy_contacts from public, anon, authenticated/);
  assert.match(sendOtp, /dawanear_issue_pharmacy_otp/);
  assert.match(hardeningMigration, /pg_advisory_xact_lock/);
  assert.match(hardeningMigration, /dawanear_issue_pharmacy_otp/);
  assert.match(sendOtp, /eligiblePharmacies/);
  assert.match(sendOtp, /sendWhatsappOtp/);
  assert.match(sendOtp, /registered: false/);
  assert.match(sendOtp, /adminWhatsapp: "250795588248"/);
  assert.match(verifyOtp, /dawanear_consume_pharmacy_otp/);
  assert.match(verifyOtp, /whatsapp_cloud_otp/);
  assert.match(verifyOtp, /auth\.admin\.generateLink/);
  assert.match(verifyOtp, /sessionClient\.auth\.verifyOtp/);
  assert.doesNotMatch(verifyOtp, /signInWithPassword/);
  assert.match(shared, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(shared, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(shared, /WHATSAPP_TEMPLATE_URL_BUTTON_INDEX/);
  assert.match(shared, /crypto\.getRandomValues/);
  assert.match(shared, /from\("dawanear_pharmacy_contacts"\)/);
  assert.match(shared, /https:\/\/med-250\.com/);
  assert.doesNotMatch(shared, /https:\/\/med250\.gikundiro\.com/);
  assert.doesNotMatch(shared, /https:\/\/med250-rwanda\.ikanisa\.chatgpt\.site/);
  const manifest = JSON.parse(contactManifest);
  assert.equal(manifest.roster_pdfs_processed, 11);
  assert.equal(manifest.matched_contact_rows, 288);
  assert.equal(manifest.matched_pharmacies, 267);
  assert.doesNotMatch(sendOtp, /console\.log\([^\n]*code/);
});

test("supports international pharmacy WhatsApp numbers and transparent logos", async () => {
  const [marketplace, client, sendOtp, verifyOtp, migration, brandLogo, css, transparentLogo] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-send-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260718134000_expand_pharmacy_whatsapp_e164.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/brand-logo.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/brand/med-plus-250-wordmark-transparent.webp", import.meta.url)),
  ]);

  assert.match(marketplace, /function InternationalPhoneInput/);
  assert.match(marketplace, /whatsappCountries\.map/);
  assert.match(marketplace, /disabled=\{portalLoading \|\| !pharmacyWhatsappE164\}/);
  assert.doesNotMatch(marketplace, /<span>\+250<\/span>/);
  assert.doesNotMatch(marketplace, /`250\$\{pharmacyWhatsapp\}`/);
  assert.match(client, /function normalizeInternationalWhatsapp/);
  assert.match(sendOtp, /normalizeInternationalPhone/);
  assert.match(verifyOtp, /normalizeInternationalPhone/);
  assert.match(migration, /\^\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.match(migration, /dawanear_issue_pharmacy_otp/);
  assert.match(migration, /dawanear_consume_pharmacy_otp/);
  assert.match(migration, /dawanear_request_pharmacy_contact_edit/);
  assert.match(brandLogo, /med-plus-250-wordmark-transparent\.webp/);
  assert.match(css, /\.official-brand-logo\s*\{[\s\S]*?background:transparent;/);
  assert.equal(transparentLogo.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(transparentLogo.subarray(8, 12).toString("ascii"), "WEBP");
});

test("validates pharmacy OTP origins before any authentication side effect", async () => {
  const [sendOtp, verifyOtp, rollbackUat] = await Promise.all([
    readFile(new URL("../supabase/functions/dawanear-pharmacy-send-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/dawanear-pharmacy-verify-otp/index.ts", import.meta.url), "utf8"),
    readFile(new URL("./live-pharmacy-otp-rollback.sql", import.meta.url), "utf8"),
  ]);

  const sendOriginCheck = sendOtp.indexOf("const responseCors = corsHeaders(request)");
  assert.ok(sendOriginCheck >= 0);
  assert.ok(sendOriginCheck < sendOtp.indexOf("request.json()"));
  assert.ok(sendOriginCheck < sendOtp.indexOf('client.rpc("dawanear_issue_pharmacy_otp"'));
  assert.ok(sendOriginCheck < sendOtp.indexOf("await sendWhatsappOtp(phone, code)"));

  const verifyOriginCheck = verifyOtp.indexOf("const responseCors = corsHeaders(request)");
  assert.ok(verifyOriginCheck >= 0);
  assert.ok(verifyOriginCheck < verifyOtp.indexOf("request.json()"));
  assert.ok(verifyOriginCheck < verifyOtp.indexOf("dawanear_consume_pharmacy_otp"));
  assert.ok(verifyOriginCheck < verifyOtp.indexOf("auth.admin"));
  assert.ok(verifyOriginCheck < verifyOtp.indexOf("auth.admin.generateLink"));

  assert.match(rollbackUat, /^begin;/m);
  assert.match(rollbackUat, /^rollback;/m);
  assert.match(rollbackUat, /service_only_access/);
  assert.match(rollbackUat, /correct_code/);
  assert.match(rollbackUat, /single_use/);
  assert.match(rollbackUat, /wrong_code_retry/);
  assert.match(rollbackUat, /expired_code/);
  assert.match(rollbackUat, /malformed_input/);
});

test("automatically marketplace-approves every pharmacy", async () => {
  const [migration, importer] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260713095632_approve_all_marketplace_pharmacies.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-data/load-supabase.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /alter column marketplace_approved set default true/);
  assert.match(migration, /set marketplace_approved = true/);
  assert.match(importer, /marketplace_approved: true/);
  assert.doesNotMatch(importer, /marketplace_approved: false/);
});

test("keeps live order lifecycle conflict targets executable and rollback-testable", async () => {
  const [baseMigration, repairMigration, rollbackUat] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260712162437_install_med250_marketplace.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260713181347_fix_notification_conflict_targets.sql", import.meta.url), "utf8"),
    readFile(new URL("./live-marketplace-rollback.sql", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(baseMigration, /on conflict \(pharmacy_id, order_id, kind\)/i);
  assert.match(baseMigration, /on conflict on constraint dawanear_pharmacy_notifications_pharmacy_id_order_id_kind_key/i);
  assert.match(repairMigration, /dawanear_create_order[\s\S]*dawanear_select_offer[\s\S]*dawanear_close_order[\s\S]*dawanear_expire_timed_out_selected_orders/);
  assert.match(repairMigration, /revoke all on function public\.dawanear_create_order[\s\S]*grant execute[\s\S]*to authenticated/);

  assert.match(rollbackUat, /^begin;/m);
  assert.match(rollbackUat, /^rollback;/m);
  assert.match(rollbackUat, /dawanear_create_order/);
  assert.match(rollbackUat, /dawanear_pharmacy_requests/);
  assert.match(rollbackUat, /dawanear_submit_offer/);
  assert.match(rollbackUat, /dawanear_my_confirmed_offers/);
  assert.match(rollbackUat, /dawanear_select_offer/);
  assert.match(rollbackUat, /dawanear_selected_contact/);
  assert.match(rollbackUat, /dawanear_close_order/);
  assert.match(rollbackUat, /dawanear_pharmacy_is_dispatch_eligible/);
  assert.match(rollbackUat, /geocode_reviewed_by/);
  assert.match(rollbackUat, /dawanear_pharmacy_contacts/);
  assert.match(rollbackUat, /online_license_verified[\s\S]*false/);
  assert.match(rollbackUat, /automatic_marketplace_approval/);
  assert.match(rollbackUat, /eligibility_fail_closed/);
  assert.match(rollbackUat, /dawanear_contribute_price/);
  assert.match(rollbackUat, /central_price_boundary/);
  assert.match(rollbackUat, /optional_confirmation_price/);
  assert.match(rollbackUat, /customer_cancellation/);
  assert.match(rollbackUat, /no_response_recovery/);
  assert.match(rollbackUat, /selected_timeout_recovery/);
  assert.match(rollbackUat, /'persistence', 'rolled_back'/);
});

test("disables pharmacy catalogue prices and permits price-free availability confirmation", async () => {
  const [centralPriceMigration, rollbackUat] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260716070200_central_indicative_prices_whatsapp_first.sql", import.meta.url), "utf8"),
    readFile(new URL("./live-marketplace-rollback.sql", import.meta.url), "utf8"),
  ]);

  assert.match(centralPriceMigration, /centrally maintained indicative prices/);
  assert.match(centralPriceMigration, /Pharmacy-specific catalogue prices are not supported/);
  assert.match(centralPriceMigration, /unit_price_rwf is not null[\s\S]*not between 1 and 100000000/);
  assert.match(centralPriceMigration, /A confirmation must include at least one available item/);
  assert.match(rollbackUat, /Pharmacy-specific catalogue price was accepted/);
  assert.match(rollbackUat, /'unit_price_rwf', null/);
  assert.match(rollbackUat, /v_total_rwf <> 0/);
});

test("activates only current catalogue products for ordering", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260713131814_activate_current_catalogue.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /where is_active[\s\S]*regulatory_status in \('valid', 'grace_period', 'expiring_soon'\)/);
  assert.match(migration, /set is_orderable = false[\s\S]*not is_active/);
});

test("coordinates cleanup for every order sharing one prescription path", async () => {
  const [migration, cleanup] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260712162437_install_med250_marketplace.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/cleanup-prescriptions/index.ts", import.meta.url), "utf8"),
  ]);

  const createOrder = migration.slice(
    migration.indexOf("create function public.dawanear_create_order"),
    migration.indexOf("drop function if exists public.dawanear_pharmacy_requests"),
  );
  const pathLock = createOrder.indexOf("'dawanear-prescription:' || p_prescription_path");
  const staleOrderLock = createOrder.indexOf("select stale_order.id");
  const storageOwnershipCheck = createOrder.indexOf("from storage.objects as so");
  assert.ok(pathLock >= 0 && staleOrderLock > pathLock && storageOwnershipCheck > staleOrderLock,
    "order creation must lock the path before stale-order rows and Storage validation");
  assert.match(createOrder, /dawanear_prescription_cleanup_claims/);

  const eligibility = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_prescription_reference_is_cleanup_eligible"),
    migration.indexOf("create or replace function dawanear_private.dawanear_guard_prescription_cleanup_claim"),
  );
  assert.match(eligibility, /p_status = 'expired'[\s\S]*p_selected_at <= now\(\) - interval '24 hours'/);
  assert.match(eligibility, /p_status in \('draft', 'broadcast', 'offers_received', 'cancelled', 'expired'\)[\s\S]*p_expires_at < now\(\) - interval '24 hours'/);
  assert.match(eligibility, /p_status = 'completed'[\s\S]*p_updated_at < now\(\) - interval '30 days'/);
  assert.doesNotMatch(eligibility, /p_status in \([^)]*'selected'/);

  const claimRpc = migration.slice(
    migration.indexOf("create function public.dawanear_claim_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_claim_orphan_prescription_cleanup"),
  );
  assert.match(claimRpc, /pg_advisory_xact_lock/);
  assert.match(claimRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*end loop;[\s\S]*foreach v_path in array v_paths[\s\S]*from public\.dawanear_orders as o/);
  assert.match(claimRpc, /where o\.prescription_path = v_path[\s\S]*for update/);
  assert.match(claimRpc, /having pg_catalog\.bool_and\([\s\S]*dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(claimRpc, /not exists \([\s\S]*dawanear_prescription_cleanup_claims[\s\S]*c\.prescription_path = o\.prescription_path/);
  assert.match(claimRpc, /storage\.objects[\s\S]*so\.created_at >= now\(\) - interval '24 hours'/);
  assert.match(claimRpc, /and not dawanear_private\.dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(claimRpc, /lease_expires_at[\s\S]*interval '15 minutes'/);

  const orphanClaimRpc = migration.slice(
    migration.indexOf("create function public.dawanear_claim_orphan_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_recover_expired_prescription_cleanup_claims"),
  );
  assert.match(orphanClaimRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*end loop;[\s\S]*foreach v_path in array v_paths[\s\S]*from public\.dawanear_orders as o/);
  assert.match(orphanClaimRpc, /if found then[\s\S]*continue/);
  assert.match(orphanClaimRpc, /from storage\.objects as so[\s\S]*so\.created_at < now\(\) - interval '24 hours'/);
  assert.match(orphanClaimRpc, /select distinct candidate\.path as path/);
  assert.doesNotMatch(orphanClaimRpc, /btrim\(candidate\.path\) as path/);
  assert.match(migration, /grant execute on function public\.dawanear_claim_orphan_prescription_cleanup\(text\[\], integer\)[\s\S]*to service_role/);

  const recoveryRpc = migration.slice(
    migration.indexOf("create function public.dawanear_recover_expired_prescription_cleanup_claims"),
    migration.indexOf("drop function if exists public.dawanear_finalize_prescription_cleanup"),
  );
  assert.match(recoveryRpc, /from dawanear_private\.dawanear_prescription_cleanup_claims as c[\s\S]*c\.lease_expires_at <= now\(\)/);
  assert.match(recoveryRpc, /foreach v_path in array v_paths[\s\S]*pg_advisory_xact_lock[\s\S]*for update/);
  assert.match(recoveryRpc, /v_reference_count = 0 and not v_object_exists[\s\S]*delete from dawanear_private\.dawanear_prescription_cleanup_claims/);
  assert.match(recoveryRpc, /set claim_token = v_token,[\s\S]*lease_expires_at = now\(\) \+ interval '15 minutes'/);

  const finalizeRpc = migration.slice(
    migration.indexOf("create function public.dawanear_finalize_prescription_cleanup"),
    migration.indexOf("drop function if exists public.dawanear_my_active_orders"),
  );
  assert.match(finalizeRpc, /c\.claim_token = p_claim_token[\s\S]*for update/);
  assert.match(finalizeRpc, /and not dawanear_private\.dawanear_prescription_reference_is_cleanup_eligible/);
  assert.match(finalizeRpc, /update public\.dawanear_orders as o[\s\S]*set prescription_path = null[\s\S]*where o\.prescription_path = p_prescription_path/);
  assert.match(migration, /create trigger dawanear_orders_guard_prescription_cleanup/);
  assert.match(migration, /grant execute on function public\.dawanear_claim_prescription_cleanup\(integer\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.dawanear_recover_expired_prescription_cleanup_claims\(integer\)[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.dawanear_finalize_prescription_cleanup\(text, uuid\)[\s\S]*to service_role/);

  const storageInsertGuard = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_insert_prescription"),
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_delete_prescription"),
  );
  assert.match(storageInsertGuard, /pg_advisory_xact_lock/);
  assert.match(storageInsertGuard, /dawanear_prescription_cleanup_claims/);
  assert.match(storageInsertGuard, /not exists \([\s\S]*from public\.dawanear_orders/);
  const storageDeleteGuard = migration.slice(
    migration.indexOf("create or replace function dawanear_private.dawanear_customer_can_delete_prescription"),
    migration.indexOf("drop policy if exists dawanear_prescriptions_owner_insert"),
  );
  assert.match(storageDeleteGuard, /language plpgsql[\s\S]*volatile[\s\S]*pg_advisory_xact_lock/);
  assert.match(storageDeleteGuard, /if exists \([\s\S]*dawanear_prescription_cleanup_claims[\s\S]*return false/);
  assert.match(migration, /create policy dawanear_prescriptions_owner_insert[\s\S]*dawanear_customer_can_insert_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_owner_delete[\s\S]*dawanear_customer_can_delete_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_insert_guard[\s\S]*as restrictive for insert[\s\S]*dawanear_customer_can_insert_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_delete_guard[\s\S]*as restrictive for delete[\s\S]*dawanear_customer_can_delete_prescription\(name\)/);
  assert.match(migration, /create policy dawanear_prescriptions_no_client_update[\s\S]*as restrictive for update[\s\S]*bucket_id <> 'dawanear-prescriptions'/);
  assert.match(migration, /create policy dawanear_prescriptions_anon_select_guard[\s\S]*as restrictive for select[\s\S]*bucket_id <> 'dawanear-prescriptions'/);
  assert.match(migration, /create policy dawanear_prescriptions_authenticated_select_guard[\s\S]*as restrictive for select[\s\S]*dawanear_selected_pharmacy_can_read\(name\)/);

  const recoveryCall = cleanup.indexOf('"dawanear_recover_expired_prescription_cleanup_claims"');
  const claimCall = cleanup.indexOf('"dawanear_claim_prescription_cleanup"');
  const storageDelete = cleanup.indexOf(".remove([claim.prescription_path])");
  const finalizeCall = cleanup.indexOf('"dawanear_finalize_prescription_cleanup"');
  assert.ok(recoveryCall >= 0 && claimCall > recoveryCall && storageDelete > claimCall && finalizeCall > storageDelete,
    "the Edge Function must recover leases, claim due paths, delete through Storage, then finalize");
  assert.doesNotMatch(cleanup, /\.from\("dawanear_orders"\)\s*\.update\(\{ prescription_path: null \}\)/);
  assert.doesNotMatch(cleanup, /timedOutRetryResponse|abandonedResponse|completedResponse/);
  assert.doesNotMatch(cleanup, /remainingLimit/);
  assert.match(cleanup, /const recoveryLimit = Math\.max\(1, Math\.floor\(batchLimit \/ 2\)\)/);
  assert.match(cleanup, /const dueLimit = Math\.max\(1, batchLimit - recoveryLimit\)/);
  const orphanClaimCall = cleanup.indexOf('"dawanear_claim_orphan_prescription_cleanup"');
  const orphanStorageDelete = cleanup.indexOf("bucket.remove([claim.prescription_path])", orphanClaimCall);
  const orphanFinalizeCall = cleanup.indexOf('"dawanear_finalize_prescription_cleanup"', orphanStorageDelete);
  assert.ok(orphanClaimCall >= 0 && orphanStorageDelete > orphanClaimCall && orphanFinalizeCall > orphanStorageDelete,
    "orphan cleanup must claim before Storage deletion and finalize afterward");
  assert.doesNotMatch(cleanup, /bucket\.remove\(orphanPaths\)/);
  assert.match(cleanup, /recovered_claims: recoveredClaims\.length/);
  assert.match(cleanup, /due_claims: dueClaims\.length/);
  assert.match(cleanup, /claimed_paths: cleanupClaims\.length/);
  assert.match(cleanup, /recovery_limit: recoveryLimit/);
  assert.match(cleanup, /due_limit: dueLimit/);
  assert.match(cleanup, /references_cleared/);
});
