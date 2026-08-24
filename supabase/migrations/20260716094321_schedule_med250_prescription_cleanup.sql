-- Keep the prescription-retention worker observable and continuously active
-- without placing its dedicated authentication token in cron.job.

create or replace function dawanear_private.dawanear_invoke_prescription_cleanup()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_endpoint text;
  v_cron_token text;
  v_request_id bigint;
begin
  select secret.decrypted_secret
  into v_endpoint
  from vault.decrypted_secrets as secret
  where secret.name = 'med250_cleanup_prescriptions_url'
  order by secret.updated_at desc
  limit 1;

  select secret.decrypted_secret
  into v_cron_token
  from vault.decrypted_secrets as secret
  where secret.name = 'med250_cleanup_prescriptions_token'
  order by secret.updated_at desc
  limit 1;

  if nullif(pg_catalog.btrim(v_endpoint), '') is null
     or nullif(pg_catalog.btrim(v_cron_token), '') is null then
    raise exception 'MED+250 prescription cleanup Vault configuration is incomplete'
      using errcode = 'P0001';
  end if;

  if v_endpoint !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/cleanup-prescriptions$' then
    raise exception 'MED+250 prescription cleanup endpoint is invalid'
      using errcode = '22023';
  end if;

  select net.http_post(
    url := v_endpoint,
    body := '{"batch_limit":100}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'X-DawaNear-Cron-Token', v_cron_token
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function dawanear_private.dawanear_invoke_prescription_cleanup()
from public, anon, authenticated, service_role;

comment on function dawanear_private.dawanear_invoke_prescription_cleanup()
is 'Invokes the private MED+250 prescription-retention worker using Vault-held configuration.';

select cron.unschedule(job.jobid)
from cron.job as job
where job.jobname = 'med250-prescription-cleanup';

select cron.schedule(
  'med250-prescription-cleanup',
  '15 */6 * * *',
  'select dawanear_private.dawanear_invoke_prescription_cleanup();'
);
