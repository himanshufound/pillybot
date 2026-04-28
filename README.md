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

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_storage.sql`
- `supabase/migrations/004_schema_alignment.sql`
- `supabase/migrations/005_profile_email_sync.sql`
- `supabase/migrations/006_edge_rate_limit.sql`

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

`vercel.json` is already configured with SPA rewrites and security headers.

## GitHub push

If GitHub CLI is not authenticated yet:

```bash
gh auth login -h github.com -p https -w
```

After login:

```bash
git push -u origin main
```
