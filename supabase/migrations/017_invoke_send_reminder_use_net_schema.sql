-- 017_invoke_send_reminder_use_net_schema.sql
-- Migration 016 defined public.invoke_send_reminder() to call
-- extensions.http_post(...). However, pg_net pins its functions to
-- the `net` schema regardless of where the extension itself lives,
-- so the call fails every minute with:
--
--   ERROR: function extensions.http_post(url => text, headers => jsonb, body => jsonb) does not exist
--
-- Redefine the function to call net.http_post directly, using the
-- correct argument order for pg_net's signature:
--   net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)

create or replace function public.invoke_send_reminder()
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  reminder_url constant text :=
    'https://uzwjriqjoetgotozgimx.functions.supabase.co/send-reminder';
  cron_secret text;
begin
  select decrypted_secret
    into cron_secret
    from vault.decrypted_secrets
    where name = 'cron_secret'
    limit 1;

  if cron_secret is null then
    -- Operator hasn't inserted the secret yet. No-op rather than
    -- spamming pg_cron logs. Insert the secret with:
    --   select vault.create_secret('<value>', 'cron_secret');
    return;
  end if;

  perform net.http_post(
    url     := reminder_url,
    body    := '{}'::jsonb,
    params  := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', cron_secret
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.invoke_send_reminder() from public, anon, authenticated;
