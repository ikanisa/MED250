-- MED+250 pharmacy OTP database contract UAT.
--
-- This deliberately does not invoke WhatsApp or create an Auth session. It
-- verifies the deployed, service-only OTP state machine in one transaction and
-- rolls every challenge back. Use the separate controlled physical-device UAT
-- for Cloud API delivery and browser session handoff.

begin;

do $med250_pharmacy_otp_rollback_uat$
declare
  v_phone text := '250788000011';
  v_valid_id uuid := gen_random_uuid();
  v_retry_id uuid := gen_random_uuid();
  v_expired_id uuid := gen_random_uuid();
  v_valid_hash text := repeat('a', 64);
  v_second_hash text := repeat('b', 64);
  v_wrong_hash text := repeat('c', 64);
  v_source_hash text := repeat('d', 64);
  v_accepted boolean;
  v_reason text;
  v_attempts integer;
  v_used_at timestamptz;
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.dawanear_consume_pharmacy_otp(uuid,text,text)',
    'execute'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.dawanear_consume_pharmacy_otp(uuid,text,text)',
    'execute'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.dawanear_consume_pharmacy_otp(uuid,text,text)',
    'execute'
  ) then
    raise exception 'OTP consumption must be executable only by service_role';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.dawanear_pharmacy_otp_challenges', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.dawanear_pharmacy_otp_challenges', 'select') then
    raise exception 'OTP challenge rows are visible to a browser role';
  end if;

  insert into public.dawanear_pharmacy_otp_challenges (
    id, phone, code_hash, source_hash, delivery_status, expires_at
  ) values (
    v_valid_id, v_phone, v_valid_hash, v_source_hash, 'sent', now() + interval '5 minutes'
  );

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(v_valid_id, v_phone, v_valid_hash) as consumed;

  if not v_accepted or v_reason <> 'accepted' then
    raise exception 'Correct pharmacy OTP was not accepted';
  end if;

  select challenge.attempts, challenge.used_at
    into v_attempts, v_used_at
  from public.dawanear_pharmacy_otp_challenges as challenge
  where challenge.id = v_valid_id;

  if v_attempts <> 1 or v_used_at is null then
    raise exception 'Accepted OTP was not consumed atomically';
  end if;

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(v_valid_id, v_phone, v_valid_hash) as consumed;

  if v_accepted or v_reason <> 'invalid' then
    raise exception 'Consumed OTP could be replayed';
  end if;

  insert into public.dawanear_pharmacy_otp_challenges (
    id, phone, code_hash, source_hash, delivery_status, expires_at
  ) values (
    v_retry_id, v_phone, v_second_hash, v_source_hash, 'sent', now() + interval '5 minutes'
  );

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(v_retry_id, v_phone, v_wrong_hash) as consumed;

  if v_accepted or v_reason <> 'invalid' then
    raise exception 'Incorrect OTP was accepted';
  end if;

  select challenge.attempts, challenge.used_at
    into v_attempts, v_used_at
  from public.dawanear_pharmacy_otp_challenges as challenge
  where challenge.id = v_retry_id;

  if v_attempts <> 1 or v_used_at is not null then
    raise exception 'Incorrect OTP did not preserve a retry correctly';
  end if;

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(v_retry_id, v_phone, v_second_hash) as consumed;

  if not v_accepted or v_reason <> 'accepted' then
    raise exception 'Correct retry OTP was not accepted';
  end if;

  insert into public.dawanear_pharmacy_otp_challenges (
    id, phone, code_hash, source_hash, delivery_status,
    created_at, expires_at
  ) values (
    v_expired_id, v_phone, v_valid_hash, v_source_hash, 'sent',
    now() - interval '6 minutes', now() - interval '1 minute'
  );

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(v_expired_id, v_phone, v_valid_hash) as consumed;

  if v_accepted or v_reason <> 'expired' then
    raise exception 'Expired OTP did not return the expired state';
  end if;

  select challenge.used_at
    into v_used_at
  from public.dawanear_pharmacy_otp_challenges as challenge
  where challenge.id = v_expired_id;

  if v_used_at is null then
    raise exception 'Expired OTP was not retired';
  end if;

  select consumed.accepted, consumed.reason
    into v_accepted, v_reason
  from public.dawanear_consume_pharmacy_otp(
    v_expired_id,
    'not-a-rwanda-phone',
    'not-a-hash'
  ) as consumed;

  if v_accepted or v_reason <> 'invalid' then
    raise exception 'Malformed OTP input was not rejected';
  end if;
end;
$med250_pharmacy_otp_rollback_uat$;

rollback;

select jsonb_build_object(
  'status', 'passed',
  'persistence', 'rolled_back',
  'workflow', array[
    'service_only_access', 'correct_code', 'single_use',
    'wrong_code_retry', 'expired_code', 'malformed_input'
  ]
) as med250_pharmacy_otp_rollback_uat;
