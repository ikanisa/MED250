import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/", envOverrides = {}, origin = "https://med250.gikundiro.com") {
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
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-site");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("x-permitted-cross-domain-policies"), "none");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
  const html = await response.text();
  assert.match(html, /<title>MED\+250/);
  assert.match(html, /Connect with a pharmacy that has it/);
  assert.match(html, /Popular products today/);
  assert.match(html, /0\.9% SODIUM CHLORIDE INJECTION/);
  assert.match(html, /All Categories/);
  assert.doesNotMatch(html, /Check licensed pharmacy records/);
  assert.doesNotMatch(html, /Connected private preview/);
  assert.doesNotMatch(html, /marketplace—not a simple pharmacy website/);
  assert.doesNotMatch(html, /class="eyebrow"/);
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

test("keeps the production server usable when local vinext provides no Cloudflare bindings", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-no-env`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("https://med250.gikundiro.com/", { headers: { accept: "text/html" } }),
    undefined,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(await response.text(), /<title>MED\+250/);
});

test("server-renders canonical product metadata without claiming the marketplace card is a product photo", async () => {
  const response = await render("/product/rwanda-fda-hm-0734");
  assert.equal(response.status, 200);
  const html = await response.text();
  const metadataOrigin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://med250.gikundiro.com";
  assert.match(html, /<title>IBUPAR CAPLETS 400mg\/325mg \| MED\+250<\/title>/);
  assert.ok(html.includes(`rel="canonical" href="${metadataOrigin}/product/rwanda-fda-hm-0734"`));
  assert.match(html, /og-marketplace-v2\.png/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /Manufacturer/);
  assert.match(html, /Rwanda FDA registration/);
  assert.match(html, /DAWA limited/);
  assert.ok(!html.includes(`"image":"${metadataOrigin}/og-marketplace-v2.png"`));
});

test("keeps previews and workers.dev unindexed while permitting an explicit live custom domain", async () => {
  const previewRobots = await render("/robots.txt");
  assert.equal(previewRobots.status, 200);
  const robotsText = await previewRobots.text();
  const bundleAllowsIndexing = /(?:^|\n)Allow:\s*\//i.test(robotsText);
  if (bundleAllowsIndexing) {
    assert.match(robotsText, /User-Agent: \*[\s\S]*(?:^|\n)Allow:\s*\//im);
    assert.match(robotsText, /Sitemap: https:\/\/med250\.gikundiro\.com\/sitemap\.xml/i);
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
    assert.match(html, /Ordering coming soon/);
    assert.doesNotMatch(html, />Place order</);
  }
});

test("blocks releases when frontend and Worker modes diverge", () => {
  const result = spawnSync(process.execPath, ["scripts/validate-release-config.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_MARKETPLACE_MODE: "live", NEXT_PUBLIC_SITE_URL: "https://med250.gikundiro.com" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Frontend and Worker release modes do not match/);
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
  const accepted = await worker.fetch(new Request("https://med250.gikundiro.com/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "catalogue_search",
      properties: { queryLength: 7, resultCount: 44, durationMs: 312, unexpected: "discard-me" },
    }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });

  const rejected = await worker.fetch(new Request("https://med250.gikundiro.com/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "4096" },
    body: JSON.stringify({ name: "unknown_event" }),
  }), {}, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(rejected.status, 413);

  const rejectedWithoutLength = await worker.fetch(new Request("https://med250.gikundiro.com/api/telemetry", {
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
  assert.match(marketplace, /if \(!backendConfigured \|\| !serverCatalogueAvailable \|\| initialProductId\) return undefined/);
  assert.match(marketplace, /hero-pharmacy-still-life\.webp/);
  assert.doesNotMatch(marketplace, /(?:hero-pharmacy-still-life|category-[^"']+|product-pack-[^"']+)\.png/);
  assert.doesNotMatch(marketplace, /product-pack-[^"']+\.webp/);
  assert.match(marketplace, /if \(!resolvedImageUrl\) return null/);
  assert.match(marketplace, /if \(approvedImages\.length !== 3\) return null/);
  assert.match(marketplace, /cardImageUrl \? <Link className="product-image-wrap"/);
  assert.match(brandLogo, /med-plus-250-wordmark-220\.png/);
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
  assert.match(marketplace, /aria-label="Grid view"/);
  assert.match(marketplace, /aria-label="List view"/);
  assert.match(marketplace, /function ProductCard/);
  assert.match(marketplace, /className="product-card-content"/);
  assert.match(marketplace, /className="product-card-specs"/);
  assert.match(marketplace, /className="product-image-action">View product/);
  assert.match(css, /product-grid\.list-view/);
  assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
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

  assert.match(marketplace, /Use current location/);
  assert.doesNotMatch(marketplace, /Your browser will ask for location only when you place the order/);
  assert.match(marketplace, /No response available/);
  assert.match(marketplace, /Request expired/);
  assert.match(marketplace, /Request cancelled/);
  assert.match(marketplace, /Waiting for availability confirmations/);
  assert.match(marketplace, /Availability request sent/);
  assert.match(marketplace, /Pickup possible/);
  assert.match(marketplace, /Fulfilment preference/);
  assert.match(marketplace, /Delivery possible/);
  assert.doesNotMatch(marketplace, /checkout step|payment integration|public pharmacy profile/i);
});

test("keeps My Requests separate from the request basket", async () => {
  const marketplace = await readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8");

  assert.match(marketplace, /onClick=\{\(\) => setOffersOpen\(true\)\}/);
  assert.match(marketplace, /No active requests/);
  assert.match(marketplace, /Open request basket/);
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
  const [marketplace, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /new IntersectionObserver/);
  assert.match(marketplace, /rootMargin: "800px 0px"/);
  assert.match(marketplace, /setVisibleCount\(\(count\) => count \+ PRODUCT_BATCH_SIZE\)/);
  assert.match(marketplace, /ref=\{productLoadSentinelRef\}/);
  assert.match(marketplace, /data-testid="product-scroll-sentinel"/);
  assert.match(marketplace, /All \{accessibleCatalogueSize\.toLocaleString\(\)\} matching products are loaded/);
  assert.doesNotMatch(marketplace, /All \{catalogueMatchCount\.toLocaleString\(\)\} matching products are loaded/);
  assert.match(marketplace, /data-product-card=\{product\.id\}/);
  assert.match(marketplace, /loading=\{eager \? "eager" : "lazy"\}/);
  assert.doesNotMatch(marketplace, /Show 48 more products|>See all<\/button>/);
  assert.match(css, /content-visibility:auto/);
  assert.match(css, /contain-intrinsic-size:auto 410px/);
});

test("provides accessible feedback, mobile filters, wizard progress, and resilient loading states", async () => {
  const [marketplace, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(marketplace, /data-modal-root="catalogue-filters"/);
  assert.match(marketplace, /aria-describedby="catalogue-filter-description"/);
  assert.match(marketplace, /className="wizard-progress"/);
  assert.match(marketplace, /aria-current=\{portalStage === "otp" \? "step"/);
  assert.match(marketplace, /className="order-wizard-progress"/);
  assert.match(marketplace, /Review and send your availability request/);
  assert.match(marketplace, /Continue to details/);
  assert.match(marketplace, /Review request/);
  assert.match(marketplace, /continueToOrderConfirmation/);
  assert.match(marketplace, /className="catalogue-skeleton"/);
  assert.match(marketplace, /aria-busy=\{ordering\}/);
  assert.match(marketplace, /navigator\.onLine/);
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
  assert.match(css, /footer\.order-wizard-actions[\s\S]*background:linear-gradient/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("requires international customer WhatsApp and restores on-device order preferences", async () => {
  const [marketplace, client, migration] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dawanear-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715180536_expand_med250_customer_whatsapp_e164_20260715.sql", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /getCountries\(\)/);
  assert.match(marketplace, /getCountryCallingCode/);
  assert.match(marketplace, /aria-label="WhatsApp country code"/);
  assert.match(marketplace, /required · remembered for your next visit/);
  assert.match(marketplace, /CUSTOMER_PREFERENCES_STORAGE_KEY/);
  assert.match(marketplace, /coordinates: coordinates/);
  assert.match(marketplace, /applyMapLocation/);
  assert.match(marketplace, /Map location saved for nearby pharmacy matching/);
  assert.match(marketplace, /isLegacyManualLocation/);
  assert.doesNotMatch(marketplace, /optional · saved to your customer profile/);
  assert.doesNotMatch(marketplace, /Anonymous sign-in is an identity control/);
  assert.match(client, /normalizeCustomerWhatsapp/);
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

  assert.match(marketplace, /Use current location/);
  assert.match(marketplace, /Choose on map/);
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

  assert.match(marketplace, /"Add to cart"/);
  assert.match(marketplace, /className="product-card-cart"/);
  assert.match(marketplace, /<ShoppingCart size=\{19\}/);
  assert.doesNotMatch(marketplace, /"Check availability"|>Check availability</);
  assert.doesNotMatch(marketplace, /product-card-request/);
  assert.match(marketplace, /className=\{`product-prescription-status status-\$\{status\}`\}/);
  assert.match(marketplace, /<small>Price<\/small>/);
  assert.doesNotMatch(marketplace, /<small>\{status\}<\/small>/);
  assert.doesNotMatch(marketplace, /<small>Central indicative price<\/small>/);
  assert.match(marketplace, /Your cart/);
  assert.match(marketplace, /added to your cart/);
  assert.match(css, /\.product-card-cart[\s\S]*grid-column:2/);
  assert.match(marketplace, /basketCount === 1 \? "item" : "items"/);
  assert.doesNotMatch(marketplace, /basketCount === 1 \? "product" : "products"/);
  assert.match(marketplace, /Send availability request/);
  assert.doesNotMatch(marketplace, /"Add to order"|>Order basket<\/span>|One order\./);
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
  assert.match(marketplace, /\{priced \? <div><small>Price<\/small>/);
  assert.match(marketplace, /\{hasPriceData\(selectedProduct\) \? <div><span>Central indicative price<\/span>/);
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

  assert.match(marketplace, /For Pharmacies/);
  assert.doesNotMatch(marketplace, /Represent a pharmacy\?|Open pharmacy portal|>Pharmacy portal</);
  assert.doesNotMatch(marketplace, /href="\/how-it-works"|href="\/accessibility"|className="network-strip"/);
  assert.doesNotMatch(sitemap, /how-it-works|accessibility/);
});

test("opens the basket after add and provides a rotating product gallery", async () => {
  const [marketplace, taxonomy, css] = await Promise.all([
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/non-prescription-taxonomy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(marketplace, /function add\(product: Product\)[\s\S]*setCartOpen\(true\);[\s\S]*product_added/);
  assert.match(marketplace, /function ProductGallery/);
  assert.match(marketplace, /window\.setInterval[\s\S]*4800/);
  assert.match(marketplace, /setAutoRotate\(false\)/);
  assert.match(marketplace, /onTouchStart[\s\S]*onTouchEnd/);
  assert.match(marketplace, /Show previous product image/);
  assert.match(marketplace, /Show next product image/);
  assert.match(marketplace, /Pause automatic gallery rotation/);
  assert.match(marketplace, /Resume automatic gallery rotation/);
  assert.match(marketplace, /aria-roledescription="carousel"/);
  assert.match(marketplace, /product-gallery-dots/);
  assert.match(marketplace, /function ProductDetailsList/);
  assert.match(marketplace, /Product information/);
  assert.match(marketplace, /product-gallery-thumbnails/);
  assert.match(marketplace, /aria-controls="product-gallery-stage"/);
  assert.match(css, /\.product-gallery-slide\.active/);
  assert.match(css, /\.product-gallery-thumbnail\[aria-pressed="true"\]/);
  assert.match(css, /\.product-gallery-status/);
  assert.match(css, /\.product-gallery-dots button\[aria-current="true"\]/);
  assert.match(css, /\.product-specification-list>div/);
  assert.match(css, /\.product-detail-buy \{ margin:0; padding:12px 14px max\(12px,env\(safe-area-inset-bottom\)\); position:fixed/);
  assert.match(css, /grid-template-columns:112px minmax\(0,1fr\)/);
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

  assert.match(marketplace, /Send availability request/);
  assert.match(marketplace, /Pharmacies that confirmed availability/);
  assert.match(marketplace, /Continue on WhatsApp/);
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
  assert.match(page, /<Marketplace initialProducts=\{getInitialMarketplaceProducts\(\)\} initialTaxonomy=\{initialTaxonomy\} \/>/);
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
  assert.match(marketplace, /Retry the same secure request/);
  assert.match(marketplace, /detectNativeLocation/);
  assert.doesNotMatch(marketplace, /locationConsent|broadcastConsent/);
  assert.match(marketplace, /pendingOrderAttempt\?\.rpcAttempted/);
  assert.match(marketplace, /isCompatibleSubstitute/);
  assert.match(marketplace, /normalizedSubstitutionField\(product\.packSize\)/);
  assert.match(marketplace, /Finish request/);
  assert.match(marketplace, /Promise\.allSettled/);
  assert.match(marketplace, /Pharmacy contact unavailable/);
  assert.doesNotMatch(marketplace, /const quotes|Vine Pharmacy|setTimeout\(\(\) => \{ setOrdering/);
  assert.doesNotMatch(marketplace, /pack-box|pill-one|Google Maps candidate/);
  assert.doesNotMatch(marketplace, /Beauty & wellness/);
  assert.match(marketplace, /disabled=\{selectionLocked\}/);
  assert.match(marketplace, /Only pharmacies that confirm every requested product will appear here/);
  assert.doesNotMatch(marketplace, /Pay with MoMo|Pay pharmacy with MoMo/);
  assert.match(marketplace, /Sign out of pharmacy portal/);
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
  assert.match(preflight, /MED250_GATE_GPS_READY/);
  assert.match(preflight, /MED250_GATE_WHATSAPP_READY/);
  assert.match(preflight, /MED250_GATE_PHARMACY_OPERATIONS_APPROVED/);
  assert.match(preflight, /MED250_GATE_REGULATORY_APPROVED/);
  assert.match(preflight, /MED250_GATE_DATA_REUSE_APPROVED/);
  assert.match(preflight, /MED250_GATE_DUPLICATE_REGISTER_REVIEWED/);
  assert.match(preflight, /MED250_GATE_CREDENTIALS_ROTATED/);
  assert.match(preflight, /MED250_GATE_SECURITY_HARDENING_DEPLOYED/);
  assert.match(preflight, /MED250_GATE_EDGE_FUNCTIONS_DEPLOYED/);
  assert.match(preflight, /MED250_GATE_TURNSTILE_SERVER_VERIFIED/);
  assert.match(preflight, /MED250_GATE_AUTH_RATE_LIMITS_APPROVED/);
  assert.match(preflight, /MED250_GATE_PRESCRIPTION_RETENTION_APPROVED/);
  assert.match(preflight, /MED250_GATE_CLOUDFLARE_ACCOUNT_VERIFIED/);
  assert.match(preflight, /MED250_GATE_DOMAIN_DNS_VERIFIED/);
  assert.match(preflight, /MED250_GATE_PHYSICAL_UAT_PASSED/);
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

  assert.match(marketplace, /Send code on WhatsApp/);
  assert.match(marketplace, /Sign in with registered WhatsApp number/);
  assert.doesNotMatch(marketplace, /SECURE PHARMACY ACCESS/);
  assert.match(marketplace, /Enter your WhatsApp code/);
  assert.match(marketplace, /autoComplete="one-time-code"/);
  assert.match(marketplace, /WhatsApp number not registered/);
  assert.match(marketplace, /250795588248/);
  assert.match(marketplace, /Contact admin on WhatsApp/);
  assert.match(marketplace, /Linked phone and WhatsApp contacts/);
  assert.match(marketplace, />Replace</);
  assert.match(marketplace, />Request removal</);
  assert.match(marketplace, /Submit contact request/);
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
  assert.match(verifyOtp, /signInWithPassword/);
  assert.match(shared, /WHATSAPP_ACCESS_TOKEN/);
  assert.match(shared, /WHATSAPP_TEMPLATE_NAME/);
  assert.match(shared, /WHATSAPP_TEMPLATE_URL_BUTTON_INDEX/);
  assert.match(shared, /crypto\.getRandomValues/);
  assert.match(shared, /from\("dawanear_pharmacy_contacts"\)/);
  assert.match(shared, /https:\/\/med250-rwanda\.ikanisa\.chatgpt\.site/);
  const manifest = JSON.parse(contactManifest);
  assert.equal(manifest.roster_pdfs_processed, 11);
  assert.equal(manifest.matched_contact_rows, 288);
  assert.equal(manifest.matched_pharmacies, 267);
  assert.doesNotMatch(sendOtp, /console\.log\([^\n]*code/);
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
  assert.ok(verifyOriginCheck < verifyOtp.indexOf("signInWithPassword"));

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
