#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
CHECKPOINT_SUFFIX="${MED250_MEDICINE_CHECKPOINT_SUFFIX:-v50-thread1-c2}"
RUN_SUFFIX="${MED250_MEDICINE_RUN_SUFFIX:-$CHECKPOINT_SUFFIX}"
MAX_CANDIDATES="${MED250_MEDICINE_MAX_CANDIDATES:-2}"
typeset -a publication_args=(--skip-existing-final --coverage-only)
typeset -a discovery_args=(--no-public-search --single-query-search-fastlane)
if [[ "${MED250_COVERAGE_FIRST:-1}" != "1" ]]; then
  publication_args=(--skip-existing-final --publish-final-allocation)
fi
if [[ "${MED250_MEDICINE_CATALOG_ONLY:-0}" == "1" ]]; then
  discovery_args=(--no-public-search)
fi
MEDICINE_OFFSET=2200
MEDICINE_PRODUCT_COUNT=2459
typeset -a SHARD_LIMITS=(246 246 246 246 246 246 246 246 246 245)

typeset -i covered=0
for limit in "${SHARD_LIMITS[@]}"; do
  (( covered += limit ))
done
if (( covered != MEDICINE_PRODUCT_COUNT )); then
  print -u2 -- "Medicine fast-lane shards do not cover exactly 2,459 products"
  exit 2
fi

cd "$REPO"

typeset -a paused_wrappers=()
for wrapper in $(/usr/bin/pgrep -f \
  '[/]scripts/run_product_image_worker.zsh --offset .*checkpoint-worker-' \
  2>/dev/null || true); do
  if kill -STOP "$wrapper" 2>/dev/null; then
    paused_wrappers+=("$wrapper")
  fi
done

# A stopped Python process retains its OCR/rembg model memory. Stop the
# persistent wrappers first, then terminate only their current children so the
# ten fast-lane workers can use the released memory. Resuming the wrappers at
# exit causes their normal retry loop to start fresh workers on current code.
for child in $(/usr/bin/pgrep -f \
  'enrich_product_images.py --publish --target-images 23977.*checkpoint-worker-' \
  2>/dev/null || true); do
  kill -TERM "$child" 2>/dev/null || true
done

resume_generic_workers() {
  local wrapper
  for wrapper in "${paused_wrappers[@]}"; do
    kill -CONT "$wrapper" 2>/dev/null || true
  done
}
interrupt_fastlane() {
  trap - EXIT INT TERM HUP
  resume_generic_workers
  exit 130
}
trap resume_generic_workers EXIT
trap interrupt_fastlane INT TERM HUP

export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1

typeset -a worker_pids=()
typeset -i index offset failures=0
offset=$MEDICINE_OFFSET
for (( index=0; index<${#SHARD_LIMITS[@]}; index++ )); do
  limit=${SHARD_LIMITS[$(( index + 1 ))]}
  MED250_WORKER_ONCE=1 /usr/bin/nice -n 5 \
    "$REPO/scripts/run_product_image_worker.zsh" \
    --offset "$offset" \
    --limit "$limit" \
    "${discovery_args[@]}" \
    --ignore-retry-cooldown \
    "${publication_args[@]}" \
    --background-engine border \
    --max-candidates "$MAX_CANDIDATES" \
    --request-delay 0 \
    --checkpoint "$REPO/data/product-images/checkpoint-medicine-fast-${index}-${CHECKPOINT_SUFFIX}.sqlite3" \
    --report "$REPO/data/product-images/report-medicine-fast-${index}-${RUN_SUFFIX}.json" \
    >"/tmp/med250-medicine-fast-${index}-${RUN_SUFFIX}.log" 2>&1 &
  worker_pids+=("$!")
  (( offset += limit ))
done

if (( offset != MEDICINE_OFFSET + MEDICINE_PRODUCT_COUNT )); then
  print -u2 -- "Medicine fast-lane offsets are not contiguous"
  exit 2
fi

for child in "${worker_pids[@]}"; do
  if ! wait "$child"; then
    (( failures += 1 ))
  fi
done

resume_generic_workers
trap - EXIT INT TERM HUP

if (( failures )); then
  print -u2 -- "Medicine fast lane finished with ${failures} failed worker process(es)"
  exit 1
fi
print -- "Medicine fast lane finished; broad-search workers resumed"
