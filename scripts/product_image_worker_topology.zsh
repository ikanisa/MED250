#!/bin/zsh

# Four contiguous, non-overlapping slices of the 4,659 live-product catalogue.
# Keep this as the single source of truth for the persistent launcher and
# watchdog.  Four workers fit the 10-core host without the OCR load causing
# sustained oversubscription.
typeset -ga MED250_WORKER_OFFSETS=(0 1165 2330 3495)
typeset -ga MED250_WORKER_LIMITS=(1165 1165 1165 1164)
typeset -gr MED250_WORKER_COUNT=4
typeset -gr MED250_LIVE_PRODUCT_COUNT=4659

if (( ${#MED250_WORKER_OFFSETS} != MED250_WORKER_COUNT ||
      ${#MED250_WORKER_LIMITS} != MED250_WORKER_COUNT )); then
  print -u2 -- "Invalid product-image worker topology"
  return 1 2>/dev/null || exit 1
fi

typeset -gi med250_expected_offset=0
typeset -gi med250_total_products=0
typeset -gi med250_index
for med250_index in {1..${MED250_WORKER_COUNT}}; do
  if (( MED250_WORKER_OFFSETS[med250_index] != med250_expected_offset ||
        MED250_WORKER_LIMITS[med250_index] <= 0 )); then
    print -u2 -- "Product-image worker ranges are not contiguous"
    return 1 2>/dev/null || exit 1
  fi
  med250_expected_offset=$((
    MED250_WORKER_OFFSETS[med250_index] + MED250_WORKER_LIMITS[med250_index]
  ))
  med250_total_products=$((
    med250_total_products + MED250_WORKER_LIMITS[med250_index]
  ))
done
if (( med250_total_products != MED250_LIVE_PRODUCT_COUNT )); then
  print -u2 -- "Product-image worker ranges do not cover the live catalogue"
  return 1 2>/dev/null || exit 1
fi

unset med250_expected_offset med250_total_products med250_index
