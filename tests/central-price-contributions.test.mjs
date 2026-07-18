import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260718081523_add_central_pharmacy_price_contributions.sql", import.meta.url);
const clientPath = new URL("../lib/dawanear-client.ts", import.meta.url);
const marketplacePath = new URL("../app/marketplace.tsx", import.meta.url);
const stylesPath = new URL("../app/globals.css", import.meta.url);
const messagesPath = new URL("../data/localization/messages.en-RW.json", import.meta.url);
const runtimeMessagesPath = new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url);

test("central price contributions retain every submission without publishing pharmacy prices", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create table public\.dawanear_central_price_contributions/);
  assert.match(migration, /outcome in \('initialized', 'lowered', 'not_lower'\)/);
  assert.match(migration, /insert into public\.dawanear_central_price_contributions/);
  assert.match(migration, /v_resulting := case[\s\S]*least\(v_previous, p_price_rwf\)/);
  assert.match(migration, /if v_previous is null or p_price_rwf < v_previous then[\s\S]*update public\.dawanear_products/);
  assert.doesNotMatch(migration, /insert into public\.dawanear_pharmacy_prices/);
  assert.match(migration, /revoke all on table public\.dawanear_central_price_contributions[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on table public\.dawanear_central_price_contributions[\s\S]*to service_role/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /grant execute on function public\.dawanear_contribute_central_price\(uuid, text, integer\)[\s\S]*to authenticated/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /pharmacy\.is_active/);
  assert.doesNotMatch(migration, /membership\.pharmacy_id = p_pharmacy_id[\s\S]{0,500}marketplace_approved/);
});

test("pharmacy client validates input and maps a central contribution receipt", async () => {
  const client = await readFile(clientPath, "utf8");

  assert.match(client, /export async function contributeCentralPrice/);
  assert.match(client, /requirePermanentPharmacyUser\("Could not record the central price contribution"\)/);
  assert.match(client, /requireInteger\(input\.priceRwf, "Price", 1, 100_000_000\)/);
  assert.match(client, /client\.rpc\("dawanear_contribute_central_price"/);
  assert.match(client, /becameLowest: booleanValue\(row, false, "became_lowest"\)/);
});

test("pharmacy portal exposes the full searchable catalogue in lazy batches of twenty", async () => {
  const [marketplace, styles, messages, runtimeMessagesJson] = await Promise.all([
    readFile(marketplacePath, "utf8"),
    readFile(stylesPath, "utf8"),
    readFile(messagesPath, "utf8"),
    readFile(runtimeMessagesPath, "utf8"),
  ]);
  const runtimeMessages = JSON.parse(runtimeMessagesJson).messages;

  assert.match(marketplace, /type PortalTab = "requests" \| "catalogue" \| "profile"/);
  assert.match(marketplace, /const PORTAL_PRODUCT_BATCH_SIZE = 20/);
  assert.match(marketplace, /new IntersectionObserver/);
  assert.match(marketplace, /count \+ PORTAL_PRODUCT_BATCH_SIZE/);
  assert.match(marketplace, /products\.slice\(0, visibleCount\)/);
  assert.match(marketplace, /marketplaceMessage\("inventory\.718622df41f1"\)/);
  assert.doesNotMatch(marketplace, /pharmacy-catalogue-pagination/);
  assert.doesNotMatch(marketplace, /marketplaceMessage\("inventory\.aa815bddbd5a"\)/);
  assert.doesNotMatch(marketplace, /marketplaceMessage\("inventory\.9522fee5eaa3"\)/);
  assert.equal(runtimeMessages["catalogue.loading_next_products"], "Loading the next {0} products");
  assert.equal(runtimeMessages["catalogue.product_count"], "{0} products");
  assert.match(marketplace, /marketplaceMessage\("product\.price_label"\)/);
  assert.match(marketplace, /marketplaceMessage\("product\.indicative_price_prefix"\)[\s\S]*marketplaceNumber\(product\.indicativePriceRwf\)/);
  assert.match(messages, /"product\.indicative_price_prefix": "From RWF"/);
  assert.equal(runtimeMessages["inventory.67b2a1e6d7d2"], "Price recorded. The central display is now {0} {1}.");
  assert.equal(runtimeMessages["inventory.65925c7a87f4"], "Price recorded. {0} {1} remains the lowest central price.");
  assert.match(marketplace, /result\.becameLowest[\s\S]*marketplaceFormatMessage\("inventory\.67b2a1e6d7d2"/);
  assert.match(marketplace, /marketplaceFormatMessage\("inventory\.65925c7a87f4"/);
  assert.match(styles, /\.pharmacy-catalogue-list/);
  assert.match(styles, /content-visibility:auto/);
  assert.match(styles, /\.pharmacy-catalogue-sentinel/);
  assert.match(styles, /\.portal-mobile-tabs/);
});
