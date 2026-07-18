#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
UPSTREAM_PID="${1:-}"
MANIFEST_MAX_AGE_SECONDS=10800
if [[ -z "$UPSTREAM_PID" || "$UPSTREAM_PID" != <-> ]]; then
  print -u2 -- "Usage: $0 <upstream-chain-pid>"
  exit 2
fi

# The upstream chain owns medicine tier 2 and the consumer exact-ASIN pass.
# Verify both PID and command identity: a transient/reused PID must neither
# release this waiter early nor keep it blocked on an unrelated process.
upstream_chain_is_active() {
  /bin/ps -p "$UPSTREAM_PID" -o command= 2>/dev/null |
    /usr/bin/grep -Fq \
      "$REPO/scripts/run_product_image_provenance_cleanup_after_fastlane.zsh"
}
while upstream_chain_is_active; do
  /bin/sleep 15
done

manifest_is_fresh() {
  local path="$1" modified age
  [[ -s "$path" ]] || return 1
  modified=$(/usr/bin/stat -f %m "$path" 2>/dev/null) || return 1
  age=$(( $(/bin/date +%s) - modified ))
  (( age >= 0 && age < MANIFEST_MAX_AGE_SECONDS ))
}

CACHED_MEDICINE="$REPO/data/product-images/cached-exact-medicine-candidates.json"
MEDSGO="$REPO/data/product-images/medsgo-sitemap-candidates.json"
MYDAWA="$REPO/data/product-images/mydawa-sitemap-candidates.json"

if ! manifest_is_fresh "$CACHED_MEDICINE"; then
  "$REPO/.venv-product-images/bin/python" \
    "$REPO/scripts/build_cached_medicine_candidate_manifest.py" \
    >>/tmp/med250-cached-medicine-manifest.log 2>&1
fi
if ! manifest_is_fresh "$MEDSGO"; then
  if ! "$REPO/.venv-product-images/bin/python" \
    "$REPO/scripts/build_medsgo_sitemap_candidate_manifest.py" \
    >>/tmp/med250-medsgo-sitemap-manifest.log 2>&1; then
    print -u2 -- "MedsGo sitemap manifest refresh failed; continuing with cached sources"
  fi
fi
if ! manifest_is_fresh "$MYDAWA"; then
  if ! "$REPO/.venv-product-images/bin/python" \
    "$REPO/scripts/build_mydawa_sitemap_candidate_manifest.py" \
    >>/tmp/med250-mydawa-sitemap-manifest.log 2>&1; then
    print -u2 -- "MYDAWA sitemap manifest refresh failed; continuing with cached sources"
  fi
fi

export MED250_MEDICINE_CHECKPOINT_SUFFIX="v50-thread1-c2"
export MED250_MEDICINE_RUN_SUFFIX="v50-thread1-tier3-c6-fastwebp"
export MED250_MEDICINE_MAX_CANDIDATES=6
"$REPO/scripts/run_medicine_product_image_fastlane.zsh"
