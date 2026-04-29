# Progress Log

## 2026-04-26T05:30:45.369Z — Loop 1
- Fixed caregiver link creation to match current DB schema (`caregiver_links.relationship` is no longer referenced).
- Fixed reminder pipeline status mismatch by aligning dose processing to `scheduled` status in frontend types/dashboard and `send-reminder` Edge Function.
- Added `005_profile_email_sync.sql` and updated initial schema trigger so profile emails stay in sync with `auth.users` (unblocks caregiver linking by email).
- Added explicit `# MANUAL REQUIRED:` deployment steps for Supabase secrets, Edge Function deploys, migrations, and Vercel env vars in `deploy-supabase.sh`.
- Improved prescription image preview lifecycle by revoking object URLs to avoid client memory leaks.

Next: run full build after changes, then deploy Edge Function updates and run security/performance advisors on Supabase.

## 2026-04-26T05:30:45.369Z — Loop 2
- Applied Supabase migration `005_profile_email_sync` to production (backfilled `profiles.email`, added auth email-change sync trigger).
- Deployed `send-reminder` Edge Function version 3 with `scheduled` status fix.
- Ran endpoint smoke check for `send-reminder` and confirmed expected auth protection response (`401 Unauthorized` without cron secret).

Next: deploy remaining function parity updates if needed, then run a deeper advisor/security pass and address findings.

## 2026-04-26T05:50:17.822Z — Loop 3
- Security audit pass complete:
  - Supabase security advisor returned no active findings.
  - Verified RLS is enabled on all `public` and `storage` tables used by the app.
  - Verified policies for app tables and storage object access are scoped to `authenticated` users and owner-prefixed paths for `pill-images` / `prescription-temp`.
  - Confirmed `.env.local` is ignored by git and not tracked.
  - Secret scan found no hardcoded runtime secrets in tracked source files.
- Added abuse protection for AI parsing:
  - New migration `006_edge_rate_limit.sql` creates `public.edge_rate_limits` and `public.enforce_edge_rate_limit(...)`.
  - `parse-prescription` now enforces per-user rate limiting (8 requests / 10 minutes).
- Standardized JSON error envelope locally across Edge Functions:
  - `verify-pill`, `parse-prescription`, `send-reminder`, and `static-site` now use structured JSON errors.
- Fixed notifications routing bug:
  - Push payload links now target `/` (not `/dashboard`, which was not a valid route in this app).
  - Service worker registration now respects `BASE_URL`, improving deploy-path compatibility.

Next: restore Supabase MCP auth and deploy updated function versions (`verify-pill`, `parse-prescription`, `send-reminder`, `static-site`) so live responses match local hardening changes.

## 2026-04-28T10:07:05.000Z — Loop 4
- Added `007_caregiver_expiry_and_edge_events.sql`:
  - caregiver requests now track `expires_at` and `responded_at`
  - new `public.edge_function_events` table records reminder, parse, rate-limit, and verification events
- Hardened frontend AI flows:
  - low-confidence parse/verify responses now show cautionary UX
  - verification capture enforces client-side 5MB limit
  - structured Edge Function error messages now surface in the UI when available
- Improved caregiver workflow:
  - duplicate requests now refresh pending links instead of blindly failing
  - expired requests are visible, cannot be accepted, and can be resent or removed
  - patients and caregivers now see clearer request-state messaging
- Improved notification UX:
  - explicit permission-state messaging
  - re-register current browser flow
  - local test notification action in settings
- Added test coverage for dashboard summaries, caregiver link state/actions, Edge Function error parsing, and push notification capability helpers.
- Split release flow into:
  - `scripts/build-release.sh`
  - `scripts/deploy-functions.sh`
  - `scripts/post-deploy-smoke.sh`
  - `RELEASE_CHECKLIST.md`
- Verified locally:
  - `npm run build`
  - `npm test`
  - `bash scripts/build-release.sh`
  - route shell returns `200` for `#/auth`, `#/`, `#/add`, `#/verify`, `#/parse`, `#/alerts`, `#/caregiver`, `#/settings` via local dev server

Next: apply `007_caregiver_expiry_and_edge_events.sql`, install/auth Supabase CLI or restore MCP access, deploy the four Edge Functions, and run authenticated browser verification against a real Supabase-backed session.

## 2026-04-28T15:55:00.000Z — Loop 5 (audit fixes, autopilot)
- Critical:
  - `008_caregiver_links_update_policy.sql`: added missing UPDATE RLS policies. Without these, accept/decline/resend silently affected zero rows.
  - `009_find_profile_by_email.sql`: `security definer` RPC so caregivers can resolve a patient by email despite restrictive `profiles` RLS, with built-in per-user rate limiting via `enforce_edge_rate_limit`.
  - `010_send_reminder_cron.sql`: pg_cron + pg_net schedule for `send-reminder` (operator must set `app.send_reminder_url` and `app.cron_secret` after applying).
  - `011_dose_logs_index_and_rate_limit_gc.sql`: partial index on `dose_logs(status, scheduled_at)` for the reminder scan, and moved `edge_rate_limits` GC out of the hot path into a daily `pg_cron` job.
  - `vercel.json`: full security header set (CSP, HSTS, X-Frame-Options, COOP/CORP, Permissions-Policy, Referrer-Policy) plus correct caching for `/assets/*` and `/sw.js`.
- High:
  - `static-site` Edge Function now normalizes paths and rejects traversal attempts (`..`, percent-encoded variants, backslashes, null bytes).
  - `AlertsPage.markRead` no longer builds a query against `undefined`.
  - `CaregiverPage`:
    - resolves patient emails via the new RPC.
    - replaces the per-patient adherence loop with a batched `IN (…)` query.
    - every UPDATE/DELETE now uses `{ count: "exact" }` and surfaces a real error if RLS denies the write.
  - `DashboardPage` streak no longer manufactures synthetic dose rows.
  - Magic-link redirect targets the hash route so tokens stay in the URL fragment.
- Tooling / hygiene:
  - GitHub Actions CI added (`lint`, `typecheck`, `build`, `test`).
  - ESLint v9 (flat config) + `react-hooks` + `react-refresh` + `typescript-eslint`. New `npm run lint` and `npm run typecheck` scripts.
  - `engines.node >= 20` pinned in `package.json`.
  - `public/manifest.webmanifest` + `<link rel="icon">` / `<link rel="manifest">` in `index.html`.
  - `AppShell.handleSignOut` now tolerates network errors.
  - `scripts/post-deploy-smoke.sh` no longer sends the literal `missing` string when `CRON_SECRET` is unset.
  - README updated to reflect actual `vercel.json` and migration list.
- Tests:
  - 19 unit tests passing (added `countTakenDays`, `computeAdherenceByPatient`).

Manual follow-up still required:
- Apply migrations 008 → 011 to production Supabase.
- Set `app.send_reminder_url` and `app.cron_secret` on the production database.
- Rotate Vercel OIDC token (re-run `vercel login`); the value in `.env.local` should be considered exposed.
- Verify in production: caregiver accept/decline/resend now actually persists, and `send-reminder` is invoked once per minute.
