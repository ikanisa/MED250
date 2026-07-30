import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL("../supabase/migrations/20260718064237_whatsapp_customer_verification_and_notifications.sql", import.meta.url);
const outboxIndexMigrationPath = new URL("../supabase/migrations/20260718172000_index_whatsapp_outbox_foreign_keys.sql", import.meta.url);
const marketplacePath = new URL("../app/marketplace.tsx", import.meta.url);
const configPath = new URL("../supabase/config.toml", import.meta.url);
const dispatchPath = new URL("../supabase/functions/dispatch-whatsapp-notifications/index.ts", import.meta.url);
const webhookPath = new URL("../supabase/functions/whatsapp-webhook/index.ts", import.meta.url);

const prerequisiteSchema = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema dawanear_private;
  create table auth.users(id uuid primary key);
  create table public.dawanear_customer_profiles(user_id uuid primary key references auth.users(id), whatsapp text, preferred_language text default 'en', created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.dawanear_pharmacies(id uuid primary key, name text);
  create table public.dawanear_products(id uuid primary key, brand_name text, generic_name text, strength text, dosage_form text, pack_size text, image_url text);
  create table public.dawanear_orders(id uuid primary key, user_id uuid references auth.users(id), whatsapp text, reference text, delivery_preference text, prescription_path text);
  create table public.dawanear_order_items(id uuid primary key, order_id uuid references public.dawanear_orders(id), product_id uuid references public.dawanear_products(id), quantity int, created_at timestamptz default now());
  create table public.dawanear_order_recipients(order_id uuid references public.dawanear_orders(id), pharmacy_id uuid references public.dawanear_pharmacies(id), distance_m int, primary key(order_id,pharmacy_id));
  create table public.dawanear_pharmacy_contacts(id uuid primary key, pharmacy_id uuid references public.dawanear_pharmacies(id), e164 text, contact_type text, is_login_enabled bool, verification_status text, is_primary bool, verified_at timestamptz);
  create table public.dawanear_pharmacy_notifications(id uuid primary key, kind text, pharmacy_id uuid references public.dawanear_pharmacies(id), order_id uuid references public.dawanear_orders(id));
  create table public.dawanear_offers(id uuid primary key, order_id uuid references public.dawanear_orders(id), pharmacy_id uuid references public.dawanear_pharmacies(id), status text, total_rwf bigint, complete bool, submitted_at timestamptz, ready_in_minutes int, fulfilment_method text);
  create table public.dawanear_offer_items(id uuid primary key, offer_id uuid references public.dawanear_offers(id), available bool, is_substitute bool, offered_product_id uuid references public.dawanear_products(id), quantity int, unit_price_rwf bigint);
`;

test("customer orders require a verified matching WhatsApp profile", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /whatsapp_verified_at timestamptz/);
  assert.match(sql, /dawanear_orders_verified_customer_whatsapp/);
  assert.match(sql, /profile\.whatsapp = new\.whatsapp/);
  assert.match(sql, /profile\.whatsapp_verified_at is not null/);
  assert.match(sql, /revoke all on table public\.dawanear_customer_otp_challenges from public, anon, authenticated/);
});

test("pharmacy and customer WhatsApp deliveries use a durable private outbox", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.dawanear_whatsapp_outbox/);
  assert.match(sql, /where queued\.status in \('queued', 'retry'\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /'pharmacy_request'/);
  assert.match(sql, /'customer_offer'/);
  assert.match(sql, /new\.status <> 'submitted' or new\.complete is distinct from true/);
  assert.match(sql, /portal_path', 'pharmacy-portal=open&request='/);
  assert.match(sql, /portal_path', 'request='/);
  assert.match(sql, /revoke all on table public\.dawanear_whatsapp_outbox from public, anon, authenticated/);
});

test("the notification outbox indexes both foreign-key references", async () => {
  const sql = await readFile(outboxIndexMigrationPath, "utf8");
  assert.match(sql, /med250\.allow_product_image_governance_ddl/);
  assert.match(sql, /create index if not exists dawanear_whatsapp_outbox_offer_id_idx[\s\S]*\(offer_id\)/);
  assert.match(sql, /create index if not exists dawanear_whatsapp_outbox_pharmacy_id_idx[\s\S]*\(pharmacy_id\)/);
});

test("one-shot checkout keeps WhatsApp verification blocking without step navigation", async () => {
  const [source, runtimeCatalogJson] = await Promise.all([
    readFile(marketplacePath, "utf8"),
    readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"),
  ]);
  const runtimeMessages = JSON.parse(runtimeCatalogJson).messages;
  assert.doesNotMatch(source, /CheckoutStep|checkoutStep|setCheckoutStep|order-wizard-progress/);
  assert.match(source, /className="one-shot-checkout-feedback"/);
  assert.match(source, /requestCustomerWhatsappOtp/);
  assert.match(source, /verifyCustomerWhatsappOtp/);
  assert.match(source, /if \(!customerWhatsappVerified\)/);
  assert.match(source, /disabled=\{!cart\.length \|\| ordering \|\| Boolean\(prescriptionError\) \|\| !customerWhatsappVerified \|\| !coordinates\}/);
  assert.equal(runtimeMessages["inventory.bcdf0f413028"], "Up to 10 closest pharmacies");
});

test("notification functions are configured with the intended public and private boundaries", async () => {
  const [config, dispatch, webhook] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(dispatchPath, "utf8"),
    readFile(webhookPath, "utf8"),
  ]);
  assert.match(config, /\[functions\.dawanear-customer-send-otp\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.dawanear-customer-verify-otp\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.dispatch-whatsapp-notifications\][\s\S]*verify_jwt = false/);
  assert.match(config, /\[functions\.whatsapp-webhook\][\s\S]*verify_jwt = false/);
  assert.match(dispatch, /X-DawaNear-Cron-Token/);
  assert.match(dispatch, /WHATSAPP_PHARMACY_REQUEST_TEMPLATE_NAME/);
  assert.match(dispatch, /WHATSAPP_CUSTOMER_OFFER_TEMPLATE_NAME/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /HMAC/);
});

test("the migration blocks unverified orders and enqueues price-free complete responses", async () => {
  const db = new PGlite();
  await db.exec(prerequisiteSchema);
  const sql = await readFile(migrationPath, "utf8");
  await db.exec(sql.slice(0, sql.indexOf("\ncommit;") + "\ncommit;".length));

  const userId = "00000000-0000-4000-8000-000000000001";
  const pharmacyId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";
  const orderId = "00000000-0000-4000-8000-000000000004";
  const offerId = "00000000-0000-4000-8000-000000000005";
  await db.exec(`insert into auth.users(id) values ('${userId}');`);
  await assert.rejects(
    db.exec(`insert into public.dawanear_orders(id,user_id,whatsapp,reference,delivery_preference) values ('${orderId}','${userId}','250780000000','TEST-1','either');`),
    /Verify this WhatsApp number/,
  );
  await db.exec(`
    select public.dawanear_mark_customer_whatsapp_verified('${userId}','250780000000');
    insert into public.dawanear_pharmacies(id,name) values ('${pharmacyId}','Test Pharmacy');
    insert into public.dawanear_products(id,brand_name,generic_name,strength,dosage_form,pack_size,image_url) values ('${productId}','Test Medicine','Ingredient','10 mg','Tablet','20','https://example.test/product.webp');
    insert into public.dawanear_orders(id,user_id,whatsapp,reference,delivery_preference) values ('${orderId}','${userId}','250780000000','TEST-1','either');
    insert into public.dawanear_order_items(id,order_id,product_id,quantity) values ('00000000-0000-4000-8000-000000000006','${orderId}','${productId}',2);
    insert into public.dawanear_order_recipients(order_id,pharmacy_id,distance_m) values ('${orderId}','${pharmacyId}',1250);
    insert into public.dawanear_pharmacy_contacts(id,pharmacy_id,e164,contact_type,is_login_enabled,verification_status,is_primary,verified_at) values ('00000000-0000-4000-8000-000000000007','${pharmacyId}','250788000000','whatsapp',true,'admin_verified',true,now());
    insert into public.dawanear_pharmacy_notifications(id,kind,pharmacy_id,order_id) values ('00000000-0000-4000-8000-000000000008','new_request','${pharmacyId}','${orderId}');
    insert into public.dawanear_offers(id,order_id,pharmacy_id,status,total_rwf,complete,submitted_at,ready_in_minutes,fulfilment_method) values ('${offerId}','${orderId}','${pharmacyId}','draft',0,false,null,20,'either');
    insert into public.dawanear_offer_items(id,offer_id,available,is_substitute,offered_product_id,quantity,unit_price_rwf) values ('00000000-0000-4000-8000-000000000009','${offerId}',true,false,'${productId}',2,null);
    update public.dawanear_offers set status='submitted', complete=true, submitted_at=now() where id='${offerId}';
  `);
  const queued = await db.query("select kind, recipient_e164 from public.dawanear_whatsapp_outbox order by kind");
  assert.deepEqual(queued.rows, [
    { kind: "customer_offer", recipient_e164: "250780000000" },
    { kind: "pharmacy_request", recipient_e164: "250788000000" },
  ]);
});
