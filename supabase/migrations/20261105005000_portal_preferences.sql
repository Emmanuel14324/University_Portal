create table public.portal_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.portal_settings enable row level security;

notify pgrst, 'reload schema';
