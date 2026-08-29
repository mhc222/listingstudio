#!/usr/bin/env bash
# One-shot: push production env vars from .env.local to the linked Vercel project.
# Run from the repo root: bash scripts/vercel-env-push.sh
# (Claude's permission classifier blocks piping secrets from .env.local, so this is run by hand.)
set -euo pipefail
cd "$(dirname "$0")/.."

VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  FAL_KEY
  ANTHROPIC_API_KEY
  ANTHROPIC_WORKSPACE_ID
  CRON_SECRET
)
# NEXT_PUBLIC_APP_URL is set separately after the first deploy (needs the prod domain).
# LOCAL_IMAGING_BASE_URL deliberately not pushed — local stub only.

for name in "${VARS[@]}"; do
  val="$(grep -m1 "^${name}=" .env.local | cut -d= -f2-)"
  if [ -z "$val" ]; then
    echo "SKIP (empty in .env.local): $name"
    continue
  fi
  printf '%s' "$val" | vercel env add "$name" production --force >/dev/null
  echo "pushed: $name"
done
echo "Done. Now deploy: vercel deploy --prod --yes"
