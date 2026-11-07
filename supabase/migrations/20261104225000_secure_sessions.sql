create or replace function public.create_authenticated_session(
  _completion_token_hash text,
  _session_token_hash text,
  _expires_at timestamptz
)
returns table (session_id uuid, user_id uuid, role public.app_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion public.authentication_challenges%rowtype;
  v_password_verified_at timestamptz;
  v_totp_verified_at timestamptz;
  v_webauthn_verified_at timestamptz;
  v_webauthn_count bigint;
  v_role public.app_role;
  v_session_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if _completion_token_hash !~ '^[0-9a-f]{64}$'
    or _session_token_hash !~ '^[0-9a-f]{64}$'
    or _expires_at <= v_now
    or _expires_at > v_now + interval '8 hours'
  then
    return;
  end if;

  select challenge.*
  into v_completion
  from public.authentication_challenges as challenge
  where challenge.challenge_hash = _completion_token_hash
    and challenge.factor = 'AUTHENTICATION_COMPLETE'
    and challenge.consumed_at is null
    and challenge.expires_at > v_now
    and challenge.verified_at is not null
    and challenge.user_id is not null
  for update;
  if not found then
    return;
  end if;

  select challenge.verified_at
  into v_password_verified_at
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_completion.auth_transaction_id
    and challenge.user_id = v_completion.user_id
    and challenge.factor = 'PASSWORD_TRANSACTION'
    and challenge.verified_at is not null
    and challenge.consumed_at is not null;

  select challenge.verified_at
  into v_totp_verified_at
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_completion.auth_transaction_id
    and challenge.user_id = v_completion.user_id
    and challenge.factor = 'TOTP'
    and challenge.verified_at is not null
    and challenge.consumed_at is not null;

  select pg_catalog.count(*), pg_catalog.max(challenge.verified_at)
  into v_webauthn_count, v_webauthn_verified_at
  from public.authentication_challenges as challenge
  where challenge.auth_transaction_id = v_completion.auth_transaction_id
    and challenge.user_id = v_completion.user_id
    and challenge.factor in (
      'WEBAUTHN_REGISTRATION',
      'WEBAUTHN_AUTHENTICATION'
    )
    and challenge.verified_at is not null
    and challenge.consumed_at is not null;

  if v_password_verified_at is null
    or v_totp_verified_at is null
    or v_webauthn_count <> 1
    or v_webauthn_verified_at is null
    or v_password_verified_at > v_totp_verified_at
    or v_totp_verified_at > v_webauthn_verified_at
    or v_webauthn_verified_at > v_now
    or v_completion.verified_at < v_webauthn_verified_at
  then
    return;
  end if;

  select user_role.role
  into v_role
  from public.user_roles as user_role
  where user_role.user_id = v_completion.user_id;
  if v_role is null then
    return;
  end if;

  if v_role = 'STUDENT' and not exists (
    select 1
    from public.students as student
    where student.auth_user_id = v_completion.user_id
      and student.status = 'ACTIVE'
  ) then
    return;
  end if;

  update public.authentication_challenges
  set consumed_at = v_now
  where id = v_completion.id
    and consumed_at is null;
  if not found then
    return;
  end if;

  insert into public.user_sessions (
    user_id,
    session_token_hash,
    password_verified_at,
    totp_verified_at,
    webauthn_verified_at,
    expires_at
  )
  values (
    v_completion.user_id,
    _session_token_hash,
    v_password_verified_at,
    v_totp_verified_at,
    v_webauthn_verified_at,
    _expires_at
  )
  returning id into v_session_id;

  insert into public.security_audit_logs (
    actor_user_id,
    subject_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    v_completion.user_id,
    v_completion.user_id,
    'AUTHENTICATION_SESSION_CREATED',
    'user_session',
    v_session_id::text,
    pg_catalog.jsonb_build_object('role', v_role)
  );

  return query select v_session_id, v_completion.user_id, v_role;
end;
$$;

revoke all on function public.create_authenticated_session(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_authenticated_session(text, text, timestamptz)
  to service_role;

create or replace function public.revoke_authenticated_session(_session_token_hash text)
returns table (revoked boolean, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_user_id uuid;
begin
  if _session_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, null::uuid;
    return;
  end if;

  update public.user_sessions
  set revoked_at = pg_catalog.now()
  where session_token_hash = _session_token_hash
    and revoked_at is null
  returning id, user_sessions.user_id into v_session_id, v_user_id;

  if v_session_id is null then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.security_audit_logs (
    actor_user_id,
    subject_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_user_id,
    v_user_id,
    'AUTHENTICATION_SESSION_REVOKED',
    'user_session',
    v_session_id::text
  );

  return query select true, v_user_id;
end;
$$;

revoke all on function public.revoke_authenticated_session(text)
  from public, anon, authenticated;
grant execute on function public.revoke_authenticated_session(text)
  to service_role;
