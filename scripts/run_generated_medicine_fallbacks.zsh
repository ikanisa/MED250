#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
PROJECT_REF="uskfnszcdqpcfrhjxitl"
PYTHON="$REPO/.venv-product-images/bin/python"
CONTRACT_VERSION="2026-07-23.1"
CONTRACT_CACHE="/tmp/med250-product-image-contract-${CONTRACT_VERSION}.ok"

cd "$REPO"
management_token=$(/usr/bin/security find-generic-password -s "Supabase CLI" -w)
api_keys=$(
  print -r -- "header = \"Authorization: Bearer ${management_token}\"" |
    /usr/bin/curl -fsS \
      --retry 6 \
      --retry-delay 3 \
      --retry-all-errors \
      --connect-timeout 10 \
      --max-time 180 \
      --config - \
      "https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true"
)
export SUPABASE_SECRET_KEY=$(
  print -r -- "$api_keys" |
    /usr/bin/jq -r \
      '[.[] | select(.type == "secret")][0].api_key //
       [.[] | select(.name == "service_role")][0].api_key // empty'
)
export SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
export PYTHONPATH="$REPO/scripts"
export MED250_BACKEND_CONTRACT_ATTESTED="$CONTRACT_VERSION"

if [[ -z "$SUPABASE_SECRET_KEY" ]]; then
  print -u2 -- "Could not resolve the Supabase secret key"
  exit 1
fi

if [[ ! -s "$CONTRACT_CACHE" ]] ||
  [[ "$(<"$CONTRACT_CACHE")" != "$CONTRACT_VERSION" ]]; then
  print -u2 -- "The verified Supabase contract attestation cache is missing"
  exit 1
fi

trap 'exit 130' INT TERM

while true; do
  /usr/bin/touch "$CONTRACT_CACHE"
  run_status=0
  "$PYTHON" "$REPO/scripts/publish_generated_medicine_fallbacks.py" \
    --target-images 23977 \
    --workers 14 \
    --timeout 90 \
    --checkpoint \
      "$REPO/data/product-images/checkpoint-generated-medicine-fallback.sqlite3" \
    --report \
      "$REPO/data/product-images/report-generated-medicine-fallback.json" || run_status=$?
  if (( run_status == 0 )); then
    exit 0
  fi
  print -u2 -- "Generated medicine batch had retryable failures; retrying in 15 seconds"
  /bin/sleep 15
done
