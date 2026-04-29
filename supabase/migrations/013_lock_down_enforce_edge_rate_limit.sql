-- 013_lock_down_enforce_edge_rate_limit.sql
-- enforce_edge_rate_limit is only used from Edge Functions via the
-- service role (which bypasses GRANTs anyway), and from the
-- find_profile_id_by_email RPC (also SECURITY DEFINER; PostgreSQL
-- routes inside-function calls under DEFINER privileges, not the
-- caller's). So revoke the public-facing grant.
revoke all on function public.enforce_edge_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
