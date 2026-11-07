create table public.auth_rate_limits (
  identifier_hash char(64) primary key
    check (identifier_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  failed_attempts integer not null check (failed_attempts > 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.auth_rate_limits enable row level security;

create function public.record_password_failure(
  _identifier_hash char(64),
  _max_failures integer,
  _window_seconds integer,
  _lock_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _identifier_hash !~ '^[0-9a-f]{64}$'
    or _max_failures < 1
    or _window_seconds < 1
    or _lock_seconds < 1 then
    raise exception 'Invalid password rate-limit arguments'
      using errcode = '22023';
  end if;

  insert into public.auth_rate_limits as stored_limit (
    identifier_hash,
    window_started_at,
    failed_attempts,
    locked_until,
    updated_at
  )
  values (
    _identifier_hash,
    pg_catalog.now(),
    1,
    null,
    pg_catalog.now()
  )
  on conflict (identifier_hash) do update
  set
    window_started_at = case
      when stored_limit.window_started_at <=
        pg_catalog.now() - (_window_seconds * interval '1 second')
      then pg_catalog.now()
      else stored_limit.window_started_at
    end,
    failed_attempts = case
      when stored_limit.window_started_at <=
        pg_catalog.now() - (_window_seconds * interval '1 second')
      then 1
      else stored_limit.failed_attempts + 1
    end,
    locked_until = case
      when stored_limit.locked_until > pg_catalog.now()
      then stored_limit.locked_until
      when stored_limit.window_started_at <=
        pg_catalog.now() - (_window_seconds * interval '1 second')
      then null
      when stored_limit.failed_attempts + 1 >= _max_failures
      then pg_catalog.now() + (_lock_seconds * interval '1 second')
      else null
    end,
    updated_at = pg_catalog.now();
end;
$$;

revoke all on function public.record_password_failure(char(64), integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_password_failure(char(64), integer, integer, integer)
  to service_role;
