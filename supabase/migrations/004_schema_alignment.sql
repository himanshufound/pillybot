alter table public.medications
  add column if not exists color text,
  add column if not exists shape text,
  add column if not exists schedule_times text[];

alter table public.dose_logs
  add column if not exists verification_result jsonb;

alter table public.alerts
  add column if not exists dose_log_id uuid references public.dose_logs (id) on delete set null;

alter table public.caregiver_links
  add column if not exists status text default 'pending';

update public.caregiver_links
set status = 'pending'
where status is null;

alter table public.caregiver_links
  alter column status set default 'pending',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'caregiver_links_status_check'
      and conrelid = 'public.caregiver_links'::regclass
  ) then
    alter table public.caregiver_links
      add constraint caregiver_links_status_check
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end;
$$;

alter table public.caregiver_links
  drop column if exists relationship;

alter table public.profiles
  add column if not exists email text;

create index if not exists alerts_dose_log_id_idx
  on public.alerts (dose_log_id);
