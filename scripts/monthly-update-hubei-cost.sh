#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMPORT_DIR="${ROOT_DIR}/data/imports/hubei"

if [[ $# -lt 2 ]]; then
  echo "Usage: bash scripts/monthly-update-hubei-cost.sh <city> <import.json>"
  echo "Example: bash scripts/monthly-update-hubei-cost.sh 武汉 data/imports/hubei/wuhan-2026-04.json"
  exit 1
fi

CITY="$1"
IMPORT_FILE="$2"

if [[ ! -f "$IMPORT_FILE" ]]; then
  echo "Import file not found: $IMPORT_FILE"
  exit 2
fi

node "${ROOT_DIR}/scripts/validate-hubei-cost-import.js" "$IMPORT_FILE"
node "${ROOT_DIR}/scripts/update-hubei-cost-overrides.js" --city "$CITY" --from-json "$IMPORT_FILE"

echo "Done. Updated city overrides for ${CITY}."
