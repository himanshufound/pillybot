#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${STATIC_SITE_URL:-}" ]; then
  echo "STATIC_SITE_URL is required."
  exit 1
fi

echo "==> Smoke testing static site"
curl -fsS -I "$STATIC_SITE_URL"

if [ -n "${APP_BASE_URL:-}" ]; then
  echo "==> Smoke testing app base URL"
  curl -fsS -I "$APP_BASE_URL"
fi

if [ -n "${SUPABASE_FUNCTIONS_BASE_URL:-}" ]; then
  if [ -z "${CRON_SECRET:-}" ]; then
    echo "==> Skipping send-reminder smoke (CRON_SECRET not set)"
  else
    echo "==> Smoke testing send-reminder auth path"
    # We expect a 200 with summary counters when the secret is correct.
    # Suppress body to keep credentials out of CI logs.
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      -H "x-cron-secret: ${CRON_SECRET}" \
      "${SUPABASE_FUNCTIONS_BASE_URL%/}/send-reminder")
    echo "send-reminder responded with HTTP ${HTTP_STATUS}"
    if [ "$HTTP_STATUS" != "200" ]; then
      echo "Warning: send-reminder did not respond 200; check edge logs."
    fi
  fi
fi

cat <<'EOF'
Manual follow-up:
- Review Supabase Edge Function logs for parse-prescription, verify-pill, send-reminder, and static-site.
- Confirm new rows appear in public.edge_function_events after a reminder run and after parse/verify failures.
- Verify caregiver request expiry/resend/remove flows against a real authenticated session.
EOF
