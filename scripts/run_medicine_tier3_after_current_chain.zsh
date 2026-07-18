#!/bin/zsh
set -euo pipefail

# One-shot handoff for the currently running tier-2/consumer chain. The
# generic helper retains argument validation for future scheduled runs.
exec "/Volumes/PRO-G40/MED250/scripts/run_medicine_tier3_after_chain.zsh" 8494
