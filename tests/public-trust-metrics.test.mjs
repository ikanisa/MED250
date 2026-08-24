import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, beforeEach } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { __test } from "../lib/public-trust-metrics.ts";

const database = new PGlite();
await database.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema dawanear_private;

  create table public.dawanear_pharmacies (
    id uuid primary key,
    is_active boolean not null default true,
    marketplace_approved boolean not null default true,
    license_expires_on date,
    geocode_status text not null default 'pending',
    location text
  );
  create table public.dawanear_pharmacy_contacts (
    pharmacy_id uuid not null,
    contact_type text not null,
    verification_status text not null,
    is_login_enabled boolean not null default false
  );
  create table public.dawanear_orders (
    id uuid primary key,
    status text not null,
    created_at timestamptz not null default now(),
    broadcast_at timestamptz,
    expires_at timestamptz not null
  );
  create table public.dawanear_order_recipients (
    order_id uuid not null,
    pharmacy_id uuid not null
  );
  create table public.dawanear_offers (
    order_id uuid not null,
    complete boolean not null default false,
    status text not null,
    submitted_at timestamptz not null default now()
  );

  create function dawanear_private.dawanear_pharmacy_is_dispatch_eligible(p_pharmacy_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
  as $$
    select exists (
      select 1
      from public.dawanear_pharmacies as pharmacy
      where pharmacy.id = p_pharmacy_id
        and pharmacy.is_active
        and pharmacy.marketplace_approved
        and pharmacy.license_expires_on >= current_date
        and exists (
          select 1
          from public.dawanear_pharmacy_contacts as contact
          where contact.pharmacy_id = pharmacy.id
            and contact.contact_type = 'whatsapp'
            and contact.is_login_enabled
            and contact.verification_status in ('source_verified', 'admin_verified')
        )
    );
  $$;

  create function public.dawanear_backend_contract()
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'contract_version', 'fixture-base',
      'api_surface', jsonb_build_object(
        'function_count', 30,
        'expected_function_count', 29,
        'anonymous_security_definer_count', 1,
        'expected_authenticated_security_definer_count', 13,
        'unexpected_authenticated_security_definer_count', 1
      ),
      'table_surface', jsonb_build_object(
        'table_count', 23,
        'expected_table_count', 22,
        'expected_deny_by_default_count', 9,
        'unexpected_deny_by_default_count', 1
      )
    );
  $$;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20260718083000_public_trust_metrics.sql", import.meta.url),
  "utf8",
);
await database.exec(migration);

beforeEach(async () => {
  await database.exec(`
    truncate table
      public.dawanear_public_metric_approvals,
      public.dawanear_offers,
      public.dawanear_order_recipients,
      public.dawanear_orders,
      public.dawanear_pharmacy_contacts,
      public.dawanear_pharmacies;

    insert into public.dawanear_pharmacies (
      id, is_active, marketplace_approved, license_expires_on, geocode_status, location
    ) values
      ('11111111-1111-4111-8111-111111111111', true, true, current_date + 30, 'verified', 'approved-nearby-point'),
      ('22222222-2222-4222-8222-222222222222', true, true, current_date + 30, 'pending', null),
      ('33333333-3333-4333-8333-333333333333', false, true, current_date + 30, 'verified', 'inactive-point');

    insert into public.dawanear_pharmacy_contacts (
      pharmacy_id, contact_type, verification_status, is_login_enabled
    ) values
      ('11111111-1111-4111-8111-111111111111', 'whatsapp', 'source_verified', true),
      ('22222222-2222-4222-8222-222222222222', 'whatsapp', 'admin_verified', true),
      ('33333333-3333-4333-8333-333333333333', 'whatsapp', 'admin_verified', true);
  `);
});

after(async () => database.close());

async function health() {
  const result = await database.query("select public.dawanear_public_trust_metrics() as metrics");
  return result.rows[0].metrics;
}

async function approve(metricKey) {
  await database.query(`
    insert into public.dawanear_public_metric_approvals (
      metric_key, approved, reviewed_by, evidence_reference, approved_at, expires_at
    ) values ($1, true, 'Marketplace operations', 'docs/audit/service-signal-review.md', now() - interval '1 hour', now() + interval '30 days')
  `, [metricKey]);
}

async function insertResponses({ count = 30, startDaysAgo = 1, sameDay = false, responseMinutes = 7 } = {}) {
  await database.query(`
    with observations as (
      select
        series,
        ('40000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as order_id,
        now() - make_interval(days => case when $2 then $3 else $3 + series - 1 end) as broadcast_at
      from generate_series(1, $1::integer) as series
    ), inserted_orders as (
      insert into public.dawanear_orders (id, status, created_at, broadcast_at, expires_at)
      select order_id, 'completed', broadcast_at, broadcast_at, broadcast_at + interval '2 hours'
      from observations
      returning id, broadcast_at
    ), inserted_recipients as (
      insert into public.dawanear_order_recipients (order_id, pharmacy_id)
      select id, '11111111-1111-4111-8111-111111111111'
      from inserted_orders
      returning order_id
    )
    insert into public.dawanear_offers (order_id, complete, status, submitted_at)
    select id, true, 'selected', broadcast_at + make_interval(mins => $4)
    from inserted_orders
  `, [count, sameDay, startDaysAgo, responseMinutes]);
}

test("publishes nothing before an explicit, current approval", async () => {
  const metrics = await health();

  assert.equal(metrics.ready_pharmacy_count.value, null);
  assert.equal(metrics.ready_pharmacy_count.sample_size, null);
  assert.equal(metrics.ready_pharmacy_count.suppressed_reason, "approval_required");
  assert.equal(metrics.typical_response_minutes.value, null);
  assert.equal(metrics.typical_response_minutes.sample_size, null);
  assert.equal(metrics.typical_response_minutes.suppressed_reason, "approval_required");
  assert.deepEqual(metrics.privacy, {
    aggregate_only: true,
    contains_pharmacy_identity: false,
    contains_customer_or_health_data: false,
    suppressed_sample_counts_hidden: true,
  });
});

test("counts both governed nearby and national responders without exposing either", async () => {
  await approve("ready_pharmacy_count");
  const metrics = await health();

  assert.equal(metrics.ready_pharmacy_count.value, 2);
  assert.equal(metrics.ready_pharmacy_count.sample_size, 2);
  assert.equal(metrics.ready_pharmacy_count.suppressed_reason, null);
  const serialized = JSON.stringify(metrics);
  assert.doesNotMatch(serialized, /11111111|22222222|approved-nearby-point/);
});

test("suppresses zero eligible pharmacies and hides the zero sample", async () => {
  await approve("ready_pharmacy_count");
  await database.exec("delete from public.dawanear_pharmacy_contacts;");
  const metrics = await health();

  assert.equal(metrics.ready_pharmacy_count.value, null);
  assert.equal(metrics.ready_pharmacy_count.sample_size, null);
  assert.equal(metrics.ready_pharmacy_count.suppressed_reason, "no_eligible_pharmacies");
});

test("suppresses an approved response metric below the minimum sample", async () => {
  await approve("typical_response_time");
  await insertResponses({ count: 29 });
  const metrics = await health();

  assert.equal(metrics.typical_response_minutes.value, null);
  assert.equal(metrics.typical_response_minutes.sample_size, null);
  assert.equal(metrics.typical_response_minutes.suppressed_reason, "insufficient_sample");
});

test("suppresses burst data that does not cover three observation days", async () => {
  await approve("typical_response_time");
  await insertResponses({ count: 30, sameDay: true });
  const metrics = await health();

  assert.equal(metrics.typical_response_minutes.value, null);
  assert.equal(metrics.typical_response_minutes.suppressed_reason, "insufficient_day_spread");
});

test("suppresses a statistically sufficient but stale response sample", async () => {
  await approve("typical_response_time");
  await insertResponses({ count: 30, startDaysAgo: 20 });
  const metrics = await health();

  assert.equal(metrics.typical_response_minutes.value, null);
  assert.equal(metrics.typical_response_minutes.sample_size, null);
  assert.equal(metrics.typical_response_minutes.suppressed_reason, "stale");
});

test("publishes a rounded p50 only for an approved, sufficient, fresh sample", async () => {
  await approve("typical_response_time");
  await insertResponses({ count: 30, startDaysAgo: 1, responseMinutes: 7 });
  const metrics = await health();

  assert.equal(metrics.typical_response_minutes.value, 7);
  assert.equal(metrics.typical_response_minutes.percentile, "p50");
  assert.equal(metrics.typical_response_minutes.sample_size, 30);
  assert.equal(metrics.typical_response_minutes.window_days, 90);
  assert.equal(metrics.typical_response_minutes.max_staleness_days, 14);
  assert.equal(metrics.typical_response_minutes.suppressed_reason, null);
});

test("grants only the aggregate RPC to public roles and keeps approvals service-only", async () => {
  const result = await database.query(`
    select
      has_function_privilege('anon', 'public.dawanear_public_trust_metrics()', 'execute') as anon_rpc,
      has_function_privilege('authenticated', 'public.dawanear_public_trust_metrics()', 'execute') as authenticated_rpc,
      has_table_privilege('anon', 'public.dawanear_public_metric_approvals', 'select') as anon_approvals,
      has_table_privilege('authenticated', 'public.dawanear_public_metric_approvals', 'select') as authenticated_approvals,
      has_table_privilege('service_role', 'public.dawanear_public_metric_approvals', 'select') as service_approvals
  `);
  assert.deepEqual(result.rows[0], {
    anon_rpc: true,
    authenticated_rpc: true,
    anon_approvals: false,
    authenticated_approvals: false,
    service_approvals: true,
  });
});

test("extends the release contract with exactly the governed public-metric exception", async () => {
  const result = await database.query("select public.dawanear_backend_contract() as contract");
  const contract = result.rows[0].contract;

  assert.equal(contract.contract_version, "2026-07-18.1");
  assert.equal(contract.trust_metrics.function_exists, true);
  assert.equal(contract.trust_metrics.security_definer, true);
  assert.equal(contract.trust_metrics.stable, true);
  assert.equal(contract.trust_metrics.search_path_locked, true);
  assert.equal(contract.trust_metrics.public_can_execute, false);
  assert.equal(contract.trust_metrics.anon_can_execute, true);
  assert.equal(contract.trust_metrics.approval_table_rls, true);
  assert.equal(contract.trust_metrics.approval_table_deny_by_default, true);
  assert.equal(contract.trust_metrics.anon_can_read_approvals, false);
  assert.equal(contract.trust_metrics.service_role_can_read_approvals, true);
  assert.equal(contract.trust_metrics.approval_rows_with_incomplete_evidence, 0);
  assert.equal(contract.api_surface.expected_function_count, 30);
  assert.equal(contract.api_surface.expected_authenticated_security_definer_count, 14);
  assert.equal(contract.api_surface.unexpected_authenticated_security_definer_count, 0);
  assert.equal(contract.table_surface.expected_table_count, 23);
  assert.equal(contract.table_surface.expected_deny_by_default_count, 10);
  assert.equal(contract.table_surface.unexpected_deny_by_default_count, 0);
});

test("the storefront parser rejects suppressed and non-private payloads", () => {
  const safeSuppressed = {
    schema_version: 1,
    generated_at: "2026-07-18T10:00:00Z",
    ready_pharmacy_count: { value: null, sample_size: null },
    typical_response_minutes: { value: null, sample_size: null },
    privacy: {
      aggregate_only: true,
      contains_pharmacy_identity: false,
      contains_customer_or_health_data: false,
    },
  };
  const parsed = __test.parsePublicTrustMetrics(safeSuppressed);
  assert.deepEqual(parsed?.readyPharmacyCount, null);
  assert.deepEqual(parsed?.typicalResponse, null);
  assert.equal(__test.parsePublicTrustMetrics({ ...safeSuppressed, privacy: { aggregate_only: false } }), null);
});

test("the storefront parser accepts only complete published metric evidence", () => {
  const parsed = __test.parsePublicTrustMetrics({
    schema_version: 1,
    generated_at: "2026-07-18T10:00:00Z",
    ready_pharmacy_count: {
      value: 12,
      sample_size: 12,
      source: "governed_dispatch_eligibility",
      measurement_type: "current_population",
      as_of: "2026-07-18T10:00:00Z",
    },
    typical_response_minutes: {
      value: 7,
      sample_size: 30,
      source: "completed_first_confirmations",
      percentile: "p50",
      window_days: 90,
      latest_observation_at: "2026-07-17T10:00:00Z",
      max_staleness_days: 14,
    },
    privacy: {
      aggregate_only: true,
      contains_pharmacy_identity: false,
      contains_customer_or_health_data: false,
    },
  });

  assert.equal(parsed?.readyPharmacyCount?.value, 12);
  assert.equal(parsed?.typicalResponse?.valueMinutes, 7);
  assert.equal(parsed?.typicalResponse?.sampleSize, 30);
});

test("the homepage keeps approved metrics optional and labels their evidence", async () => {
  const [page, marketplace, runtimeCatalogJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/marketplace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/localization/runtime-messages.en-RW.json", import.meta.url), "utf8"),
  ]);
  const runtimeMessages = JSON.parse(runtimeCatalogJson).messages;

  assert.match(page, /getPublicTrustMetrics/);
  assert.match(page, /initialTrustMetrics=\{initialTrustMetrics\}/);
  assert.match(marketplace, /initialTrustMetrics\?\.readyPharmacyCount \|\| initialTrustMetrics\?\.typicalResponse/);
  assert.equal(runtimeMessages["inventory.b6e45056d7d3"], "All {0} pharmacies in the governed dispatch-eligibility snapshot · checked {1}");
  assert.equal(runtimeMessages["inventory.a0c2f3048f79"], "Median of {0} complete first confirmations in the last {1} days · latest {2}");
  assert.match(marketplace, /marketplaceFormatMessage\("inventory\.b6e45056d7d3"/);
  assert.match(marketplace, /marketplaceFormatMessage\("inventory\.a0c2f3048f79"/);
  assert.doesNotMatch(marketplace, /pharmacy rating|in stock|guaranteed response/i);
});
