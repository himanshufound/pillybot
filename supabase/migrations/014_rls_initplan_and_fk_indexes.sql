-- 014_rls_initplan_and_fk_indexes.sql
-- Performance hygiene driven by Supabase advisors:
--   * "auth_rls_initplan": every auth.uid() call inside a RLS USING /
--     WITH CHECK clause re-runs per row. Wrap each call in
--     (select auth.uid()) so PostgreSQL caches it as an init-plan.
--   * "multiple_permissive_policies": consolidate the two UPDATE
--     policies on caregiver_links into one.
--   * "unindexed_foreign_keys": add covering indexes for the FKs we
--     actually traverse in queries.

-- 1) Foreign-key covering indexes.

create index if not exists dose_logs_medication_id_idx
  on public.dose_logs (medication_id);

create index if not exists medications_user_id_idx
  on public.medications (user_id);

create index if not exists edge_function_events_dose_log_id_idx
  on public.edge_function_events (dose_log_id);

create index if not exists edge_function_events_medication_id_idx
  on public.edge_function_events (medication_id);

-- 2) Re-create RLS policies with init-plan-friendly auth.uid() calls.
--    Same access rules as before, just the (select auth.uid()) wrapper.

-- profiles
drop policy if exists "profiles_select_own_or_linked" on public.profiles;
drop policy if exists "profiles_insert_own"           on public.profiles;
drop policy if exists "profiles_update_own"           on public.profiles;
drop policy if exists "profiles_delete_own"           on public.profiles;

create policy "profiles_select_own_or_linked"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.caregiver_links cl
      where cl.caregiver_id = (select auth.uid())
        and cl.patient_id   = profiles.id
    )
  );

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_delete_own"
  on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

-- medications
drop policy if exists "medications_select_own_or_linked" on public.medications;
drop policy if exists "medications_insert_own"           on public.medications;
drop policy if exists "medications_update_own"           on public.medications;
drop policy if exists "medications_delete_own"           on public.medications;

create policy "medications_select_own_or_linked"
  on public.medications for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.caregiver_links cl
      where cl.caregiver_id = (select auth.uid())
        and cl.patient_id   = medications.user_id
    )
  );

create policy "medications_insert_own"
  on public.medications for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "medications_update_own"
  on public.medications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "medications_delete_own"
  on public.medications for delete to authenticated
  using (user_id = (select auth.uid()));

-- dose_logs
drop policy if exists "dose_logs_select_own_or_linked" on public.dose_logs;
drop policy if exists "dose_logs_insert_own"           on public.dose_logs;
drop policy if exists "dose_logs_update_own"           on public.dose_logs;
drop policy if exists "dose_logs_delete_own"           on public.dose_logs;

create policy "dose_logs_select_own_or_linked"
  on public.dose_logs for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.caregiver_links cl
      where cl.caregiver_id = (select auth.uid())
        and cl.patient_id   = dose_logs.user_id
    )
  );

create policy "dose_logs_insert_own"
  on public.dose_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "dose_logs_update_own"
  on public.dose_logs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "dose_logs_delete_own"
  on public.dose_logs for delete to authenticated
  using (user_id = (select auth.uid()));

-- alerts
drop policy if exists "alerts_select_own_or_linked" on public.alerts;
drop policy if exists "alerts_insert_own"           on public.alerts;
drop policy if exists "alerts_update_own"           on public.alerts;
drop policy if exists "alerts_delete_own"           on public.alerts;

create policy "alerts_select_own_or_linked"
  on public.alerts for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.caregiver_links cl
      where cl.caregiver_id = (select auth.uid())
        and cl.patient_id   = alerts.user_id
    )
  );

create policy "alerts_insert_own"
  on public.alerts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "alerts_update_own"
  on public.alerts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "alerts_delete_own"
  on public.alerts for delete to authenticated
  using (user_id = (select auth.uid()));

-- web_push_subscriptions
drop policy if exists "web_push_subscriptions_select_own_or_linked" on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions_insert_own"           on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions_update_own"           on public.web_push_subscriptions;
drop policy if exists "web_push_subscriptions_delete_own"           on public.web_push_subscriptions;

create policy "web_push_subscriptions_select_own_or_linked"
  on public.web_push_subscriptions for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.caregiver_links cl
      where cl.caregiver_id = (select auth.uid())
        and cl.patient_id   = web_push_subscriptions.user_id
    )
  );

create policy "web_push_subscriptions_insert_own"
  on public.web_push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "web_push_subscriptions_update_own"
  on public.web_push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "web_push_subscriptions_delete_own"
  on public.web_push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- caregiver_links: also collapse the two UPDATE policies.
drop policy if exists "caregiver_links_select_participants"      on public.caregiver_links;
drop policy if exists "caregiver_links_insert_participants"      on public.caregiver_links;
drop policy if exists "caregiver_links_delete_participants"      on public.caregiver_links;
drop policy if exists "caregiver_links_update_patient_response"  on public.caregiver_links;
drop policy if exists "caregiver_links_update_caregiver_resend"  on public.caregiver_links;

create policy "caregiver_links_select_participants"
  on public.caregiver_links for select to authenticated
  using (
    caregiver_id = (select auth.uid())
    or patient_id = (select auth.uid())
  );

create policy "caregiver_links_insert_participants"
  on public.caregiver_links for insert to authenticated
  with check (
    caregiver_id = (select auth.uid())
    or patient_id = (select auth.uid())
  );

create policy "caregiver_links_update_participants"
  on public.caregiver_links for update to authenticated
  using (
    caregiver_id = (select auth.uid())
    or patient_id = (select auth.uid())
  )
  with check (
    caregiver_id = (select auth.uid())
    or patient_id = (select auth.uid())
  );

create policy "caregiver_links_delete_participants"
  on public.caregiver_links for delete to authenticated
  using (
    caregiver_id = (select auth.uid())
    or patient_id = (select auth.uid())
  );
