create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  dosage text not null,
  instructions text,
  schedule text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  medication_id uuid not null references public.medications (id) on delete cascade,
  scheduled_at timestamptz not null,
  taken_at timestamptz,
  status text not null check (status in ('scheduled', 'taken', 'missed', 'skipped')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.caregiver_links (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references public.profiles (id) on delete cascade,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  relationship text,
  created_at timestamptz not null default now(),
  unique (caregiver_id, patient_id),
  check (caregiver_id <> patient_id)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index dose_logs_user_id_scheduled_at_idx
  on public.dose_logs (user_id, scheduled_at desc);

create index alerts_user_id_read_idx
  on public.alerts (user_id, read);

create index caregiver_links_caregiver_id_patient_id_idx
  on public.caregiver_links (caregiver_id, patient_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.medications enable row level security;
alter table public.dose_logs enable row level security;
alter table public.caregiver_links enable row level security;
alter table public.alerts enable row level security;
alter table public.web_push_subscriptions enable row level security;

create policy "profiles_select_own_or_linked"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = auth.uid()
        and cl.patient_id = profiles.id
    )
  );

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_delete_own"
  on public.profiles
  for delete
  to authenticated
  using (id = auth.uid());

create policy "medications_select_own_or_linked"
  on public.medications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = auth.uid()
        and cl.patient_id = medications.user_id
    )
  );

create policy "medications_insert_own"
  on public.medications
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "medications_update_own"
  on public.medications
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "medications_delete_own"
  on public.medications
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy "dose_logs_select_own_or_linked"
  on public.dose_logs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = auth.uid()
        and cl.patient_id = dose_logs.user_id
    )
  );

create policy "dose_logs_insert_own"
  on public.dose_logs
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "dose_logs_update_own"
  on public.dose_logs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "dose_logs_delete_own"
  on public.dose_logs
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy "caregiver_links_select_participants"
  on public.caregiver_links
  for select
  to authenticated
  using (
    caregiver_id = auth.uid()
    or patient_id = auth.uid()
  );

create policy "caregiver_links_insert_participants"
  on public.caregiver_links
  for insert
  to authenticated
  with check (
    caregiver_id = auth.uid()
    or patient_id = auth.uid()
  );

create policy "caregiver_links_delete_participants"
  on public.caregiver_links
  for delete
  to authenticated
  using (
    caregiver_id = auth.uid()
    or patient_id = auth.uid()
  );

create policy "alerts_select_own_or_linked"
  on public.alerts
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = auth.uid()
        and cl.patient_id = alerts.user_id
    )
  );

create policy "alerts_insert_own"
  on public.alerts
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "alerts_update_own"
  on public.alerts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "alerts_delete_own"
  on public.alerts
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy "web_push_subscriptions_select_own_or_linked"
  on public.web_push_subscriptions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = auth.uid()
        and cl.patient_id = web_push_subscriptions.user_id
    )
  );

create policy "web_push_subscriptions_insert_own"
  on public.web_push_subscriptions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "web_push_subscriptions_update_own"
  on public.web_push_subscriptions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "web_push_subscriptions_delete_own"
  on public.web_push_subscriptions
  for delete
  to authenticated
  using (user_id = auth.uid());
