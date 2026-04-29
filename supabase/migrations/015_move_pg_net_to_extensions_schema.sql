-- 015_move_pg_net_to_extensions_schema.sql
-- Supabase advisor "extension_in_public" flags pg_net living in public.
-- pg_net does NOT support `ALTER EXTENSION ... SET SCHEMA`, so the only
-- way to move it is to drop and recreate it in a private `extensions`
-- schema. We must:
--   1. Remove the existing send_reminder cron job (it references
--      public.http_post).
--   2. Drop pg_net from public.
--   3. Recreate pg_net inside the `extensions` schema.
--   4. Reschedule send_reminder using extensions.http_post.

create schema if not exists extensions;
grant usage on schema extensions to postgres, service_role;

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
end;
$$;

drop extension if exists pg_net;
create extension pg_net schema extensions;

do $$
begin
  perform cron.schedule(
    'send_reminder',
    '* * * * *',
    $job$
      select extensions.http_post(
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
