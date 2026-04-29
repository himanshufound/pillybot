-- 016_send_reminder_cron_via_vault.sql
-- The previous cron schedule (migration 010 / rewritten in 015) reads
-- the function URL and cron secret from `current_setting()` GUCs that
-- are set with `ALTER DATABASE … SET …`. On Supabase Managed,
-- `ALTER DATABASE` is restricted, so the GUC approach can't be applied
-- through the API. Use Supabase Vault instead — it's the documented
-- managed path for storing per-database secrets and is already
-- installed on every Supabase project (`supabase_vault` extension).
--
-- After this migration runs, the operator only needs to insert the
-- cron secret into Vault once:
--
--   select vault.create_secret(
--     '<the same value as the CRON_SECRET edge secret>',
--     'cron_secret',
--     'Used by the send_reminder pg_cron job to authenticate to the send-reminder Edge Function'
--   );
--
-- The function URL is not a secret and is hard-coded below.

create extension if not exists pg_cron;

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

create or replace function public.invoke_send_reminder()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
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

  perform extensions.http_post(
    url     := reminder_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', cron_secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_send_reminder() from public, anon, authenticated;

select cron.schedule(
  'send_reminder',
  '* * * * *',
  $job$select public.invoke_send_reminder();$job$
);
