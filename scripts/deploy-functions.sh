#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROJECT_REF is required."
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is not installed. Install/auth it, then rerun this script."
  exit 1
fi

echo "==> Deploying Edge Functions to ${SUPABASE_PROJECT_REF}"
supabase functions deploy verify-pill --project-ref "$SUPABASE_PROJECT_REF" --use-api
supabase functions deploy parse-prescription --project-ref "$SUPABASE_PROJECT_REF" --use-api
supabase functions deploy send-reminder --project-ref "$SUPABASE_PROJECT_REF" --use-api --no-verify-jwt
supabase functions deploy static-site --project-ref "$SUPABASE_PROJECT_REF" --use-api --no-verify-jwt

echo
echo "Edge Function deploy commands completed."
