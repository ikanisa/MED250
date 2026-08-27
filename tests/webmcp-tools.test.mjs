import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tools = [
  ["ask-site", "med250.ask_site", "ask_site"],
  ["search-products", "catalogue.search", "search_products"],
  ["product-details", "catalogue.product_details", "get_product_details"],
  ["add-to-basket", "request_basket.add", "add_to_order_basket"],
  ["update-basket", "request_basket.update", "update_order_basket"],
  ["prepare-request", "request.prepare", "prepare_order_request"],
];

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("approved WebMCP tools use stable SDK definitions", async () => {
  for (const [file, stableKey, name] of tools) {
    const text = await source(`webmcp/${file}.ts`);
    assert.match(text, /import \{ defineTool \} from "@nekuda\/webmcp-sdk";/);
    assert.match(text, new RegExp(`stableKey: "${stableKey.replace(".", "\\.")}"`));
    assert.match(text, new RegExp(`name: "${name}"`));
    assert.match(text, /description: ".+"/);
    assert.match(text, /additionalProperties: false/);
    assert.doesNotMatch(text, /document\.modelContext|navigator\.modelContext/);
  }
});

test("WebMCP registration is scoped and SDK telemetry is disabled", async () => {
  const siteRegistrar = await source("webmcp/site-registrar.tsx");
  const marketplaceRegistrar = await source("webmcp/marketplace-registrar.tsx");
  assert.match(siteRegistrar, /registerTools\(\[askSite\], \{ telemetry: false \}\)/);
  assert.match(marketplaceRegistrar, /basketCount > 0/);
  assert.match(marketplaceRegistrar, /updateOrderBasket, prepareOrderRequest/);
  assert.match(marketplaceRegistrar, /registerTools\(tools, \{ telemetry: false \}\)/);
  assert.match(marketplaceRegistrar, /registration\.unregister\(\)/);
});

test("WebMCP tools stop before sensitive request submission", async () => {
  const generated = (await Promise.all(tools.map(([file]) => source(`webmcp/${file}.ts`)))).join("\n");
  assert.doesNotMatch(generated, /\/api\/auth|\/api\/orders/);
  assert.doesNotMatch(generated, /requestCustomerWhatsappOtp|verifyCustomerWhatsappOtp/);
  assert.doesNotMatch(generated, /uploadPrescription|createOrder|submitOrder|navigator\.geolocation/);
  const preparation = await source("webmcp/prepare-request.ts");
  assert.match(preparation, /No OTP, prescription, location, message, or pharmacy request was sent/);
});

test("Next layout and marketplace mount the correct registrars", async () => {
  const layout = await source("app/layout.tsx");
  const marketplace = await source("app/marketplace.tsx");
  assert.match(layout, /<SiteWebMcpRegistrar \/>/);
  assert.match(marketplace, /<MarketplaceWebMcpRegistrar basketCount=\{basketCount\} runtimeRef=\{webMcpRuntimeRef\} \/>/);
});
