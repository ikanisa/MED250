#!/bin/zsh
set -u

repo="/Volumes/PRO-G40/MED250"
support_dir="$HOME/Library/Application Support/MED250"
source "$support_dir/product-image-worker-topology.zsh" || exit 1
startup_lock="/tmp/med250-product-image-start.lock"
runfile="$0"
typeset -gi launched_workers=0
progress="$repo/data/product-images/live-progress.json"
typeset -a publication_args=(--coverage-only --skip-existing-final)
typeset -gi pipeline_complete=0

if [[ -s "$progress" ]] && /usr/bin/jq -e \
  '.products_missing_minimum_gallery == 0' "$progress" >/dev/null 2>&1; then
  publication_args=(
    --skip-existing-final
    --publish-final-allocation
    --top-up-from-live-gallery
  )
fi
if [[ -s "$progress" ]] && /usr/bin/jq -e \
  '.approved_images == 23977 and
   .products_with_final_allocation == 4659 and
   (.broken_public_urls // 0) == 0' "$progress" >/dev/null 2>&1; then
  pipeline_complete=1
fi

launch_worker() {
  local index="$1"
  local offset="$2"
  local limit="$3"
  if (( launched_workers > 0 )); then
    /bin/sleep 8
  fi
  /usr/bin/osascript <<APPLESCRIPT
tell application "Terminal"
  do script "cd ${repo} && ./scripts/run_product_image_worker.zsh --offset ${offset} --limit ${limit} ${(j: :)publication_args} --checkpoint data/product-images/checkpoint-worker-${index}.sqlite3 --report data/product-images/report-worker-${index}.json >> /tmp/med250-product-images-worker-${index}.log 2>&1"
end tell
APPLESCRIPT
  launched_workers=$((launched_workers + 1))
}

typeset -gi index offset limit
if (( ! pipeline_complete )); then
  for index in {0..$(( MED250_WORKER_COUNT - 1 ))}; do
    offset=${MED250_WORKER_OFFSETS[$(( index + 1 ))]}
    limit=${MED250_WORKER_LIMITS[$(( index + 1 ))]}
    if ! /usr/bin/pgrep -f \
      "run_product_image_worker.zsh --offset ${offset} --limit ${limit}" \
      >/dev/null; then
      launch_worker "$index" "$offset" "$limit"
    fi
  done
fi
if ! /usr/bin/pgrep -f "monitor_product_image_pipeline.zsh" >/dev/null; then
  /usr/bin/osascript <<'APPLESCRIPT'
tell application "Terminal"
  do script "cd /Volumes/PRO-G40/MED250 && ./scripts/monitor_product_image_pipeline.zsh >> /tmp/med250-product-images-monitor.log 2>&1"
end tell
APPLESCRIPT
fi

unset index offset limit pipeline_complete

/bin/sleep 3
/bin/rmdir "$startup_lock" 2>/dev/null || true
if [[ "$runfile" == /tmp/med250-start-*.command ]]; then
  /bin/rm -f "$runfile"
fi
