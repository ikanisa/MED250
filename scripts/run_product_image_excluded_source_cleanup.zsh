#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"

cd "$REPO"

typeset -a paused_children=()
for child in $(/usr/bin/pgrep -f \
  'enrich_product_images.py --publish --target-images 23977.*checkpoint-worker-' \
  2>/dev/null || true); do
  if kill -STOP "$child" 2>/dev/null; then
    paused_children+=("$child")
  fi
done

resume_generic_workers() {
  local child
  for child in "${paused_children[@]}"; do
    kill -CONT "$child" 2>/dev/null || true
  done
}
interrupt_cleanup() {
  trap - EXIT INT TERM HUP
  resume_generic_workers
  exit 130
}
trap resume_generic_workers EXIT
trap interrupt_cleanup INT TERM HUP

export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1

typeset -a worker_pids=()
launch_cleanup_worker() {
  local index="$1"
  shift
  typeset -a product_args=()
  local product_id
  for product_id in "$@"; do
    product_args+=(--product-id "$product_id")
  done
  MED250_WORKER_ONCE=1 /usr/bin/nice -n 5 \
    "$REPO/scripts/run_product_image_worker.zsh" \
    "${product_args[@]}" \
    --force \
    --no-public-search \
    --single-query-search-fastlane \
    --ignore-retry-cooldown \
    --publish-final-allocation \
    --background-engine border \
    --max-candidates 20 \
    --request-delay 0 \
    --checkpoint "$REPO/data/product-images/checkpoint-excluded-source-cleanup-${index}-v50.sqlite3" \
    --report "$REPO/data/product-images/report-excluded-source-cleanup-${index}-v50.json" \
    >"/tmp/med250-excluded-source-cleanup-${index}-v50.log" 2>&1 &
  worker_pids+=("$!")
}

launch_cleanup_worker 0 \
  AMZ-B001KYU1H2 AMZ-B00B29WMLI AMZ-B00DKF7XPW AMZ-B00FWG105G \
  AMZ-B00FWG11BE AMZ-B00FWG12RW AMZ-B00RD97M16 AMZ-B078WPCDV1 \
  AMZ-B07DGNQZ4L
launch_cleanup_worker 1 \
  AMZ-B07N13W76L AMZ-B07TTLVCYK AMZ-B08L65FCF6 AMZ-B097CM53JM \
  AMZ-B09JPHMGMB AMZ-B09JPJ9WHH AMZ-B09P4717BY AMZ-B0B4W95FPQ \
  AMZ-B0B8PHGCDV
launch_cleanup_worker 2 \
  AMZ-B0BSD56JNV AMZ-B0CSFWXM1B AMZ-B0CT2CLWMC AMZ-B0D14XSNDJ \
  AMZ-B0FJNTBZXY AMZ-B0GVTY23Y6 rwanda-fda-hm-0488 \
  rwanda-fda-hm-0925
launch_cleanup_worker 3 \
  rwanda-fda-hm-0995 rwanda-fda-hm-1000 rwanda-fda-hm-1053 \
  rwanda-fda-hm-1289 rwanda-fda-hm-1341 rwanda-fda-hm-1383 \
  rwanda-fda-hm-1908 rwanda-fda-hm-2043

typeset -i failures=0
for child in "${worker_pids[@]}"; do
  if ! wait "$child"; then
    (( failures += 1 ))
  fi
done

resume_generic_workers
trap - EXIT INT TERM HUP
if (( failures )); then
  print -u2 -- "Excluded-source cleanup had ${failures} failed worker process(es)"
  exit 1
fi
print -- "Excluded-source cleanup finished; generic workers resumed"
