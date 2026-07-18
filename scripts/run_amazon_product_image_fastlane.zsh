#!/bin/zsh
set -euo pipefail

REPO="/Volumes/PRO-G40/MED250"
SHARD_COUNT=8
SHARD_SIZE=275
AMAZON_PRODUCT_COUNT=2200
POLICY_SUFFIX="${MED250_AMAZON_POLICY_SUFFIX:-v64}"
CHECKPOINT_SUFFIX="$POLICY_SUFFIX"
REPORT_SUFFIX="$POLICY_SUFFIX"
MAX_CANDIDATES=4
typeset -a discovery_args=(--no-public-search)
typeset -a publication_args=(--skip-existing-final --coverage-only)
if [[ "${MED250_COVERAGE_FIRST:-1}" != "1" ]]; then
  publication_args=(--skip-existing-final --publish-final-allocation)
fi

if [[ "${1:-}" == "--search-fallback" ]]; then
  SHARD_COUNT=10
  SHARD_SIZE=220
  CHECKPOINT_SUFFIX="${POLICY_SUFFIX}-search"
  discovery_args+=(--single-query-search-fastlane --ignore-retry-cooldown)
  REPORT_SUFFIX="${POLICY_SUFFIX}-search"
  MAX_CANDIDATES=12
  shift
fi
if (( $# )); then
  print -u2 -- "Unknown fast-lane argument: $1"
  exit 2
fi

if (( SHARD_COUNT * SHARD_SIZE != AMAZON_PRODUCT_COUNT )); then
  print -u2 -- "Amazon fast-lane shards do not cover exactly 2,200 products"
  exit 2
fi

cd "$REPO"

# The canonical dataset is ordered with its 2,200 ASIN-backed consumer
# products first. Pause the broad-search workers while this CPU-focused pass
# runs, but leave their wrapper parents visible to the watchdog. They resume
# automatically on every normal or interrupted exit.
typeset -a paused_wrappers=()
for wrapper in $(/usr/bin/pgrep -f \
  '[/]scripts/run_product_image_worker.zsh --offset .*checkpoint-worker-' \
  2>/dev/null || true); do
  if kill -STOP "$wrapper" 2>/dev/null; then
    paused_wrappers+=("$wrapper")
  fi
done
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

# Keep image encoding responsive under parallelism. These variables
# cap native math libraries only; they do not reduce image resolution or alter
# the quality-95 transparent catalogue output.
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1

typeset -a worker_pids=()
typeset -i index offset failures=0
for index in {0..$(( SHARD_COUNT - 1 ))}; do
  offset=$(( index * SHARD_SIZE ))
  MED250_WORKER_ONCE=1 /usr/bin/nice -n 5 \
    "$REPO/scripts/run_product_image_worker.zsh" \
    --offset "$offset" \
    --limit "$SHARD_SIZE" \
    "${discovery_args[@]}" \
    "${publication_args[@]}" \
    --background-engine border \
    --max-candidates "$MAX_CANDIDATES" \
    --download-workers 4 \
    --request-delay 0 \
    --checkpoint "$REPO/data/product-images/checkpoint-amazon-fast-${index}-${CHECKPOINT_SUFFIX}.sqlite3" \
    --report "$REPO/data/product-images/report-amazon-fast-${index}-${REPORT_SUFFIX}.json" \
    >"/tmp/med250-amazon-fast-${index}-${REPORT_SUFFIX}.log" 2>&1 &
  worker_pids+=("$!")
done

for child in "${worker_pids[@]}"; do
  if ! wait "$child"; then
    (( failures += 1 ))
  fi
done

resume_generic_workers
trap - EXIT INT TERM HUP

if (( failures )); then
  print -u2 -- "Amazon fast lane finished with ${failures} failed worker process(es)"
  exit 1
fi
print -- "Amazon fast lane finished; broad-search workers resumed"
