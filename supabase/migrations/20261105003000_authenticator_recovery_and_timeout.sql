create or replace function public.complete_totp_enrollment(
  _password_challenge_id uuid,
  _verified_step bigint,
  _recovery_code_hashes text[],
  _totp_marker_hash text,
  _webauthn_transaction_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password public.authentication_challenges%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if _verified_step is null
    or _verified_step < 0
    or _recovery_code_hashes is null
    or pg_catalog.cardinality(_recovery_code_hashes) <> 10
    or exists (
      select 1
      from pg_catalog.unnest(_recovery_code_hashes) as recovery_hash(value)
      where value !~ '^[0-9a-f]{64}$'
    )
    or _totp_marker_hash is null
    or _totp_marker_hash !~ '^[0-9a-f]{64}$'
    or _webauthn_transaction_hash is null
    or _webauthn_transaction_hash !~ '^[0-9a-f]{64}$'
  then
    return false;
  end if;

  select challenge.*
  into v_password
  from public.authentication_challenges as challenge
  where challenge.id = _password_challenge_id
    and challenge.factor = 'PASSWORD_TRANSACTION'
    and challenge.consumed_at is null
    and challenge.expires_at > v_now
    and challenge.verified_at is not null
    and challenge.failed_attempts < 5
  for update;
  if not found then
    return false;
  end if;

  update public.totp_credentials as credential
  set is_enabled = true,
      enabled_at = v_now,
      last_verified_step = _verified_step,
      recovery_code_hashes = _recovery_code_hashes,
      enrollment_expires_at = null
  where credential.user_id = v_password.user_id
    and credential.is_enabled = false
    and credential.enrollment_expires_at > v_now;
  if not found then
    return false;
  end if;

  update public.authentication_challenges
  set consumed_at = v_now
  where id = v_password.id
    and consumed_at is null;
  if not found then
    return false;
  end if;

  insert into public.authentication_challenges (
    auth_transaction_id,
    user_id,
    factor,
    challenge_hash,
    expires_at,
    consumed_at,
    verified_at
  )
  values (
    v_password.auth_transaction_id,
    v_password.user_id,
    'TOTP',
    _totp_marker_hash,
    v_password.expires_at,
    v_now,
    v_now
  );

  insert into public.authentication_challenges (
    auth_transaction_id,
    user_id,
    factor,
    challenge_hash,
    expires_at
  )
  values (
    v_password.auth_transaction_id,
    v_password.user_id,
    'WEBAUTHN_REGISTRATION',
    _webauthn_transaction_hash,
    v_password.expires_at
  );

  return true;
end;
$$;

create or replace function public.consume_totp_recovery_code(
  _challenge_id uuid,
  _code_hash text,
  _next_transaction_hash text
)
returns table (outcome text, next_factor text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.authentication_challenges%rowtype;
  v_factor text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if _code_hash is null
    or _code_hash !~ '^[0-9a-f]{64}$'
    or _next_transaction_hash is null
    or _next_transaction_hash !~ '^[0-9a-f]{64}$'
  then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select challenge.*
  into v_challenge
  from public.authentication_challenges as challenge
  where challenge.id = _challenge_id
    and challenge.factor = 'TOTP'
    and challenge.consumed_at is null
    and challenge.expires_at > v_now
  for update;
  if not found then
    return query select 'expired'::text, null::text;
    return;
  end if;

  if v_challenge.failed_attempts >= 5 then
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

  update public.totp_credentials as credential
  set recovery_code_hashes = array_remove(credential.recovery_code_hashes, _code_hash)
  where credential.user_id = v_challenge.user_id
    and credential.is_enabled
    and _code_hash = any(credential.recovery_code_hashes);

  if not found then
    update public.authentication_challenges
    set failed_attempts = failed_attempts + 1
    where id = v_challenge.id
      and failed_attempts = v_challenge.failed_attempts
      and consumed_at is null;
    if v_challenge.failed_attempts + 1 >= 5 then
      return query select 'rate_limited'::text, null::text;
    else
      return query select 'invalid'::text, null::text;
    end if;
    return;
  end if;

  if exists (
    select 1
    from public.webauthn_credentials as credential
    where credential.user_id = v_challenge.user_id
  ) then
    v_factor := 'WEBAUTHN_AUTHENTICATION';
  else
    v_factor := 'WEBAUTHN_REGISTRATION';
  end if;

  update public.authentication_challenges
  set consumed_at = v_now,
      verified_at = v_now
  where id = v_challenge.id
    and consumed_at is null;
  if not found then
    raise exception 'TOTP recovery transaction was concurrently consumed';
  end if;

  insert into public.authentication_challenges (
    auth_transaction_id,
    user_id,
    factor,
    challenge_hash,
    expires_at
  )
  values (
    v_challenge.auth_transaction_id,
    v_challenge.user_id,
    v_factor::public.challenge_factor,
    _next_transaction_hash,
    v_challenge.expires_at
  );

  insert into public.security_audit_logs (
    actor_user_id,
    subject_user_id,
    action,
    entity_type,
    details
  )
  values (
    v_challenge.user_id,
    v_challenge.user_id,
    'TOTP_RECOVERY_CODE_USED',
    'totp_credential',
    pg_catalog.jsonb_build_object('remaining_recovery_codes',
      (select pg_catalog.cardinality(recovery_code_hashes)
       from public.totp_credentials
       where user_id = v_challenge.user_id))
  );

  return query select 'verified'::text, v_factor;
end;
$$;

revoke all on function public.consume_totp_recovery_code(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_totp_recovery_code(uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
