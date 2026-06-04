#!/bin/bash
# Launch the Jarvis desktop app.
#
# Usage:
#   ./launch.sh                         # default ~/.jarvis
#   JARVIS_HOME=~/.jarvis2 ./launch.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# better-sqlite3 requires native compilation — ensure Xcode CLT is present
if ! xcode-select -p &>/dev/null; then
  echo "[setup] Xcode Command Line Tools not found. Installing..."
  xcode-select --install
  echo "[setup] Re-run this script once the Xcode CLT installation completes."
  exit 1
fi

# Install root deps and build backend if needed
if [ ! -d node_modules ]; then
  echo "[setup] Installing root dependencies..."
  npm install
fi
if [ ! -d dist ]; then
  echo "[setup] Building backend..."
  npm run build
fi

# Install desktop deps and build renderer if needed
if [ ! -d desktop/node_modules ]; then
  echo "[setup] Installing desktop dependencies..."
  npm -C desktop install
fi
if [ ! -d desktop/out ]; then
  echo "[setup] Building desktop..."
  npm -C desktop run build
fi

cd desktop

# ELECTRON_RUN_AS_NODE must be cleared — if this shell was spawned by
# Claude Code (itself an Electron app), the var is inherited and causes
# electron-vite to crash on startup.
ELECTRON_RUN_AS_NODE= node_modules/.bin/electron .
