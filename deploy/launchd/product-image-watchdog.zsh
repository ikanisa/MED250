#!/bin/zsh
set -u

repo="/Volumes/PRO-G40/MED250"
support_dir="$HOME/Library/Application Support/MED250"
source "$support_dir/product-image-worker-topology.zsh" || exit 1
starter="/Users/jeanbosco/Library/Application Support/MED250/start-product-image-pipeline.command"
startup_lock="/tmp/med250-product-image-start.lock"
missing=0
progress="$repo/data/product-images/live-progress.json"
pipeline_complete=0

if [[ -s "$progress" ]] && /usr/bin/jq -e \
  '.approved_images == 23977 and
   .products_with_final_allocation == 4659 and
   (.broken_public_urls // 0) == 0' "$progress" >/dev/null 2>&1; then
  pipeline_complete=1
fi

typeset -gi index offset limit
if (( ! pipeline_complete )); then
  for index in {0..$(( MED250_WORKER_COUNT - 1 ))}; do
    offset=${MED250_WORKER_OFFSETS[$(( index + 1 ))]}
    limit=${MED250_WORKER_LIMITS[$(( index + 1 ))]}
    if ! /usr/bin/pgrep -f \
      "run_product_image_worker.zsh --offset ${offset} --limit ${limit}" \
      >/dev/null; then
      missing=1
    fi
  done
fi
unset index offset limit

if ! /usr/bin/pgrep -f "monitor_product_image_pipeline.zsh" >/dev/null; then
  missing=1
fi
unset pipeline_complete

if (( missing )); then
  if [[ -d "$startup_lock" ]]; then
    lock_age=$(( $(/bin/date +%s) - $(/usr/bin/stat -f %m "$startup_lock") ))
    if (( lock_age > 300 )); then
      /bin/rmdir "$startup_lock" 2>/dev/null || true
    fi
  fi
  if /bin/mkdir "$startup_lock" 2>/dev/null; then
    runfile="/tmp/med250-start-${$}-$(/bin/date +%s).command"
    if ! /bin/cp "$starter" "$runfile" ||
      ! /bin/chmod 0755 "$runfile" ||
      ! /usr/bin/open -gj -a Terminal "$runfile"; then
      /bin/rm -f "$runfile"
      /bin/rmdir "$startup_lock" 2>/dev/null || true
      exit 1
    fi
  fi
fi
