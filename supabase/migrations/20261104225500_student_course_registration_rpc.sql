create or replace function public.register_student_course(
  _auth_user_id uuid,
  _course_id uuid,
  _semester_id uuid
)
returns table (outcome text, registration_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_registration_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  select student.*
  into v_student
  from public.students as student
  join public.user_roles as user_role
    on user_role.user_id = student.auth_user_id
  where student.auth_user_id = _auth_user_id
    and student.status = 'ACTIVE'
    and user_role.role = 'STUDENT';
  if not found or _course_id is null or _semester_id is null then
    return query select 'ineligible'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.courses as course
    where course.id = _course_id
      and course.is_active
  ) or not exists (
    select 1
    from public.semesters as semester
    where semester.id = _semester_id
      and semester.status = 'REGISTRATION_OPEN'
      and (semester.registration_opens_at is null or semester.registration_opens_at <= v_now)
      and (semester.registration_closes_at is null or semester.registration_closes_at > v_now)
  ) or not exists (
    select 1
    from public.programme_courses as programme_course
    where programme_course.programme_id = v_student.programme_id
      and programme_course.course_id = _course_id
      and programme_course.year_of_study = v_student.year_of_study
  ) then
    return query select 'ineligible'::text, null::uuid;
    return;
  end if;

  insert into public.course_registrations (
    student_id,
    course_id,
    semester_id,
    status
  )
  values (
    v_student.id,
    _course_id,
    _semester_id,
    'REGISTERED'
  )
  on conflict (student_id, course_id, semester_id) do nothing
  returning id into v_registration_id;

  if v_registration_id is null then
    return query select 'already_registered'::text, null::uuid;
    return;
  end if;

  insert into public.security_audit_logs (
    actor_user_id,
    subject_user_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    _auth_user_id,
    _auth_user_id,
    'STUDENT_COURSE_REGISTERED',
    'course_registration',
    v_registration_id::text,
    pg_catalog.jsonb_build_object('course_id', _course_id, 'semester_id', _semester_id)
  );

  return query select 'registered'::text, v_registration_id;
end;
$$;

revoke all on function public.register_student_course(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.register_student_course(uuid, uuid, uuid)
  to service_role;
