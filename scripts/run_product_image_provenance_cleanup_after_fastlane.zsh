#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
FASTLANE_PATTERN="$REPO/scripts/run_medicine_product_image_fastlane.zsh"

while /usr/bin/pgrep -f "$FASTLANE_PATTERN" >/dev/null 2>&1; do
  /bin/sleep 15
done
/bin/sleep 5

typeset -a generic_children=()
for child in $(/usr/bin/pgrep -f \
  'enrich_product_images.py --publish --target-images 23977.*checkpoint-worker-' \
  2>/dev/null || true); do
  if kill -STOP "$child" 2>/dev/null; then
    generic_children+=("$child")
  fi
done

MED250_WORKER_ONCE=1 "$REPO/scripts/run_product_image_worker.zsh" \
  --product-id rwanda-fda-hm-0426 \
  --product-id rwanda-fda-hm-0983 \
  --product-id rwanda-fda-hm-2361 \
  --force \
  --no-public-search \
  --single-query-search-fastlane \
  --ignore-retry-cooldown \
  --publish-final-allocation \
  --background-engine border \
  --max-candidates 12 \
  --request-delay 0 \
  --checkpoint "$REPO/data/product-images/checkpoint-provenance-cleanup-v50.sqlite3" \
  --report "$REPO/data/product-images/report-provenance-cleanup-v50.json" \
  >>/tmp/med250-product-image-provenance-cleanup.log 2>&1 || true

for child in "${generic_children[@]}"; do
  kill -TERM "$child" 2>/dev/null || true
  kill -CONT "$child" 2>/dev/null || true
done

"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_medicine_candidate_manifest.py" \
  >>/tmp/med250-cached-medicine-manifest.log 2>&1
"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_consumer_candidate_manifest.py" \
  >>/tmp/med250-cached-consumer-manifest.log 2>&1

export MED250_MEDICINE_CHECKPOINT_SUFFIX="v50-thread1-c2"
export MED250_MEDICINE_RUN_SUFFIX="v50-thread1-tier2-c6-fastwebp"
export MED250_MEDICINE_MAX_CANDIDATES=6
medicine_status=0
"$REPO/scripts/run_medicine_product_image_fastlane.zsh" || medicine_status=$?

consumer_status=0
"$REPO/scripts/run_amazon_product_image_fastlane.zsh" --search-fallback || \
  consumer_status=$?

if (( medicine_status )); then
  exit "$medicine_status"
fi
exit "$consumer_status"
