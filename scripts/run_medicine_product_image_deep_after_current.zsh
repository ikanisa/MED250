#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
CURRENT_PATTERN="$REPO/scripts/run_medicine_product_image_fastlane.zsh"

# The first two-candidate pass owns all CPU cores.  Wait without competing,
# then reuse its checkpoints so completed galleries are skipped and rejected
# candidate URLs stay rejected.  Candidates 3-6 are therefore a true deeper
# fallback, not a repeat of the first sweep.
while /usr/bin/pgrep -f "$CURRENT_PATTERN" >/dev/null 2>&1; do
  /bin/sleep 15
done

"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_medicine_candidate_manifest.py" \
  >>/tmp/med250-cached-medicine-manifest.log 2>&1
"$REPO/.venv-product-images/bin/python" \
  "$REPO/scripts/build_cached_consumer_candidate_manifest.py" \
  >>/tmp/med250-cached-consumer-manifest.log 2>&1

export MED250_MEDICINE_CHECKPOINT_SUFFIX="v50-thread1-c2"
export MED250_MEDICINE_RUN_SUFFIX="v50-thread1-deep-c6-fastwebp"
export MED250_MEDICINE_MAX_CANDIDATES=6

fastlane_status=0
"$REPO/scripts/run_medicine_product_image_fastlane.zsh" || fastlane_status=$?

typeset -a generic_children=()
for child in $(/usr/bin/pgrep -f \
  'enrich_product_images.py --publish --target-images 23977.*checkpoint-worker-' \
  2>/dev/null || true); do
  if kill -STOP "$child" 2>/dev/null; then
    generic_children+=("$child")
  fi
done

# Three cached seeds came from a social discussion rather than a product
# listing. Reprocess only those product IDs under the current domain exclusion
# rules. Publication remains atomic: a failed cleanup leaves the live gallery
# unchanged.
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

# The generic wrapper processes predate the fast-lane improvements. Their
# launcher parents are persistent, so terminate only the Python children; the
# wrappers will restart them on the current code after their normal backoff.
for child in "${generic_children[@]}"; do
  kill -TERM "$child" 2>/dev/null || true
  kill -CONT "$child" 2>/dev/null || true
done

exit "$fastlane_status"
