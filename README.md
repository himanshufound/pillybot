# Pillybot Frontend

Pillybot is a React 18 + Vite frontend backed by Supabase for auth, storage, database access, and Edge Functions.

## Stack

- React 18
- Vite
- Tailwind CSS v4
- Supabase
- Vercel

## Pages

- `/auth`
- `/`
- `/add`
- `/verify`
- `/parse`
- `/alerts`
- `/caregiver`
- `/settings`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a local env file from the example:

```bash
cp .env.example .env.local
```

3. Fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`
- `VITE_BASE_PATH` (optional, defaults to `/`; set to `/functions/v1/static-site/` only when building for the Supabase `static-site` function)

4. Start the app:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Supabase

### Migrations

Apply in numerical order:

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_storage.sql`
- `supabase/migrations/004_schema_alignment.sql`
- `supabase/migrations/005_profile_email_sync.sql`
- `supabase/migrations/006_edge_rate_limit.sql`
- `supabase/migrations/007_caregiver_expiry_and_edge_events.sql`
- `supabase/migrations/008_caregiver_links_update_policy.sql` — adds the missing UPDATE RLS policies (without these the patient cannot accept/decline and the caregiver cannot resend)
- `supabase/migrations/009_find_profile_by_email.sql` — `find_profile_id_by_email(email)` RPC used by caregiver linking
- `supabase/migrations/010_send_reminder_cron.sql` — schedules the `send-reminder` function once per minute via pg_cron + pg_net
- `supabase/migrations/011_dose_logs_index_and_rate_limit_gc.sql` — partial index for the reminder scan and a daily rate-limit GC job

After applying `010_send_reminder_cron.sql`, run on the production database:

```sql
alter database postgres set app.send_reminder_url = 'https://<project-ref>.functions.supabase.co/send-reminder';
alter database postgres set app.cron_secret       = '<the same value as the CRON_SECRET edge secret>';
```

### Edge Functions

- `verify-pill`
- `parse-prescription`
- `send-reminder`
- `static-site`

### Required Supabase secrets

Set these in Supabase for the Edge Functions that need them:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (optional)

### Storage

- `site` (public web app assets)
- `pill-images`
- `prescription-temp`

## Vercel

Add these project environment variables in Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY`

`vercel.json` configures SPA rewrites, long-lived caching for `/assets/*`, no-cache for `/sw.js`, and a strict security header set (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP, X-Content-Type-Options).

## GitHub push

If GitHub CLI is not authenticated yet:

```bash
gh auth login -h github.com -p https -w
```

After login:

```bash
git push -u origin main
```

## Release flow

```bash
bash scripts/build-release.sh
SUPABASE_PROJECT_REF=your-ref bash scripts/deploy-functions.sh
STATIC_SITE_URL=https://... APP_BASE_URL=https://... SUPABASE_FUNCTIONS_BASE_URL=https://... CRON_SECRET=... bash scripts/post-deploy-smoke.sh
```

See `RELEASE_CHECKLIST.md` for the full manual checklist.
