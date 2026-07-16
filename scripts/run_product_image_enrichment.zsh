#!/bin/zsh
set -euo pipefail

REPO_ROOT="/Volumes/PRO-G40/MED250"
PROJECT_REF="${SUPABASE_PROJECT_REF:-uskfnszcdqpcfrhjxitl}"
PYTHON_BIN="${MED250_IMAGE_PYTHON:-${REPO_ROOT}/.venv-product-images/bin/python}"

cd "$REPO_ROOT"

if [[ ! -x "$PYTHON_BIN" ]]; then
  print -u2 "Secure image runtime is missing. Create it with Python 3.11+ and install requirements-product-images.txt."
  exit 1
fi

if ! "$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit("The product-image pipeline requires Python 3.11 or newer.")
PY
then
  exit 1
fi

if ! "$PYTHON_BIN" - <<'PY'
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
import re

for raw in Path("requirements-product-images.txt").read_text(encoding="utf-8").splitlines():
    line = raw.split("#", 1)[0].strip()
    if not line:
        continue
    match = re.fullmatch(r"([A-Za-z0-9._-]+)(?:\[[^]]+\])?==([A-Za-z0-9.!+_-]+)", line)
    if not match:
        raise SystemExit(f"Requirement is not exactly pinned: {line}")
    package, expected = match.groups()
    try:
        actual = version(package)
    except PackageNotFoundError:
        raise SystemExit(f"Required package is not installed: {package}")
    if actual != expected:
        raise SystemExit(f"{package} must be {expected}; found {actual}")
PY
then
  exit 1
fi

if [[ -z "${SUPABASE_SECRET_KEY:-}" ]]; then
  management_token=$(/usr/bin/security find-generic-password -s "Supabase CLI" -w)
  api_keys=$(
    print -r -- "header = \"Authorization: Bearer ${management_token}\"" |
      /usr/bin/curl -fsS --config - \
      "https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true"
  )
  SUPABASE_SECRET_KEY=$(
    print -r -- "$api_keys" |
      /usr/bin/jq -r \
        '[.[] | select(.type == "secret")][0].api_key //
         [.[] | select(.name == "service_role")][0].api_key // empty'
  )
  export SUPABASE_SECRET_KEY
fi

if [[ -z "${SUPABASE_SECRET_KEY:-}" ]]; then
  print -u2 "Could not resolve a Supabase server-side key."
  exit 1
fi

export SUPABASE_URL="${SUPABASE_URL:-https://${PROJECT_REF}.supabase.co}"

exec "$PYTHON_BIN" scripts/enrich_product_images.py \
  --publish \
  --background-engine auto \
  --request-delay 0.3 \
  "$@"
