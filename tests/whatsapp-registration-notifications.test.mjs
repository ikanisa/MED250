import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = new URL("../supabase/migrations/20260718064237_whatsapp_customer_verification_and_notifications.sql", import.meta.url);
const customerContactOnlyMigrationPath = new URL("../supabase/migrations/20260730131500_make_customer_whatsapp_contact_only.sql", import.meta.url);
const outboxIndexMigrationPath = new URL("../supabase/migrations/20260718172000_index_whatsapp_outbox_foreign_keys.sql", import.meta.url);
const repairMigrationPath = new URL("../supabase/migrations/20260730143000_repair_offer_realtime_and_whatsapp_dispatch.sql", import.meta.url);
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
  create table public.dawanear_orders(id uuid primary key, user_id uuid references auth.users(id), whatsapp text, reference text, status text default 'broadcast', expires_at timestamptz default now() + interval '2 hours', delivery_preference text, prescription_path text);
  create table public.dawanear_order_items(id uuid primary key, order_id uuid references public.dawanear_orders(id), product_id uuid references public.dawanear_products(id), quantity int, created_at timestamptz default now());
  create table public.dawanear_order_recipients(order_id uuid references public.dawanear_orders(id), pharmacy_id uuid references public.dawanear_pharmacies(id), distance_m int, primary key(order_id,pharmacy_id));
  create table public.dawanear_pharmacy_contacts(id uuid primary key, pharmacy_id uuid references public.dawanear_pharmacies(id), e164 text, contact_type text, is_login_enabled bool, verification_status text, is_primary bool, verified_at timestamptz);
  create table public.dawanear_pharmacy_notifications(id uuid primary key, kind text, pharmacy_id uuid references public.dawanear_pharmacies(id), order_id uuid references public.dawanear_orders(id));
  create table public.dawanear_offers(id uuid primary key, order_id uuid references public.dawanear_orders(id), pharmacy_id uuid references public.dawanear_pharmacies(id), status text, total_rwf bigint, complete bool, submitted_at timestamptz, ready_in_minutes int, fulfilment_method text);
  create table public.dawanear_offer_items(id uuid primary key, offer_id uuid references public.dawanear_offers(id), available bool, is_substitute bool, offered_product_id uuid references public.dawanear_products(id), quantity int, unit_price_rwf bigint);
`;

test("customer WhatsApp is contact-only while pharmacy OTP authority stays separate", async () => {
  const [legacySql, contactOnlySql] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(customerContactOnlyMigrationPath, "utf8"),
  ]);
  assert.match(legacySql, /revoke all on table public\.dawanear_customer_otp_challenges from public, anon, authenticated/);
  assert.match(contactOnlySql, /drop trigger if exists dawanear_orders_verified_customer_whatsapp/);
  assert.match(contactOnlySql, /drop function if exists[\s\S]*dawanear_require_verified_customer_whatsapp/);
  assert.match(contactOnlySql, /Customer WhatsApp is a delivery\/contact destination, not a portal identity/);
  assert.match(contactOnlySql, /select orders\.whatsapp into v_phone[\s\S]*where orders\.id = new\.order_id/);
  assert.doesNotMatch(contactOnlySql, /profile\.whatsapp_verified_at/);
});

test("pharmacy and customer WhatsApp deliveries use a durable private outbox", async () => {
  const [sql, repairSql] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(repairMigrationPath, "utf8"),
  ]);
  assert.match(sql, /create table if not exists public\.dawanear_whatsapp_outbox/);
  assert.match(sql, /where queued\.status in \('queued', 'retry'\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /'pharmacy_request'/);
  assert.match(sql, /'customer_offer'/);
  assert.match(sql, /new\.status <> 'submitted' or new\.complete is distinct from true/);
  assert.match(sql, /portal_path', 'pharmacy-portal=open&request='/);
  assert.match(sql, /portal_path', 'request='/);
  assert.match(sql, /revoke all on table public\.dawanear_whatsapp_outbox from public, anon, authenticated/);
  assert.match(repairSql, /dispatch_rank <= 10/);
  assert.match(repairSql, /after insert or update of status, total_rwf, complete, submitted_at, fulfilment_method/);
  assert.match(repairSql, /pharmacy-request:' \|\| new\.order_id::text/);
});

test("the notification outbox indexes both foreign-key references", async () => {
  const sql = await readFile(outboxIndexMigrationPath, "utf8");
  assert.match(sql, /med250\.allow_product_image_governance_ddl/);
  assert.match(sql, /create index if not exists dawanear_whatsapp_outbox_offer_id_idx[\s\S]*\(offer_id\)/);
  assert.match(sql, /create index if not exists dawanear_whatsapp_outbox_pharmacy_id_idx[\s\S]*\(pharmacy_id\)/);
});

test("one-shot checkout accepts a valid contact number without customer OTP", async () => {
  const [source, runtimeCatalogJson] = await Promise.all([
    readFile(marketplacePath, "utf8"),
    readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"),
  ]);
  const runtimeMessages = JSON.parse(runtimeCatalogJson).messages;
  assert.doesNotMatch(source, /CheckoutStep|checkoutStep|setCheckoutStep|order-wizard-progress/);
  assert.match(source, /className="one-shot-checkout-feedback"/);
  assert.doesNotMatch(source, /requestCustomerWhatsappOtp|verifyCustomerWhatsappOtp|customerWhatsappVerified|customer-otp-card/);
  assert.match(source, /disabled=\{!cart\.length \|\| ordering \|\| Boolean\(prescriptionError\) \|\| !customerWhatsapp \|\| !coordinates\}/);
  assert.match(source, /await ensureAnonymousCustomer\(captchaToken \|\| undefined\)/);
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
  assert.match(dispatch, /isSupportedWhatsappImageUrl/);
  assert.match(dispatch, /app-icon-512\.png/);
  assert.match(dispatch, /WHATSAPP_DELIVERY_CONCURRENCY/);
  assert.match(dispatch, /Math\.min\([\s\S]*, 8\)/);
  assert.match(dispatch, /Promise\.all\(messages\.slice/);
  assert.match(dispatch, /whatsapp_dispatch_degraded/);
  assert.match(dispatch, /whatsapp_dispatch_completed/);
  assert.match(dispatch, /max_attempt/);
  assert.match(dispatch, /duration_ms/);
  assert.doesNotMatch(dispatch, /return Response\.json\(\{ claimed: messages\.length, results \}\)/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /HMAC/);
});

test("the effective migrations accept customer contact and enqueue price-free complete responses", async () => {
  const db = new PGlite();
  await db.exec(prerequisiteSchema);
  const [legacySql, repairSql, contactOnlySql] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(repairMigrationPath, "utf8"),
    readFile(customerContactOnlyMigrationPath, "utf8"),
  ]);
  await db.exec(legacySql.slice(0, legacySql.indexOf("\ncommit;") + "\ncommit;".length));
  await db.exec(contactOnlySql);
  await db.exec(repairSql);

  const userId = "00000000-0000-4000-8000-000000000001";
  const pharmacyId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";
  const orderId = "00000000-0000-4000-8000-000000000004";
  const offerId = "00000000-0000-4000-8000-000000000005";
  await db.exec(`insert into auth.users(id) values ('${userId}');`);
  await db.exec(`
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
    update public.dawanear_offers set fulfilment_method='delivery' where id='${offerId}';
  `);
  const queued = await db.query("select kind, recipient_e164, payload from public.dawanear_whatsapp_outbox order by kind");
  assert.equal(queued.rows.length, 2);
  const customerOffer = queued.rows.find((row) => row.kind === "customer_offer");
  const pharmacyRequest = queued.rows.find((row) => row.kind === "pharmacy_request");
  assert.equal(customerOffer.recipient_e164, "250780000000");
  assert.equal(customerOffer.payload.fulfilment_method, "delivery");
  assert.equal(customerOffer.payload.ready_in_minutes, 20);
  assert.equal(customerOffer.payload.portal_path, `request=${orderId}`);
  assert.equal(pharmacyRequest.recipient_e164, "250788000000");
  assert.equal(pharmacyRequest.payload.distance_m, 1250);
  assert.equal(pharmacyRequest.payload.portal_path, `pharmacy-portal=open&request=${orderId}`);
});

test("pharmacy WhatsApp fan-out is capped to the nearest ten verified WhatsApp recipients", async () => {
  const db = new PGlite();
  await db.exec(prerequisiteSchema);
  const sql = await readFile(migrationPath, "utf8");
  const repairSql = await readFile(repairMigrationPath, "utf8");
  await db.exec(sql.slice(0, sql.indexOf("\ncommit;") + "\ncommit;".length));
  const contactOnlySql = await readFile(customerContactOnlyMigrationPath, "utf8");
  await db.exec(contactOnlySql);
  await db.exec(repairSql);

  const userId = "00000000-0000-4000-8000-000000000101";
  const productId = "00000000-0000-4000-8000-000000000102";
  const orderId = "00000000-0000-4000-8000-000000000103";
  await db.exec(`
    insert into auth.users(id) values ('${userId}');
    select public.dawanear_mark_customer_whatsapp_verified('${userId}','250780000100');
    insert into public.dawanear_products(id,brand_name,generic_name,strength,dosage_form,pack_size,image_url) values ('${productId}','Fanout Medicine','Ingredient','10 mg','Tablet','20','https://example.test/product.webp');
    insert into public.dawanear_orders(id,user_id,whatsapp,reference,status,expires_at,delivery_preference) values ('${orderId}','${userId}','250780000100','TEST-FANOUT','broadcast',now() + interval '2 hours','either');
    insert into public.dawanear_order_items(id,order_id,product_id,quantity) values ('00000000-0000-4000-8000-000000000104','${orderId}','${productId}',1);
  `);
  const pharmacyRows = Array.from({ length: 12 }, (_, index) => {
    const ordinal = String(index + 1).padStart(12, "0");
    const pharmacyId = `00000000-0000-4000-8000-${ordinal}`;
    const contactId = `00000000-0000-4000-8001-${ordinal}`;
    const notificationId = `00000000-0000-4000-8002-${ordinal}`;
    const whatsapp = `250788000${String(index + 1).padStart(3, "0")}`;
    const distance = (index + 1) * 100;
    return `
      insert into public.dawanear_pharmacies(id,name) values ('${pharmacyId}','Fanout Pharmacy ${index + 1}');
      insert into public.dawanear_order_recipients(order_id,pharmacy_id,distance_m) values ('${orderId}','${pharmacyId}',${distance});
      insert into public.dawanear_pharmacy_contacts(id,pharmacy_id,e164,contact_type,is_login_enabled,verification_status,is_primary,verified_at) values ('${contactId}','${pharmacyId}','${whatsapp}','whatsapp',true,'admin_verified',true,now());
      insert into public.dawanear_pharmacy_notifications(id,kind,pharmacy_id,order_id) values ('${notificationId}','new_request','${pharmacyId}','${orderId}');
    `;
  }).join("\n");
  await db.exec(pharmacyRows);

  const queued = await db.query("select recipient_e164 from public.dawanear_whatsapp_outbox where kind='pharmacy_request' order by recipient_e164");
  assert.deepEqual(queued.rows.map((row) => row.recipient_e164), [
    "250788000001",
    "250788000002",
    "250788000003",
    "250788000004",
    "250788000005",
    "250788000006",
    "250788000007",
    "250788000008",
    "250788000009",
    "250788000010",
  ]);
});
