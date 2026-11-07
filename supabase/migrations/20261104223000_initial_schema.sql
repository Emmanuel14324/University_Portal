-- Initial St Jude University portal schema.
-- RLS is enabled on every application table with no policies yet, so access
-- remains denied until the dedicated policy migration is applied.

create type public.app_role as enum ('SUPER_ADMIN', 'ADMIN', 'STUDENT');
create type public.student_status as enum ('APPLICANT', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN');
create type public.semester_status as enum ('DRAFT', 'REGISTRATION_OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
create type public.registration_status as enum ('REGISTERED', 'DROPPED', 'COMPLETED', 'WITHDRAWN');
create type public.result_status as enum ('DRAFT', 'PUBLISHED', 'WITHHELD');
create type public.fee_statement_status as enum ('OPEN', 'PAID', 'OVERDUE', 'VOID');
create type public.payment_status as enum ('PENDING', 'PAID', 'FAILED', 'REVERSED');
create type public.payment_method as enum ('MOBILE_MONEY', 'BANK_TRANSFER', 'CARD', 'CASH', 'OTHER');
create type public.challenge_factor as enum ('PASSWORD_TRANSACTION', 'TOTP', 'WEBAUTHN_REGISTRATION', 'WEBAUTHN_AUTHENTICATION', 'AUTHENTICATION_COMPLETE', 'ACCOUNT_RECOVERY');
create type public.recovery_status as enum ('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create table public.students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  registration_number text not null unique check (registration_number = upper(registration_number)),
  programme_id uuid,
  admission_year smallint not null check (admission_year between 1900 and 2200),
  year_of_study smallint not null default 1 check (year_of_study between 1 and 10),
  status public.student_status not null default 'APPLICANT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_profiles (
  student_id uuid primary key references public.students (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone_number text,
  date_of_birth date,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.programmes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null,
  award text not null,
  department text not null,
  duration_years smallint not null check (duration_years between 1 and 10),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.students
  add constraint students_programme_id_fkey
  foreign key (programme_id) references public.programmes (id) on delete restrict;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  name text not null,
  department text not null,
  credit_units numeric(4, 1) not null check (credit_units > 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.programme_courses (
  programme_id uuid not null references public.programmes (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  year_of_study smallint not null check (year_of_study between 1 and 10),
  is_compulsory boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (programme_id, course_id)
);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null check (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  status public.semester_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year, name),
  check (ends_on > starts_on),
  check (
    registration_opens_at is null
    or registration_closes_at is null
    or registration_closes_at > registration_opens_at
  )
);

create table public.course_registrations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  semester_id uuid not null references public.semesters (id) on delete restrict,
  status public.registration_status not null default 'REGISTERED',
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, course_id, semester_id)
);

create table public.examination_results (
  id uuid primary key default gen_random_uuid(),
  course_registration_id uuid not null unique references public.course_registrations (id) on delete restrict,
  marks numeric(5, 2) check (marks between 0 and 100),
  grade text check (grade is null or grade ~ '^[A-F][+]?-?$'),
  grade_points numeric(3, 2) check (grade_points between 0 and 5),
  status public.result_status not null default 'DRAFT',
  published_at timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'PUBLISHED') = (published_at is not null))
);

create table public.fee_statements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  semester_id uuid not null references public.semesters (id) on delete restrict,
  statement_number text not null unique,
  currency char(3) not null default 'UGX' check (currency = 'UGX'),
  billed_amount numeric(14, 0) not null check (billed_amount >= 0),
  due_at timestamptz,
  status public.fee_statement_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, semester_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  fee_statement_id uuid not null references public.fee_statements (id) on delete restrict,
  reference text not null unique,
  amount numeric(14, 0) not null check (amount > 0),
  method public.payment_method not null,
  status public.payment_status not null default 'PENDING',
  provider_reference text unique,
  paid_at timestamptz,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'PAID') = (paid_at is not null))
);

create table public.totp_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  secret_ciphertext text not null,
  encryption_key_version smallint not null check (encryption_key_version > 0),
  recovery_code_hashes text[] not null default array[]::text[],
  last_verified_step bigint check (last_verified_step is null or last_verified_step >= 0),
  enrollment_expires_at timestamptz,
  is_enabled boolean not null default false,
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_enabled = (enabled_at is not null)),
  check (is_enabled or enrollment_expires_at is not null)
);

create table public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  signature_counter bigint not null default 0 check (signature_counter >= 0),
  transports text[] not null default array[]::text[],
  device_name text,
  backed_up boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'STUDENT',
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_token_hash char(64) not null unique check (session_token_hash ~ '^[0-9a-f]{64}$'),
  password_verified_at timestamptz not null,
  totp_verified_at timestamptz not null,
  webauthn_verified_at timestamptz not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    password_verified_at <= totp_verified_at
    and totp_verified_at <= webauthn_verified_at
    and webauthn_verified_at <= created_at
    and expires_at > created_at
  )
);

create table public.login_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  identifier_hash char(64) not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  source_ip_hash char(64) check (source_ip_hash is null or source_ip_hash ~ '^[0-9a-f]{64}$'),
  factor public.challenge_factor not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create table public.security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  subject_user_id uuid references auth.users (id) on delete set null,
  action text not null check (length(btrim(action)) > 0),
  entity_type text,
  entity_id text,
  source_ip_hash char(64) check (source_ip_hash is null or source_ip_hash ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.authentication_challenges (
  id uuid primary key default gen_random_uuid(),
  auth_transaction_id uuid not null,
  user_id uuid references auth.users (id) on delete cascade,
  factor public.challenge_factor not null,
  challenge_hash char(64) not null unique check (challenge_hash ~ '^[0-9a-f]{64}$'),
  webauthn_challenge text,
  verified_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_transaction_id, factor),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create table public.account_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  token_hash char(64) not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.recovery_status not null default 'PENDING',
  expires_at timestamptz not null,
  completed_at timestamptz,
  source_ip_hash char(64) check (source_ip_hash is null or source_ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'COMPLETED') = (completed_at is not null))
);

create index students_programme_status_idx on public.students (programme_id, status);
create index programme_courses_course_idx on public.programme_courses (course_id);
create index course_registrations_student_semester_idx on public.course_registrations (student_id, semester_id);
create index course_registrations_course_semester_idx on public.course_registrations (course_id, semester_id);
create index examination_results_status_idx on public.examination_results (status);
create index fee_statements_student_status_idx on public.fee_statements (student_id, status);
create index payments_statement_status_idx on public.payments (fee_statement_id, status);
create index webauthn_credentials_user_idx on public.webauthn_credentials (user_id);
create index user_sessions_user_expiry_idx on public.user_sessions (user_id, expires_at) where revoked_at is null;
create index login_attempts_identifier_created_idx on public.login_attempts (identifier_hash, created_at desc);
create index login_attempts_created_idx on public.login_attempts (created_at desc);
create index security_audit_logs_actor_created_idx on public.security_audit_logs (actor_user_id, created_at desc);
create index security_audit_logs_subject_created_idx on public.security_audit_logs (subject_user_id, created_at desc);
create index authentication_challenges_transaction_idx on public.authentication_challenges (auth_transaction_id);
create index authentication_challenges_expiry_idx on public.authentication_challenges (expires_at) where consumed_at is null;
create index account_recovery_requests_user_created_idx on public.account_recovery_requests (user_id, created_at desc);

create trigger students_set_updated_at before update on public.students
for each row execute function public.set_updated_at();
create trigger student_profiles_set_updated_at before update on public.student_profiles
for each row execute function public.set_updated_at();
create trigger programmes_set_updated_at before update on public.programmes
for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function public.set_updated_at();
create trigger programme_courses_set_updated_at before update on public.programme_courses
for each row execute function public.set_updated_at();
create trigger semesters_set_updated_at before update on public.semesters
for each row execute function public.set_updated_at();
create trigger course_registrations_set_updated_at before update on public.course_registrations
for each row execute function public.set_updated_at();
create trigger examination_results_set_updated_at before update on public.examination_results
for each row execute function public.set_updated_at();
create trigger fee_statements_set_updated_at before update on public.fee_statements
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();
create trigger totp_credentials_set_updated_at before update on public.totp_credentials
for each row execute function public.set_updated_at();
create trigger webauthn_credentials_set_updated_at before update on public.webauthn_credentials
for each row execute function public.set_updated_at();
create trigger user_roles_set_updated_at before update on public.user_roles
for each row execute function public.set_updated_at();
create trigger user_sessions_set_updated_at before update on public.user_sessions
for each row execute function public.set_updated_at();
create trigger authentication_challenges_set_updated_at before update on public.authentication_challenges
for each row execute function public.set_updated_at();
create trigger account_recovery_requests_set_updated_at before update on public.account_recovery_requests
for each row execute function public.set_updated_at();

alter table public.students enable row level security;
alter table public.student_profiles enable row level security;
alter table public.programmes enable row level security;
alter table public.courses enable row level security;
alter table public.programme_courses enable row level security;
alter table public.semesters enable row level security;
alter table public.course_registrations enable row level security;
alter table public.examination_results enable row level security;
alter table public.fee_statements enable row level security;
alter table public.payments enable row level security;
alter table public.totp_credentials enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_sessions enable row level security;
alter table public.login_attempts enable row level security;
alter table public.security_audit_logs enable row level security;
alter table public.authentication_challenges enable row level security;
alter table public.account_recovery_requests enable row level security;
