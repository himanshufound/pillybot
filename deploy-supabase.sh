#!/usr/bin/env bash
set -euo pipefail

# deploy-supabase.sh
# Safe helper to build and either print manual Supabase steps or run them
# Usage:
#   SUPABASE_PROJECT_REF=your-ref ./deploy-supabase.sh
# (It will prompt before performing remote actions.)

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash scripts/build-release.sh

echo "\nBuild complete. dist/ refreshed.\n"

# Remind about secret rotation
cat <<'NOTE'
IMPORTANT: Do NOT paste service_role keys into chat. If you shared any secret earlier, rotate/revoke it immediately and replace with a new key stored in your CI/secrets manager.
NOTE

# If SUPABASE_PROJECT_REF not set, print manual commands and exit
if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROJECT_REF is not set. Printing recommended manual steps below."
  cat <<'EOF'

Recommended manual steps (replace placeholders):

# MANUAL REQUIRED: Apply DB migrations (use the Supabase MCP tools or a linked CLI session):
#   - 001_initial_schema
#   - 002_storage
#   - 004_schema_alignment
#   - 005_profile_email_sync
#   - 006_edge_rate_limit
#   - 007_caregiver_expiry_and_edge_events
# The project already includes a remote site bucket migration.

# MANUAL REQUIRED: Deploy Edge Functions:
#   SUPABASE_PROJECT_REF=your-ref bash scripts/deploy-functions.sh

# MANUAL REQUIRED: Upload static web assets if you are serving from the public site bucket:
#   supabase storage cp -r dist/. ss:///site

# MANUAL REQUIRED: Set required project env vars in Supabase (in Settings > API or Functions):
#   SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ANTHROPIC_API_KEY

# MANUAL REQUIRED: Configure Vercel project env vars:
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_VAPID_PUBLIC_KEY
#
# MANUAL REQUIRED: Verify:
#   STATIC_SITE_URL=https://... APP_BASE_URL=https://... SUPABASE_FUNCTIONS_BASE_URL=https://... CRON_SECRET=... bash scripts/post-deploy-smoke.sh
#   - Check Edge Function logs in Supabase dashboard
#   - Review RELEASE_CHECKLIST.md

EOF
  exit 0
fi

# If we have a project ref, ask for confirmation before doing remote changes
read -r -p "SUPABASE_PROJECT_REF is set to '$SUPABASE_PROJECT_REF'. Proceed with applying migrations and deploying functions? (y/N) " CONFIRM
if [ "$CONFIRM" != "y" ]; then
  echo "Aborted by user. No remote changes made."
  exit 0
fi

echo "Applying migrations and deploying functions is best done with the Supabase MCP tools for this project."
echo "If you want the CLI workflow instead, link the project first and then run:"
echo "  SUPABASE_PROJECT_REF=$SUPABASE_PROJECT_REF bash scripts/deploy-functions.sh"
