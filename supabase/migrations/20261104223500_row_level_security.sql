-- Authorization helpers run with the migration owner so role lookups do not
-- recurse through the user_roles RLS policies.
create function public.has_app_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = _role
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role in ('ADMIN'::public.app_role, 'SUPER_ADMIN'::public.app_role)
  );
$$;

create function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'SUPER_ADMIN'::public.app_role
  );
$$;

create function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.students
  where auth_user_id = (select auth.uid())
  limit 1
$$;

revoke all on function public.has_app_role(public.app_role) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.current_student_id() from public, anon;
grant execute on function public.has_app_role(public.app_role) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.current_student_id() to authenticated;

create policy "students_read_own_or_admin"
on public.students for select to authenticated
using (auth_user_id = (select auth.uid()) or (select public.is_admin()));

create policy "students_admin_manage"
on public.students for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "student_profiles_read_own_or_admin"
on public.student_profiles for select to authenticated
using (student_id = (select public.current_student_id()) or (select public.is_admin()));

create policy "student_profiles_update_own_or_admin"
on public.student_profiles for update to authenticated
using (student_id = (select public.current_student_id()) or (select public.is_admin()))
with check (student_id = (select public.current_student_id()) or (select public.is_admin()));

create policy "student_profiles_admin_insert"
on public.student_profiles for insert to authenticated
with check ((select public.is_admin()));

create policy "programmes_read_authenticated"
on public.programmes for select to authenticated
using (true);

create policy "programmes_admin_manage"
on public.programmes for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "courses_read_authenticated"
on public.courses for select to authenticated
using (true);

create policy "courses_admin_manage"
on public.courses for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "programme_courses_read_authenticated"
on public.programme_courses for select to authenticated
using (true);

create policy "programme_courses_admin_manage"
on public.programme_courses for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "semesters_read_authenticated"
on public.semesters for select to authenticated
using (true);

create policy "semesters_admin_manage"
on public.semesters for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "course_registrations_read_own_or_admin"
on public.course_registrations for select to authenticated
using (student_id = (select public.current_student_id()) or (select public.is_admin()));

create policy "course_registrations_register_self"
on public.course_registrations for insert to authenticated
with check (
  student_id = (select public.current_student_id())
  and status = 'REGISTERED'
);

create policy "course_registrations_admin_manage"
on public.course_registrations for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "examination_results_read_published_own_or_admin"
on public.examination_results for select to authenticated
using (
  (status = 'PUBLISHED' and exists (
    select 1
    from public.course_registrations as registration
    where registration.id = course_registration_id
      and registration.student_id = (select public.current_student_id())
  ))
  or (select public.is_admin())
);

create policy "examination_results_admin_manage"
on public.examination_results for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "fee_statements_read_own_or_admin"
on public.fee_statements for select to authenticated
using (student_id = (select public.current_student_id()) or (select public.is_admin()));

create policy "fee_statements_admin_manage"
on public.fee_statements for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "payments_read_own_or_admin"
on public.payments for select to authenticated
using (
  exists (
    select 1
    from public.fee_statements as statement
    where statement.id = fee_statement_id
      and statement.student_id = (select public.current_student_id())
  )
  or (select public.is_admin())
);

create policy "payments_admin_manage"
on public.payments for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "user_roles_read_self_or_super_admin"
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_super_admin()));

create policy "user_roles_super_admin_manage"
on public.user_roles for all to authenticated
using ((select public.is_super_admin()))
with check ((select public.is_super_admin()));

create policy "login_attempts_admin_read"
on public.login_attempts for select to authenticated
using ((select public.is_admin()));

create policy "security_audit_logs_admin_read"
on public.security_audit_logs for select to authenticated
using ((select public.is_admin()));

-- TOTP/WebAuthn secrets, application sessions, challenge state, and recovery
-- tokens have no client policies. They are accessible only to trusted server
-- code using the service role and must never be queried from browser clients.
