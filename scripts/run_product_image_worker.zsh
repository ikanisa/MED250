#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
PROJECT_REF="uskfnszcdqpcfrhjxitl"
PYTHON="$REPO/.venv-product-images/bin/python"
MIGRATION="$REPO/supabase/migrations/20260716201536_support_23977_automated_product_images.sql"
OFFICIAL_SOURCE_MANIFEST="$REPO/data/product-images/official-source-manifest.json"
OFFICIAL_PDF_PACKSHOT_MANIFEST="$REPO/data/product-images/official-pdf-packshot-candidates.json"
BIODEAL_OFFICIAL_MEDIA_MANIFEST="$REPO/data/product-images/biodeal-official-media-candidates.json"
CACHED_EXACT_MEDICINE_MANIFEST="$REPO/data/product-images/cached-exact-medicine-candidates.json"
CACHED_EXACT_CONSUMER_MANIFEST="$REPO/data/product-images/cached-exact-consumer-candidates.json"
MEDSGO_SITEMAP_MANIFEST="$REPO/data/product-images/medsgo-sitemap-candidates.json"
MYDAWA_SITEMAP_MANIFEST="$REPO/data/product-images/mydawa-sitemap-candidates.json"
CATALOG_SITEMAP_MANIFEST="$REPO/data/product-images/catalog-sitemap-candidates.json"
TRUEMEDS_SITEMAP_MANIFEST="$REPO/data/product-images/truemeds-sitemap-candidates.json"
PHARMEASY_SITEMAP_MANIFEST="$REPO/data/product-images/pharmeasy-sitemap-candidates.json"
CONTRACT_VERSION="2026-07-18.3"
CONTRACT_CACHE="/tmp/med250-product-image-contract-${CONTRACT_VERSION}.ok"
CONTRACT_LOCK="/tmp/med250-product-image-contract.lock"
CONTRACT_CACHE_SECONDS=600
CONTRACT_STALE_GRACE_SECONDS=86400

cd "$REPO"

typeset -a source_manifest_args=(
  --source-manifest "$OFFICIAL_SOURCE_MANIFEST"
)
if [[ -s "$OFFICIAL_PDF_PACKSHOT_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$OFFICIAL_PDF_PACKSHOT_MANIFEST"
  )
fi
if [[ -s "$BIODEAL_OFFICIAL_MEDIA_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$BIODEAL_OFFICIAL_MEDIA_MANIFEST"
  )
fi
if [[ -s "$CACHED_EXACT_MEDICINE_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$CACHED_EXACT_MEDICINE_MANIFEST"
  )
fi
if [[ -s "$CACHED_EXACT_CONSUMER_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$CACHED_EXACT_CONSUMER_MANIFEST"
  )
fi
if [[ -s "$MEDSGO_SITEMAP_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$MEDSGO_SITEMAP_MANIFEST"
  )
fi
if [[ -s "$MYDAWA_SITEMAP_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$MYDAWA_SITEMAP_MANIFEST"
  )
fi
if [[ -s "$CATALOG_SITEMAP_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$CATALOG_SITEMAP_MANIFEST"
  )
fi
if [[ -s "$TRUEMEDS_SITEMAP_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$TRUEMEDS_SITEMAP_MANIFEST"
  )
fi
if [[ -s "$PHARMEASY_SITEMAP_MANIFEST" ]]; then
  source_manifest_args+=(
    --source-manifest "$PHARMEASY_SITEMAP_MANIFEST"
  )
fi
for prefetched_manifest in \
  "$REPO"/data/product-images/prefetched-missing-search-candidates*.json(N); do
  if [[ -s "$prefetched_manifest" ]]; then
    source_manifest_args+=(--source-manifest "$prefetched_manifest")
  fi
done

management_token=$(/usr/bin/security find-generic-password -s "Supabase CLI" -w)
api_keys=$(
  print -r -- "header = \"Authorization: Bearer ${management_token}\"" |
    /usr/bin/curl -fsS \
      --retry 4 \
      --retry-delay 2 \
      --retry-all-errors \
      --connect-timeout 10 \
      --max-time 120 \
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

if [[ -z "$SUPABASE_SECRET_KEY" ]]; then
  print -u2 -- "Could not resolve the Supabase secret key"
  exit 1
fi

repair_contract() {
  local query
  query=$(<"$MIGRATION")
  /usr/bin/jq -n --arg query "$query" '{query:$query}' |
    /usr/bin/curl -fsS \
      --retry 4 \
      --retry-delay 2 \
      --retry-all-errors \
      --connect-timeout 10 \
      --max-time 120 \
      -H "Authorization: Bearer ${management_token}" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
      >/dev/null
}

contract_is_current() {
  local response
  if ! response=$(
    {
      print -r -- "header = \"apikey: ${SUPABASE_SECRET_KEY}\""
      print -r -- "header = \"Authorization: Bearer ${SUPABASE_SECRET_KEY}\""
    } | /usr/bin/curl -fsS \
      --retry 3 \
      --retry-delay 1 \
      --retry-all-errors \
      --connect-timeout 10 \
      --max-time 60 \
      --config - \
      -H "Content-Type: application/json" \
      --data '{}' \
      "${SUPABASE_URL}/rest/v1/rpc/dawanear_backend_contract"
  ); then
    return 2
  fi
  print -r -- "$response" | /usr/bin/jq -e '
      .contract_version == "2026-07-18.3" and
      .product_images.publication_mode == "automated_provenance" and
      .product_images.target_image_count == 23977 and
      .product_images.rights_verified_required == false and
      .product_images.publication_guard_trigger_exists == true and
      .product_images.ddl_guard_event_trigger_exists == true
    ' >/dev/null
}

contract_cache_is_fresh() {
  local modified age
  [[ -f "$CONTRACT_CACHE" ]] || return 1
  [[ "$(<"$CONTRACT_CACHE")" == "$CONTRACT_VERSION" ]] || return 1
  modified=$(/usr/bin/stat -f %m "$CONTRACT_CACHE" 2>/dev/null) || return 1
  age=$(( $(/bin/date +%s) - modified ))
  (( age >= 0 && age < CONTRACT_CACHE_SECONDS ))
}

contract_cache_is_usable_stale() {
  local modified age
  [[ -f "$CONTRACT_CACHE" ]] || return 1
  [[ "$(<"$CONTRACT_CACHE")" == "$CONTRACT_VERSION" ]] || return 1
  modified=$(/usr/bin/stat -f %m "$CONTRACT_CACHE" 2>/dev/null) || return 1
  age=$(( $(/bin/date +%s) - modified ))
  (( age >= 0 && age < CONTRACT_STALE_GRACE_SECONDS ))
}

attest_contract() {
  local lock_age contract_state attempt
  if contract_cache_is_fresh; then
    return 0
  fi
  if [[ -d "$CONTRACT_LOCK" ]]; then
    lock_age=$((
      $(/bin/date +%s) - $(/usr/bin/stat -f %m "$CONTRACT_LOCK" 2>/dev/null || print 0)
    ))
    if (( lock_age > 180 )); then
      /bin/rmdir "$CONTRACT_LOCK" 2>/dev/null || true
    fi
  fi
  if /bin/mkdir "$CONTRACT_LOCK" 2>/dev/null; then
    contract_state=0
    contract_is_current || contract_state=$?
    if (( contract_state == 1 )); then
      if repair_contract; then
        contract_state=0
        contract_is_current || contract_state=$?
      else
        contract_state=2
      fi
    fi
    # A transient RPC outage must not halt a previously attested deployment.
    # Never use this grace path for a real contract mismatch (state 1).
    if (( contract_state == 2 )) && contract_cache_is_usable_stale; then
      contract_state=0
    fi
    if (( contract_state == 0 )); then
      print -r -- "$CONTRACT_VERSION" >"$CONTRACT_CACHE"
    fi
    /bin/rmdir "$CONTRACT_LOCK" 2>/dev/null || true
    return "$contract_state"
  fi
  for attempt in {1..24}; do
    /bin/sleep 5
    if contract_cache_is_fresh; then
      return 0
    fi
    if [[ ! -d "$CONTRACT_LOCK" ]]; then
      attest_contract
      return $?
    fi
  done
  return 2
}

trap 'exit 130' INT TERM HUP

while true; do
  contract_state=0
  attest_contract || contract_state=$?
  if (( contract_state == 2 )); then
    print -u2 -- "Supabase contract endpoint is temporarily unavailable; retrying in 20 seconds"
    /bin/sleep 20
    continue
  fi
  export MED250_BACKEND_CONTRACT_ATTESTED="$CONTRACT_VERSION"
  worker_status=0
  "$PYTHON" "$REPO/scripts/enrich_product_images.py" \
    --publish \
    --target-images 23977 \
    "${source_manifest_args[@]}" \
    --background-engine auto \
    --max-candidates 90 \
    --request-delay 0.75 \
    --timeout 25 \
    "$@" || worker_status=$?
  if (( worker_status == 0 )); then
    exit 0
  fi
  # Focused catalogue fast lanes intentionally leave unavailable products for
  # the next discovery tier. Exit cleanly on the pipeline's audited
  # incomplete status instead of rescanning the same shard forever.
  if [[ "${MED250_WORKER_ONCE:-0}" == "1" && "$worker_status" == "2" ]]; then
    exit 0
  fi
  if [[ "${MED250_WORKER_ONCE:-0}" == "1" ]]; then
    exit "$worker_status"
  fi
  /bin/sleep 20
done
