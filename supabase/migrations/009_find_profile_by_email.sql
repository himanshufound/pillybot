-- 009_find_profile_by_email.sql
-- Caregivers cannot read other users' profile rows directly because
-- profiles RLS only exposes the caller's own row or rows of patients
-- already linked to them. This RPC gives caregivers a narrow, audited
-- way to look up a single profile id by email so they can request a
-- caregiver link.
--
-- The function:
--   * runs SECURITY DEFINER so it can read public.profiles
--   * lowercases/trims the email before lookup
--   * returns only the uuid (no email/name leak)
--   * is rate-limited per authenticated caller via
--     public.enforce_edge_rate_limit to mitigate enumeration
--   * is granted only to the authenticated role

create or replace function public.find_profile_id_by_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  caller_id uuid := auth.uid();
  is_allowed boolean;
  found_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  if p_email is null then
    return null;
  end if;

  normalized_email := lower(trim(p_email));
  if length(normalized_email) = 0 then
    return null;
  end if;

  -- 20 lookups / 10 minutes per authenticated user is plenty for the UI
  -- and small enough to make scraping the directory impractical.
  is_allowed := public.enforce_edge_rate_limit(
    caller_id,
    'find_profile_id_by_email',
    20,
    600
  );

  if is_allowed is not true then
    raise exception 'rate limit exceeded'
      using errcode = '54000';
  end if;

  select id
    into found_id
    from public.profiles
    where lower(email) = normalized_email
    limit 1;

  return found_id;
end;
$$;

revoke all on function public.find_profile_id_by_email(text) from public;
revoke all on function public.find_profile_id_by_email(text) from anon;
grant execute on function public.find_profile_id_by_email(text) to authenticated;
