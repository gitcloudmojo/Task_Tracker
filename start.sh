#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  A1K Task Tracker — macOS and Linux
#
#      ./start.sh            Standard edition
#      ./start.sh --excel    Excel edition
#
#  It installs whatever is missing, builds the app, starts it and opens your
#  browser. Safe to run as often as you like.
#
#  If the terminal says "permission denied", run: chmod +x start.sh
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  cat <<'MSG'

  ------------------------------------------------------------------
  Node.js is not installed, or the shell cannot find it.

  macOS:  brew install node      (or download from https://nodejs.org)
  Linux:  use your package manager, or https://nodejs.org

  Then run ./start.sh again.
  ------------------------------------------------------------------

MSG
  exit 1
fi

exec node tools/launch.mjs "$@"
