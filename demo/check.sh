#!/usr/bin/env bash
# Runs the CLI over the whole demo course, exactly as CI would, so you can
# compare its list with the editor's Problems panel. Extra arguments are
# passed through, e.g.:
#   demo/check.sh --format github
#   demo/check.sh --exclude "questions/brokenJson/**"
# Exits 1, since the demo course has errors on purpose.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo/demo"
(cd "$repo" && npm run --silent build:cli >/dev/null)
node "$repo/packages/cli/dist/cli.js" check "$@" course
