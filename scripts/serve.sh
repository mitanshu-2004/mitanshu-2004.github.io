#!/usr/bin/env bash
# Serve the site locally on :4173 (override with PORT=xxxx).
# Root-absolute asset paths require serving from the project root, which is what
# this does.
set -euo pipefail
PORT="${PORT:-4173}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Serving $ROOT at http://localhost:${PORT}"
exec python3 -m http.server "$PORT" --directory "$ROOT"
