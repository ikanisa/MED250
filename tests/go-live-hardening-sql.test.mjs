import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/20260723120000_marketplace_go_live_hardening.sql", import.meta.url),
  "utf8",
);

const pharmacyA = "00000000-0000-0000-0000-000000000010";
const pharmacyB = "00000000-0000-0000-0000-000000000011";
const userA = "00000000-0000-0000-0000-000000000020";
const userB = "00000000-0000-0000-0000-000000000021";
const loginPhone = "250788888888";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema dawanear_private;

    create function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create function auth.jwt()
    returns jsonb language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

    create table public.dawanear_pharmacies (
      id uuid primary key,
      name text not null,
      is_active boolean not null default true,
      marketplace_approved boolean not null default true,
      online_license_verified boolean not null default true,
      license_expires_on date not null default current_date + 30
    );

    create table public.dawanear_pharmacy_contacts (
      id uuid primary key default gen_random_uuid(),
      pharmacy_id uuid not null references public.dawanear_pharmacies(id),
      contact_type text not null,
      e164 text not null,
      is_primary boolean not null default false,
      is_login_enabled boolean not null default false,
      verification_status text not null,
      verified_at timestamptz,
      verified_by uuid,
      verification_note text,
      source_type text,
      derived_from_contact_id uuid,
      last_login_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table public.dawanear_pharmacy_identities (
      phone text primary key,
      user_id uuid not null unique,
      verified_at timestamptz,
      last_login_at timestamptz,
      updated_at timestamptz not null default now()
    );

    create table public.dawanear_pharmacy_memberships (
      id uuid primary key default gen_random_uuid(),
      pharmacy_id uuid not null references public.dawanear_pharmacies(id),
      user_id uuid not null,
      role text not null default 'staff',
      status text not null default 'active',
      created_by uuid,
      updated_at timestamptz not null default now(),
      unique (pharmacy_id, user_id)
    );

    create function dawanear_private.dawanear_retire_contact_authority()
    returns trigger language plpgsql security definer set search_path = ''
    as $$ begin return new; end $$;

    create trigger dawanear_retire_contact_authority
    after update on public.dawanear_pharmacy_contacts
    for each row execute function dawanear_private.dawanear_retire_contact_authority();

    create table public.dawanear_orders (
      id uuid primary key,
      user_id uuid not null
    );

    create table public.dawanear_offers (
      id uuid primary key,
      order_id uuid not null references public.dawanear_orders(id),
      pharmacy_id uuid not null references public.dawanear_pharmacies(id)
    );

    create table public.dawanear_offer_items (
      id uuid primary key default gen_random_uuid(),
      offer_id uuid not null references public.dawanear_offers(id)
    );
    alter table public.dawanear_offer_items enable row level security;

    create table public.dawanear_product_catalog (
      id text primary key,
      registration_number text,
      brand_name text,
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text,
      category text,
      prescription_status text,
      regulatory_status text,
      manufacturer text,
      manufacturer_country text,
      expiry_date date,
      image_url text,
      is_orderable boolean,
      source_name text,
      source_url text,
      price_min_rwf numeric,
      price_max_rwf numeric,
      price_contributors bigint,
      indicative_price_rwf numeric,
      price_is_indicative boolean,
      indicative_price_basis text,
      indicative_price_source_url text,
      indicative_price_updated_at timestamptz
    );

    create table public.dawanear_products (
      id text primary key,
      registration_number text,
      brand_name text,
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text,
      category text,
      prescription_status text,
      regulatory_status text,
      manufacturer text,
      manufacturer_country text,
      expiry_date date,
      is_orderable boolean,
      is_active boolean,
      source_name text,
      source_url text,
      indicative_price_rwf numeric,
      indicative_price_basis text,
      indicative_price_source_url text,
      indicative_price_updated_at timestamptz,
      description text,
      description_source_name text,
      description_source_url text,
      description_approved boolean,
      image_url text,
      image_source text,
      updated_at timestamptz not null default now()
    );

    create table public.dawanear_marketplace_products (
      id text primary key references public.dawanear_products(id),
      registration_number text,
      product_name text,
      generic_name text,
      strength text,
      dosage_form text,
      pack_size text,
      product_type text,
      category text,
      subcategory text,
      manufacturer text,
      manufacturer_country text,
      expiry_date date,
      image_url text,
      image_source text,
      is_orderable boolean not null default true,
      publication_status text not null default 'approved',
      is_active boolean not null default true,
      updated_at timestamptz not null default now()
    );

    create table public.dawanear_product_images (
      product_id text not null,
      approved boolean not null default false,
      checked_at timestamptz
    );

    grant select on public.dawanear_products to anon, authenticated;
    grant select on public.dawanear_offer_items to authenticated;
    grant select on public.dawanear_offers, public.dawanear_orders,
      public.dawanear_pharmacy_memberships to authenticated;

    create function public.dawanear_backend_contract()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      select jsonb_build_object(
        'contract_version', '2026-07-18.3',
        'api_surface', jsonb_build_object(
          'function_count', 32,
          'expected_function_count', 31,
          'public_execute_count', 0,
          'anonymous_security_definer_count', 1,
          'mutable_security_definer_path_count', 0
        )
      )
    $$;
    grant execute on function public.dawanear_backend_contract() to service_role;

    insert into public.dawanear_pharmacies(id, name)
    values
      ('${pharmacyA}', 'Pharmacy A'),
      ('${pharmacyB}', 'Pharmacy B');

    insert into public.dawanear_pharmacy_contacts(
      pharmacy_id, contact_type, e164, is_login_enabled, verification_status,
      verified_at, verified_by, source_type, updated_at
    )
    values
      (
        '${pharmacyA}', 'whatsapp', '${loginPhone}', true, 'admin_verified',
        now() - interval '1 day', '${userA}', 'admin', now() - interval '1 day'
      ),
      (
        '${pharmacyB}', 'whatsapp', '${loginPhone}', true, 'source_verified',
        now() - interval '2 days', '${userB}', 'pharmacy_submission', now() - interval '2 days'
      ),
      (
        '${pharmacyB}', 'whatsapp', '250788888889', true, 'source_verified',
        now(), null, 'duty_roster', now()
      );

    insert into public.dawanear_products(id, image_url, image_source)
    values ('rwanda-fda-hm-1594', 'https://example.test/wrong.webp', 'legacy');

    insert into public.dawanear_marketplace_products(
      id, product_name, category, image_url, image_source
    )
    values (
      'rwanda-fda-hm-1594', 'Paracetamol suppository', 'Medicines',
      'https://example.test/wrong.webp', 'legacy'
    );

    insert into public.dawanear_product_images(product_id, approved, checked_at)
    values ('rwanda-fda-hm-1594', true, now());
  `);

  await db.exec(migration);
  return db;
}

test("applies the go-live hardening migration and reconciles unsafe authority", async () => {
  const db = await database();

  const contacts = await db.query(`
    select pharmacy_id, e164, is_login_enabled
    from public.dawanear_pharmacy_contacts
    order by e164, pharmacy_id
  `);
  assert.deepEqual(
    contacts.rows.map((row) => [row.pharmacy_id, row.e164, row.is_login_enabled]),
    [
      [pharmacyA, loginPhone, true],
      [pharmacyB, loginPhone, false],
      [pharmacyB, "250788888889", false],
    ],
  );

  const heldImage = await db.query(`
    select
      product.image_url as product_image,
      marketplace.image_url as marketplace_image,
      count(*) filter (where image.approved) as approved_images
    from public.dawanear_products as product
    join public.dawanear_marketplace_products as marketplace using (id)
    join public.dawanear_product_images as image on image.product_id = product.id
    where product.id = 'rwanda-fda-hm-1594'
    group by product.image_url, marketplace.image_url
  `);
  assert.equal(heldImage.rows[0].product_image, null);
  assert.equal(heldImage.rows[0].marketplace_image, null);
  assert.equal(heldImage.rows[0].approved_images, 0);

  await db.close();
});

test("binds one named-review phone to one tenant and fails closed on revoked authority", async () => {
  const db = await database();

  const binding = await db.query(
    "select * from public.dawanear_bind_pharmacy_identity($1, $2)",
    [loginPhone, userA],
  );
  assert.equal(binding.rows[0].bound_pharmacy_id, pharmacyA);

  const membership = await db.query(`
    select pharmacy_id, role, status
    from public.dawanear_pharmacy_memberships
    where user_id = $1
  `, [userA]);
  assert.deepEqual(membership.rows, [{ pharmacy_id: pharmacyA, role: "manager", status: "active" }]);

  await assert.rejects(
    db.query("select * from public.dawanear_bind_pharmacy_identity($1, $2)", [loginPhone, userB]),
    /already bound to another identity/i,
  );

  await db.query(`
    update public.dawanear_pharmacy_contacts
    set is_login_enabled = false
    where pharmacy_id = $1 and e164 = $2
  `, [pharmacyA, loginPhone]);
  await assert.rejects(
    db.query("select * from public.dawanear_bind_pharmacy_identity($1, $2)", [loginPhone, userA]),
    /no current named-review portal authority/i,
  );

  const suspended = await db.query(`
    select status
    from public.dawanear_pharmacy_memberships
    where pharmacy_id = $1 and user_id = $2
  `, [pharmacyA, userA]);
  assert.equal(suspended.rows[0].status, "suspended");

  await db.close();
});

test("enforces participant-bound offer-item reads", async () => {
  const db = await database();
  const order = "00000000-0000-0000-0000-000000000030";
  const offer = "00000000-0000-0000-0000-000000000031";

  await db.query("insert into public.dawanear_orders(id,user_id) values ($1,$2)", [order, userA]);
  await db.query(
    "insert into public.dawanear_offers(id,order_id,pharmacy_id) values ($1,$2,$3)",
    [offer, order, pharmacyA],
  );
  await db.query("insert into public.dawanear_offer_items(offer_id) values ($1)", [offer]);

  await db.exec(`set role authenticated; set request.jwt.claims = '{"is_anonymous":false}';`);
  await db.exec(`set request.jwt.claim.sub = '${userA}'`);
  assert.equal((await db.query("select count(*) from public.dawanear_offer_items")).rows[0].count, 1);

  await db.exec(`set request.jwt.claim.sub = '${userB}'`);
  assert.equal((await db.query("select count(*) from public.dawanear_offer_items")).rows[0].count, 0);

  await db.exec("reset role");
  await db.close();
});

test("removes public draft-description grants and reports the hardened contract", async () => {
  const db = await database();

  const privileges = await db.query(`
    select
      pg_catalog.has_column_privilege(
        'anon', 'public.dawanear_products', 'description', 'select'
      ) as anon_description,
      pg_catalog.has_column_privilege(
        'authenticated', 'public.dawanear_products', 'description_approved', 'select'
      ) as authenticated_approval,
      pg_catalog.has_function_privilege(
        'service_role', 'public.dawanear_bind_pharmacy_identity(text,uuid)', 'execute'
      ) as service_binding,
      pg_catalog.has_function_privilege(
        'authenticated', 'public.dawanear_bind_pharmacy_identity(text,uuid)', 'execute'
      ) as authenticated_binding
  `);
  assert.deepEqual(privileges.rows[0], {
    anon_description: false,
    authenticated_approval: false,
    service_binding: true,
    authenticated_binding: false,
  });

  const contract = (await db.query("select public.dawanear_backend_contract() as contract")).rows[0].contract;
  assert.equal(contract.contract_version, "2026-07-23.1");
  assert.equal(contract.api_surface.expected_function_count, 32);
  assert.equal(contract.pharmacy_identity_binding.duplicate_enabled_phone_count, 0);
  assert.equal(contract.pharmacy_identity_binding.enabled_without_named_review_count, 0);
  assert.equal(contract.go_live_hardening.offer_item_policy_binds_participants, true);
  assert.equal(contract.go_live_hardening.public_description_base_grant_exists, false);
  assert.equal(contract.go_live_hardening.mismatched_image_published_count, 0);

  await db.close();
});
