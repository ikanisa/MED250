#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
UPSTREAM_PID="${1:-}"
EXTERNAL_MANIFEST_MAX_AGE=21600
if [[ -z "$UPSTREAM_PID" || "$UPSTREAM_PID" != <-> ]]; then
  print -u2 -- "Usage: $0 <upstream-chain-pid>"
  exit 2
fi
while /bin/kill -0 "$UPSTREAM_PID" 2>/dev/null; do
  /bin/sleep 15
done
manifest_is_fresh() {
  local path="$1"
  local modified age
  [[ -s "$path" ]] || return 1
  modified=$(/usr/bin/stat -f %m "$path" 2>/dev/null) || return 1
  age=$(( $(/bin/date +%s) - modified ))
  (( age >= 0 && age < EXTERNAL_MANIFEST_MAX_AGE ))
}
"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_medicine_candidate_manifest.py" \
  >>/tmp/med250-cached-medicine-manifest.log 2>&1
"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_consumer_candidate_manifest.py" \
  >>/tmp/med250-cached-consumer-manifest.log 2>&1
if ! manifest_is_fresh \
  "$REPO/data/product-images/medsgo-sitemap-candidates.json"; then
  if ! "$REPO/.venv-product-images/bin/python" \
    "$REPO/scripts/build_medsgo_sitemap_candidate_manifest.py" \
    >>/tmp/med250-medsgo-sitemap-manifest.log 2>&1; then
    print -u2 -- "MedsGo sitemap manifest refresh failed; continuing cleanup"
  fi
fi
if ! manifest_is_fresh \
  "$REPO/data/product-images/mydawa-sitemap-candidates.json"; then
  if ! "$REPO/.venv-product-images/bin/python" \
    "$REPO/scripts/build_mydawa_sitemap_candidate_manifest.py" \
    >>/tmp/med250-mydawa-sitemap-manifest.log 2>&1; then
    print -u2 -- "MYDAWA sitemap manifest refresh failed; continuing cleanup"
  fi
fi
exec "$REPO/scripts/run_product_image_excluded_source_cleanup.zsh"
