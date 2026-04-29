-- 010_send_reminder_cron.sql
-- Schedules the send-reminder Edge Function once per minute via pg_cron.
--
-- Operator action required AFTER applying this migration (one time):
--
--   alter database postgres
--     set app.send_reminder_url = 'https://<project-ref>.functions.supabase.co/send-reminder';
--   alter database postgres
--     set app.cron_secret       = '<the same value as the CRON_SECRET edge secret>';
--
-- Without those two database-level settings the cron job will be
-- scheduled but each invocation will be a no-op (current_setting returns
-- NULL with the second arg `true`). This is intentional — we don't want
-- the cron secret committed to source control.

-- Note: migration 015 moves pg_net into the `extensions` schema. When
-- replaying migrations from scratch this file runs first and would put
-- pg_net in `public`, but migration 015 corrects that. To future-proof,
-- migration 015 also rewrites the cron job to call `extensions.http_post`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing_id bigint;
begin
  select jobid
    into existing_id
    from cron.job
    where jobname = 'send_reminder'
    limit 1;

  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;

  perform cron.schedule(
    'send_reminder',
    '* * * * *',
    $job$
      select net.http_post(
        url     := current_setting('app.send_reminder_url', true),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.cron_secret', true)
        ),
        body    := '{}'::jsonb
      )
      where current_setting('app.send_reminder_url', true) is not null
        and current_setting('app.cron_secret', true)        is not null;
    $job$
  );
end;
$$;
