-- 008_caregiver_links_update_policy.sql
-- Adds the missing UPDATE policies on public.caregiver_links so that:
--   * Patients can accept or decline incoming caregiver requests.
--   * Caregivers can resend (reset) requests they originally created.
-- Without these policies, RLS silently blocked every UPDATE, returning
-- zero affected rows and giving the UI a false success.

drop policy if exists "caregiver_links_update_patient_response" on public.caregiver_links;
drop policy if exists "caregiver_links_update_caregiver_resend" on public.caregiver_links;

create policy "caregiver_links_update_patient_response"
  on public.caregiver_links
  for update
  to authenticated
  using (patient_id = auth.uid())
  with check (patient_id = auth.uid());

create policy "caregiver_links_update_caregiver_resend"
  on public.caregiver_links
  for update
  to authenticated
  using (caregiver_id = auth.uid())
  with check (caregiver_id = auth.uid());
