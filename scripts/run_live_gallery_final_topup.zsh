#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
RUN_SUFFIX="${MED250_LIVE_TOPUP_RUN_SUFFIX:-v63}"
typeset -a OFFSETS=(0 1165 2330 3495)
typeset -a LIMITS=(1165 1165 1165 1164)

cd "$REPO"
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1

typeset -a worker_pids=()
typeset -i index failures=0
for index in {0..3}; do
  MED250_WORKER_ONCE=1 /usr/bin/nice -n 5 \
    "$REPO/scripts/run_product_image_worker.zsh" \
    --offset "${OFFSETS[$(( index + 1 ))]}" \
    --limit "${LIMITS[$(( index + 1 ))]}" \
    --publish-final-allocation \
    --top-up-from-live-gallery \
    --skip-existing-final \
    --ignore-retry-cooldown \
    --request-delay 0 \
    --download-workers 3 \
    --checkpoint "$REPO/data/product-images/checkpoint-live-topup-${index}-${RUN_SUFFIX}.sqlite3" \
    --report "$REPO/data/product-images/report-live-topup-${index}-${RUN_SUFFIX}.json" \
    >"/tmp/med250-live-topup-${index}-${RUN_SUFFIX}.log" 2>&1 &
  worker_pids+=("$!")
  /bin/sleep 2
done

for child in "${worker_pids[@]}"; do
  if ! wait "$child"; then
    (( failures += 1 ))
  fi
done

if (( failures )); then
  print -u2 -- "Live-gallery top-up finished with ${failures} failed worker process(es)"
  exit 1
fi
print -- "Live-gallery final top-up finished"
