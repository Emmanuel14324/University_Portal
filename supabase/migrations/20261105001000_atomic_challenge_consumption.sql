create or replace function public.consume_authentication_challenge(
  _challenge_id uuid,
  _verified boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumed boolean := false;
begin
  update public.authentication_challenges
  set consumed_at = pg_catalog.clock_timestamp(),
      verified_at = case
        when _verified then pg_catalog.clock_timestamp()
        else verified_at
      end
  where id = _challenge_id
    and consumed_at is null;

  v_consumed := found;
  return v_consumed;
end;
$$;

revoke all on function public.consume_authentication_challenge(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.consume_authentication_challenge(uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
