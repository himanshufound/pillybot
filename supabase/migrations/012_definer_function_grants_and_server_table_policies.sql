-- 012_definer_function_grants_and_server_table_policies.sql
-- Addresses Supabase advisor findings:
--   * "rls_enabled_no_policy" on public.edge_function_events
--     and public.edge_rate_limits — these tables are written/read only
--     from Edge Functions using the service role. Deny everyone via the
--     PostgREST API by adding an explicit "no rows" policy and by
--     revoking PostgREST grants.
--   * "anon_security_definer_function_executable" on every
--     SECURITY DEFINER function — revoke EXECUTE from `anon`. For
--     trigger-only helpers, revoke from `authenticated` too.

-- 1) Server-only tables: revoke API access and add deny-all policies.

revoke all on public.edge_function_events from anon, authenticated;
revoke all on public.edge_rate_limits     from anon, authenticated;

drop policy if exists "edge_function_events_no_api_access" on public.edge_function_events;
drop policy if exists "edge_rate_limits_no_api_access"     on public.edge_rate_limits;

create policy "edge_function_events_no_api_access"
  on public.edge_function_events
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "edge_rate_limits_no_api_access"
  on public.edge_rate_limits
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- 2) Trigger-only SECURITY DEFINER helpers — never callable from API.

revoke all on function public.handle_new_user()            from public, anon, authenticated;
revoke all on function public.sync_profile_email_from_auth() from public, anon, authenticated;
revoke all on function public.cleanup_expired_prescription_temp() from public, anon, authenticated;

-- 3) Callable SECURITY DEFINER helpers — keep authenticated, drop anon.

revoke all on function public.enforce_edge_rate_limit(uuid, text, integer, integer)
  from public, anon;
grant execute on function public.enforce_edge_rate_limit(uuid, text, integer, integer)
  to authenticated;

revoke all on function public.find_profile_id_by_email(text)
  from public, anon;
grant execute on function public.find_profile_id_by_email(text)
  to authenticated;

revoke all on function public.gc_edge_rate_limits()
  from public, anon, authenticated;
