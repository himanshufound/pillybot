create extension if not exists pg_cron;

insert into storage.buckets (id, name, public)
values ('pill-images', 'pill-images', false)
on conflict (id) do update
set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('prescription-temp', 'prescription-temp', false)
on conflict (id) do update
set public = excluded.public;

create policy "pill_images_insert_own_prefix"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pill-images'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create policy "pill_images_select_own_prefix"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'pill-images'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create policy "pill_images_delete_own_prefix"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'pill-images'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create policy "prescription_temp_insert_own_prefix"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'prescription-temp'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create policy "prescription_temp_select_own_prefix"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'prescription-temp'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create policy "prescription_temp_delete_own_prefix"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'prescription-temp'
    and auth.uid() is not null
    and name like 'users/' || auth.uid()::text || '/%'
  );

create or replace function public.cleanup_expired_prescription_temp()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'prescription-temp'
    and created_at < now() - interval '1 hour';
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'cleanup_prescription_temp'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'cleanup_prescription_temp',
    '*/5 * * * *',
    $job$select public.cleanup_expired_prescription_temp();$job$
  );
end;
$$;
