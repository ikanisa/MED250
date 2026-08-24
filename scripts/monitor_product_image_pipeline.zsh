#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
PROJECT_REF="uskfnszcdqpcfrhjxitl"
MIGRATION="$REPO/supabase/migrations/20260716201536_support_23977_automated_product_images.sql"
REPORT="$REPO/data/product-images/live-progress.json"
VERIFICATION_REPORT="$REPO/data/product-images/live-url-verification.json"
VERIFICATION_LOG="/tmp/med250-product-images-url-verification.log"
VERIFY_EVERY_CYCLES=30

read_validation_policy_version() {
  /usr/bin/awk -F '"' \
    '/^IMAGE_VALIDATION_POLICY_VERSION = / { print $2; exit }' \
    "$REPO/scripts/enrich_product_images.py"
}

cd "$REPO"
mkdir -p "$REPO/data/product-images"

management_token=$(/usr/bin/security find-generic-password -s "Supabase CLI" -w)
secret_key=""

load_secret_key() {
  local api_keys
  [[ -n "$secret_key" ]] && return 0
  if ! api_keys=$(
    print -r -- "header = \"Authorization: Bearer ${management_token}\"" |
      /usr/bin/curl -fsS \
        --retry 4 \
        --retry-delay 2 \
        --retry-all-errors \
        --connect-timeout 10 \
        --max-time 120 \
        --config - \
        "https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true"
  ); then
    return 1
  fi
  secret_key=$(
    print -r -- "$api_keys" |
      /usr/bin/jq -r \
        '[.[] | select(.type == "secret")][0].api_key //
         [.[] | select(.name == "service_role")][0].api_key // empty'
  )
  [[ -n "$secret_key" ]]
}

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
  load_secret_key || return 2
  if ! response=$(
    /usr/bin/curl -fsS \
      --retry 3 \
      --retry-delay 1 \
      --retry-all-errors \
      --connect-timeout 10 \
      --max-time 60 \
      -H "apikey: ${secret_key}" \
      -H "Authorization: Bearer ${secret_key}" \
      -H "Content-Type: application/json" \
      --data '{}' \
      "https://${PROJECT_REF}.supabase.co/rest/v1/rpc/dawanear_backend_contract"
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

write_progress() {
  local query response temporary policy_validated checkpoint checkpoint_count
  local validation_policy_version
  validation_policy_version=$(read_validation_policy_version)
  if [[ -z "$validation_policy_version" ]]; then
    print -u2 "Could not read IMAGE_VALIDATION_POLICY_VERSION from pipeline"
    return 1
  fi
  query="with ranked_products as (
    select
      id,
      image_url,
      case
        when row_number() over (order by id) <= 682 then 6
        else 5
      end as target_count
    from public.dawanear_all_product_catalog
  ), gallery_counts as (
    select product_id, count(*)::integer as image_count
    from public.dawanear_product_images
    where approved and background_removed
    group by product_id
  ), product_summary as (
    select
      count(*)::bigint as live_products,
      count(*) filter (where product.image_url is not null)::bigint
        as linked_products,
      count(*) filter (where coalesce(gallery.image_count, 0) >= 3)::bigint
        as products_with_at_least_three,
      count(*) filter (
        where coalesce(gallery.image_count, 0) = product.target_count
      )::bigint as products_with_final_allocation,
      count(*) filter (
        where coalesce(gallery.image_count, 0) >= 3
          and coalesce(gallery.image_count, 0) < product.target_count
      )::bigint as products_staged_below_final_allocation,
      count(*) filter (where coalesce(gallery.image_count, 0) < 3)::bigint
        as products_missing_minimum_gallery,
      sum(greatest(
        product.target_count - coalesce(gallery.image_count, 0),
        0
      ))::bigint as allocation_image_gap
    from ranked_products as product
    left join gallery_counts as gallery on gallery.product_id = product.id
  ), image_summary as (
    select count(*)::bigint as approved_images
    from public.dawanear_product_images
    where approved and background_removed
  )
  select jsonb_build_object(
    'checked_at', clock_timestamp(),
    'target_images', 23977,
    'approved_images', image_summary.approved_images,
    'remaining_images', greatest(23977 - image_summary.approved_images, 0),
    'live_products', product_summary.live_products,
    'linked_products', product_summary.linked_products,
    'products_with_at_least_three',
      product_summary.products_with_at_least_three,
    'products_with_final_allocation',
      product_summary.products_with_final_allocation,
    'products_staged_below_final_allocation',
      product_summary.products_staged_below_final_allocation,
    'products_missing_minimum_gallery',
      product_summary.products_missing_minimum_gallery,
    'allocation_image_gap', product_summary.allocation_image_gap
  ) as progress
  from product_summary cross join image_summary;"
  response=$(
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
        "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"
  )
  temporary="${REPORT}.tmp"
  print -r -- "$response" | /usr/bin/jq '.[0].progress' >"$temporary"
  policy_validated=0
  for checkpoint in "$REPO"/data/product-images/checkpoint-worker-*.sqlite3(N); do
    [[ -f "$checkpoint" ]] || continue
    checkpoint_count=$(
      /usr/bin/sqlite3 "$checkpoint" \
        "select count(*) from product_image_runs
         where status = 'published'
           and json_extract(payload, '$.validation_policy_version') =
             '${validation_policy_version}';" \
        2>/dev/null || print 0
    )
    policy_validated=$((policy_validated + ${checkpoint_count:-0}))
  done
  /usr/bin/jq \
    --arg policy "$validation_policy_version" \
    --argjson validated "$policy_validated" \
    '. + {
      validation_policy_version: $policy,
      policy_validated_products: $validated,
      policy_revalidation_remaining:
        ([.linked_products - $validated, 0] | max)
    }' \
    "$temporary" >"${temporary}.policy"
  /bin/mv "${temporary}.policy" "$temporary"
  if [[ -s "$VERIFICATION_REPORT" ]]; then
    /usr/bin/jq \
      --slurpfile verification "$VERIFICATION_REPORT" \
      '. + {
        url_verification_checked_at:
          ($verification[0].checked_at // null),
        broken_public_urls:
          ($verification[0].broken_public_url_count // null),
        broken_product_ids:
          ($verification[0].broken_product_ids // [])
      }' \
      "$temporary" >"${temporary}.verified"
    /bin/mv "${temporary}.verified" "$temporary"
  fi
  /bin/mv "$temporary" "$REPORT"
}

verify_public_urls() {
  load_secret_key || return 0
  SUPABASE_URL="https://${PROJECT_REF}.supabase.co" \
  SUPABASE_SECRET_KEY="$secret_key" \
    "$REPO/.venv-product-images/bin/python" \
      "$REPO/scripts/enrich_product_images.py" \
      --publish \
      --verify-only \
      --target-images 23977 \
      --timeout 25 \
      --report "$VERIFICATION_REPORT" \
      >>"$VERIFICATION_LOG" 2>&1 || true
}

public_url_verification_is_active() {
  /usr/bin/pgrep -f \
    '[e]nrich_product_images.py.*--verify-only' \
    >/dev/null 2>&1
}

public_url_verification_is_fresh() {
  local modified age
  [[ -s "$VERIFICATION_REPORT" ]] || return 1
  modified=$(/usr/bin/stat -f %m "$VERIFICATION_REPORT" 2>/dev/null) || return 1
  age=$(( $(/bin/date +%s) - modified ))
  (( age >= 0 && age < VERIFY_EVERY_CYCLES * 60 ))
}

trap 'exit 0' INT TERM HUP

cycle=0
while true; do
  # Progress drives the persistent launcher's coverage-to-final transition, so
  # refresh it before any slower contract repair or public-URL audit.
  if ! write_progress; then
    print -u2 -- "Could not refresh pipeline progress; will retry next cycle"
  fi
  contract_state=0
  contract_is_current || contract_state=$?
  if (( contract_state == 1 )); then
    if ! repair_contract; then
      print -u2 -- "Supabase contract repair failed; will retry next cycle"
    fi
  elif (( contract_state == 2 )); then
    print -u2 -- "Supabase contract endpoint is temporarily unavailable"
  fi
  if (( cycle % VERIFY_EVERY_CYCLES == 0 )) &&
    ! public_url_verification_is_active &&
    ! public_url_verification_is_fresh; then
    # A full public-URL audit can take several minutes at 23,977 images. Keep
    # it single-flight and asynchronous so one-minute progress refreshes and
    # the coverage-to-final launcher transition never wait behind HEAD checks.
    verify_public_urls &
  fi
  cycle=$((cycle + 1))
  /bin/sleep 60
done
