#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Building release artifacts"
if [ ! -d "node_modules" ]; then
  echo "node_modules not found; running npm ci"
  npm ci --no-audit --no-fund
fi

npm run build
npm test

echo
echo "Build and test checks passed."
