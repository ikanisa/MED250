import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260729150000_materialize_backend_contract_layers.sql",
    import.meta.url,
  ),
  "utf8",
);

test("materializes every nested backend-contract predecessor exactly once", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema dawanear_private;

    create function dawanear_private.dawanear_backend_contract_v19()
    returns jsonb language sql stable security definer set search_path = ''
    as $$ select '{"contract_version":"v19","value":1}'::jsonb $$;

    create function dawanear_private.dawanear_backend_contract_v20()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      with base as (
        select dawanear_private.dawanear_backend_contract_v19() as contract
      )
      select base.contract || jsonb_build_object('contract_version', 'v20')
      from base
    $$;

    create function dawanear_private.dawanear_backend_contract_v21()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      with base as (
        select dawanear_private.dawanear_backend_contract_v20() as contract
      )
      select base.contract || jsonb_build_object('contract_version', 'v21')
      from base
    $$;

    create function dawanear_private.dawanear_backend_contract_v22()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      with base as (
        select dawanear_private.dawanear_backend_contract_v21() as contract
      )
      select base.contract || jsonb_build_object('contract_version', 'v22')
      from base
    $$;

    create function public.dawanear_backend_contract()
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      with base as (
        select dawanear_private.dawanear_backend_contract_v22() as contract
      )
      select base.contract || jsonb_build_object('contract_version', 'public')
      from base
    $$;
  `);

  await db.exec(migration);

  const definitions = await db.query(`
    select pg_catalog.pg_get_functiondef(function.oid) as definition
    from pg_catalog.pg_proc as function
    join pg_catalog.pg_namespace as namespace on namespace.oid = function.pronamespace
    where (namespace.nspname, function.proname) in (
      ('dawanear_private', 'dawanear_backend_contract_v20'),
      ('dawanear_private', 'dawanear_backend_contract_v21'),
      ('dawanear_private', 'dawanear_backend_contract_v22'),
      ('public', 'dawanear_backend_contract')
    )
    order by namespace.nspname, function.proname
  `);
  assert.equal(definitions.rows.length, 4);
  assert.ok(definitions.rows.every(({ definition }) => (
    /WITH base AS MATERIALIZED \(/i.test(definition)
  )));

  const result = await db.query(
    "select public.dawanear_backend_contract() as contract",
  );
  assert.equal(result.rows[0].contract.contract_version, "public");
  await db.close();
});
