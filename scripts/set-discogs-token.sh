#!/usr/bin/env bash
# Puts the Discogs personal token from the clipboard into .env.local and the
# Vercel production env, then redeploys. Run by the owner after copying the
# token on discogs.com/settings/developers. The value is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="$(pbpaste | tr -d '[:space:]')"
if ! [[ "$TOKEN" =~ ^[A-Za-z0-9]{30,60}$ ]]; then
  echo "❌ У буфері не токен Discogs. Скопіюй його на сторінці discogs.com/settings/developers і запусти ще раз."
  exit 1
fi

# .env.local: replace or append
if grep -q '^DISCOGS_TOKEN=' .env.local 2>/dev/null; then
  sed -i '' '/^DISCOGS_TOKEN=/d' .env.local
fi
echo "DISCOGS_TOKEN=$TOKEN" >> .env.local
echo "✅ .env.local"

# Vercel production env (remove an old value first, ignore if absent)
npx vercel env rm DISCOGS_TOKEN production --yes >/dev/null 2>&1 || true
printf '%s' "$TOKEN" | npx vercel env add DISCOGS_TOKEN production >/dev/null
echo "✅ Vercel env (production)"

# Check the token works, then redeploy so the cron sees it
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Discogs token=$TOKEN" -H "User-Agent: NinjaDigger/1.0" "https://api.discogs.com/database/search?q=Drumcode&type=label&per_page=1")
echo "Discogs API: HTTP $code"
npx vercel --prod --yes >/dev/null 2>&1 && echo "✅ Прод перезапущено — Discogs увімкнеться з наступним прогоном крону"
