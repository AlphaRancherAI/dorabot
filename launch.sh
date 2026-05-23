#!/bin/bash
# Launch the Dorabot desktop app.
#
# Usage:
#   ./launch.sh                         # default ~/.dorabot
#   DORABOT_HOME=~/.dorabot2 ./launch.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure Node 22 LTS — better-sqlite3 native addon breaks on Node 26+
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -gt 22 ] || [ "$NODE_MAJOR" -lt 22 ]; then
  # Try nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  if command -v nvm &>/dev/null; then
    echo "[setup] Switching to Node 22 LTS via nvm..."
    nvm install 22 --no-progress
    nvm use 22
  else
    echo "[error] Node $NODE_MAJOR detected. Dorabot requires Node 22 LTS."
    echo "        Install nvm: https://github.com/nvm-sh/nvm"
    echo "        Then: nvm install 22 && nvm use 22"
    exit 1
  fi
fi

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
