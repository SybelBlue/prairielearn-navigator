#!/usr/bin/env bash
# Runs the prairielearn-navigator CLI on this course, exactly as CI would,
# so you can compare its list with the Problems panel. Run it from this
# window's terminal:
#   ./check.sh
#   ./check.sh --format github
#   ./check.sh --exclude "questions/brokenJson/**"
# Exits 1, since this course has errors on purpose.
set -euo pipefail
course="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$course/../.." && pwd)"
(cd "$repo" && npm run --silent build:cli >/dev/null)
cd "$course"
node "$repo/packages/cli/dist/cli.js" check "$@" .
