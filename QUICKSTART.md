# Jarvis Quickstart

## Starting all instances

All instances use the Electron binary directly from `desktop/node_modules/`. Run from the `desktop/` directory. After any frontend code change, run `npm run build` once first.

```bash
cd ~/workspace/jarvis/desktop

# Instance 1 (default ~/.jarvis)
ELECTRON_RUN_AS_NODE= node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .

# Instance 2
ELECTRON_RUN_AS_NODE= JARVIS_HOME=~/.jarvis2 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .

# Instance 3
ELECTRON_RUN_AS_NODE= JARVIS_HOME=~/.jarvis3 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .

# Instance 4
ELECTRON_RUN_AS_NODE= JARVIS_HOME=~/.jarvis4 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

`ELECTRON_RUN_AS_NODE=` (empty) is required — Claude Code sets this var in its shell env and it breaks Electron if inherited.

Each instance gets its own socket, database, config, channels, and gateway token.

---

## Building

```bash
# Build backend
npm run build

# Build + package desktop as macOS .app and install to /Applications
cd desktop && npm run package
```

---

## Auth

Claude OAuth tokens are stored in the macOS keychain via the `jarvis_oauth` method. Each instance shares the same keychain entry (same Claude account). To use a different account per instance, use an API key instead via Settings.
