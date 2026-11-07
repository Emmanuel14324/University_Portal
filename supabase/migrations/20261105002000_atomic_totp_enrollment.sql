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
  if _verified_step < 0
    or _recovery_code_hashes is null
    or pg_catalog.cardinality(_recovery_code_hashes) <> 10
    or exists (
      select 1
      from pg_catalog.unnest(_recovery_code_hashes) as recovery_hash
      where recovery_hash !~ '^[0-9a-f]{64}$'
    )
    or _totp_marker_hash !~ '^[0-9a-f]{64}$'
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
    v_now + interval '5 minutes',
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
    v_now + interval '5 minutes'
  );

  return true;
end;
$$;

revoke all on function public.complete_totp_enrollment(uuid, bigint, text[], text, text)
  from public, anon, authenticated;
grant execute on function public.complete_totp_enrollment(uuid, bigint, text[], text, text)
  to service_role;

notify pgrst, 'reload schema';
