-- 011_dose_logs_index_and_rate_limit_gc.sql
-- 1) Partial index that makes the send-reminder scan cheap.
--    The reminder query is:
--      select ... from dose_logs
--      where status = 'scheduled' and scheduled_at <= now()
--    The existing (user_id, scheduled_at desc) index doesn't help.
--
-- 2) Move edge_rate_limits cleanup off the hot path. The
--    enforce_edge_rate_limit() function used to run a DELETE on every
--    call. We rewrite it without the cleanup, and schedule a daily
--    pg_cron job to do the GC.

create index if not exists dose_logs_status_scheduled_at_idx
  on public.dose_logs (status, scheduled_at)
  where status = 'scheduled';

create or replace function public.enforce_edge_rate_limit(
  p_user_id uuid,
  p_function_name text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  window_bucket timestamptz;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_function_name is null or length(trim(p_function_name)) = 0 then
    raise exception 'p_function_name is required';
  end if;

  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'p_limit and p_window_seconds must be positive';
  end if;

  window_bucket := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.edge_rate_limits (
    user_id,
    function_name,
    window_start,
    count,
    updated_at
  ) values (
    p_user_id,
    trim(p_function_name),
    window_bucket,
    1,
    now()
  )
  on conflict (user_id, function_name, window_start)
  do update
    set count = edge_rate_limits.count + 1,
        updated_at = now()
  returning count into current_count;

  return current_count <= p_limit;
end;
$$;

create or replace function public.gc_edge_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.edge_rate_limits
  where window_start < now() - interval '2 days';
$$;

revoke all on function public.gc_edge_rate_limits() from public;
revoke all on function public.gc_edge_rate_limits() from anon;
revoke all on function public.gc_edge_rate_limits() from authenticated;

create extension if not exists pg_cron;

do $$
declare
  existing_id bigint;
begin
  select jobid
    into existing_id
    from cron.job
    where jobname = 'gc_edge_rate_limits'
    limit 1;

  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;

  perform cron.schedule(
    'gc_edge_rate_limits',
    '7 3 * * *',
    $job$select public.gc_edge_rate_limits();$job$
  );
end;
$$;
