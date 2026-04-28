# Release Checklist

1. Run `bash scripts/build-release.sh`.
2. Apply Supabase migrations through your linked CLI or MCP session, including `007_caregiver_expiry_and_edge_events.sql`.
3. Confirm required Supabase secrets exist:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL` (optional)
4. Deploy functions with `SUPABASE_PROJECT_REF=... bash scripts/deploy-functions.sh`.
5. Upload `dist/` to the public `site` bucket if you serve the app from `static-site`.
6. Verify Vercel env vars:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VAPID_PUBLIC_KEY`
7. Run `STATIC_SITE_URL=... APP_BASE_URL=... SUPABASE_FUNCTIONS_BASE_URL=... CRON_SECRET=... bash scripts/post-deploy-smoke.sh`.
8. In Supabase logs, confirm:
   - `send-reminder` emits `reminder_sent`, `caregiver_alert_sent`, or `reminder_error` rows.
   - `parse-prescription` emits `rate_limit_hit` and `parse_failure` rows when appropriate.
   - `verify-pill` emits `rate_limit_hit` and `verification_failure` rows when appropriate.
9. In the authenticated app, verify:
   - Caregiver requests expire after 7 days, can be resent, and can be removed.
   - Notification settings show permission state, support re-register, and can send a test notification.
   - Low-confidence parse/verify responses show cautionary UI.
