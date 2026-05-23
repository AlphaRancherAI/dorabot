#!/bin/bash
# Launch the Dorabot desktop app.
#
# Usage:
#   ./launch.sh                         # default ~/.dorabot
#   DORABOT_HOME=~/.dorabot2 ./launch.sh
#
# On first run or after updates, build first:
#   npm install && npm run build
#   cd desktop && npm install && cd ..
#   ./launch.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/desktop"

# ELECTRON_RUN_AS_NODE must be cleared — if this shell was spawned by
# Claude Code (itself an Electron app), the var is inherited and causes
# electron-vite to crash on startup.
ELECTRON_RUN_AS_NODE= node_modules/.bin/electron .
