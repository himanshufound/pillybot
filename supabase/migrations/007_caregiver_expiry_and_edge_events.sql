alter table public.caregiver_links
  add column if not exists expires_at timestamptz,
  add column if not exists responded_at timestamptz;

update public.caregiver_links
set expires_at = created_at + interval '7 days'
where expires_at is null;

alter table public.caregiver_links
  alter column expires_at set default (now() + interval '7 days');

create index if not exists caregiver_links_patient_status_idx
  on public.caregiver_links (patient_id, status, expires_at desc);

create table if not exists public.edge_function_events (
  id bigint generated always as identity primary key,
  function_name text not null,
  event_type text not null,
  status text not null check (status in ('success', 'warning', 'failure')),
  user_id uuid references auth.users (id) on delete set null,
  medication_id uuid references public.medications (id) on delete set null,
  dose_log_id uuid references public.dose_logs (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists edge_function_events_function_created_idx
  on public.edge_function_events (function_name, created_at desc);

create index if not exists edge_function_events_user_created_idx
  on public.edge_function_events (user_id, created_at desc);

alter table public.edge_function_events enable row level security;
