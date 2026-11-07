create or replace function public.complete_webauthn_authentication(
  _challenge_id uuid,
  _completion_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_webauthn public.authentication_challenges%rowtype;
  v_password_verified_at timestamptz;
  v_totp_verified_at timestamptz;
  v_webauthn_count bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if _completion_token_hash is null
    or _completion_token_hash !~ '^[0-9a-f]{64}$'
  then
    return false;
  end if;

  select challenge.*
  into v_webauthn
  from public.authentication_challenges as challenge
  where challenge.id = _challenge_id
    and challenge.factor in (
      'WEBAUTHN_REGISTRATION',
      'WEBAUTHN_AUTHENTICATION'
    )
    and challenge.consumed_at is null
    and challenge.expires_at > v_now
    and challenge.user_id is not null
  for update;
  if not found then
    return false;
  end if;

  update public.authentication_challenges
  set consumed_at = v_now,
      verified_at = v_now
  where id = v_webauthn.id
    and consumed_at is null;
  if not found then
    return false;
  end if;

  select challenge.verified_at
  into v_password_verified_at
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_webauthn.auth_transaction_id
    and challenge.user_id = v_webauthn.user_id
    and challenge.factor = 'PASSWORD_TRANSACTION'
    and challenge.verified_at is not null
    and challenge.consumed_at is not null
    and challenge.expires_at > v_now;

  select challenge.verified_at
  into v_totp_verified_at
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_webauthn.auth_transaction_id
    and challenge.user_id = v_webauthn.user_id
    and challenge.factor = 'TOTP'
    and challenge.verified_at is not null
    and challenge.consumed_at is not null
    and challenge.expires_at > v_now;

  select pg_catalog.count(*)
  into v_webauthn_count
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_webauthn.auth_transaction_id
    and challenge.user_id = v_webauthn.user_id
    and challenge.factor in (
      'WEBAUTHN_REGISTRATION',
      'WEBAUTHN_AUTHENTICATION'
    )
    and challenge.verified_at is not null
    and challenge.consumed_at is not null
    and challenge.expires_at > v_now;

  if v_password_verified_at is null
    or v_totp_verified_at is null
    or v_webauthn_count <> 1
    or v_password_verified_at > v_totp_verified_at
    or v_totp_verified_at > v_now
  then
    raise exception 'Authentication factors are incomplete or out of order';
  end if;

  insert into public.authentication_challenges (
    auth_transaction_id,
    user_id,
    factor,
    challenge_hash,
    expires_at,
    verified_at
  )
  values (
    v_webauthn.auth_transaction_id,
    v_webauthn.user_id,
    'AUTHENTICATION_COMPLETE',
    _completion_token_hash,
    v_webauthn.expires_at,
    v_now
  );

  return true;
end;
$$;

revoke all on function public.complete_webauthn_authentication(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_webauthn_authentication(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
