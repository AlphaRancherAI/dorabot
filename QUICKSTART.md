# Jarvis Quickstart

## Running the app

```bash
cd desktop && npm run dev
```

This starts the gateway subprocess and the Electron desktop with HMR. Do **not** run `npm run dev:gateway` at the same time — they share the same socket (`~/.dorabot/gateway.sock`) and will conflict.

---

## Multiple instances

Each instance needs its own data directory. Set `DORABOT_HOME` to a different path for each one.

Since the app is updated frequently, the recommended approach is to launch the binary directly from the terminal rather than maintaining separate `.app` bundles.

```bash
# Instance 1 (default — uses ~/.dorabot)
/Applications/Jarvis.app/Contents/MacOS/Jarvis

# Instance 2
DORABOT_HOME=~/.dorabot2 /Applications/Jarvis.app/Contents/MacOS/Jarvis

# Instance 3
DORABOT_HOME=~/.dorabot3 /Applications/Jarvis.app/Contents/MacOS/Jarvis

# Instance 4
DORABOT_HOME=~/.dorabot4 /Applications/Jarvis.app/Contents/MacOS/Jarvis
```

Each instance gets its own socket, database, config, channels, and gateway token. They all show as "Jarvis" in the dock. macOS `open -a Jarvis` won't work for instances 2–4 since it doesn't forward env vars — use the binary path above.

### Dev mode (instances 2–4)

Instance 1 runs via `npm run dev` (electron-vite with HMR). For instances 2–4, use the **built renderer** — do **not** set `ELECTRON_RENDERER_URL`, as pointing multiple instances at the same Vite dev server causes blank UI.

First, build the renderer once (or after any frontend changes):

```bash
cd desktop && npm run build
```

Then launch additional instances directly against the built output:

```bash
# From workspace/dorabot/desktop/
ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot2 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . &
ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot3 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . &
ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot4 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . &
```

You can also wrap these in shell aliases for convenience:

```bash
# ~/.zshrc
JARVIS=~/workspace/dorabot/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
JARVIS_APP=~/workspace/dorabot/desktop
alias jarvis2='ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot2 "$JARVIS" "$JARVIS_APP"'
alias jarvis3='ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot3 "$JARVIS" "$JARVIS_APP"'
alias jarvis4='ELECTRON_RUN_AS_NODE= DORABOT_HOME=~/.dorabot4 "$JARVIS" "$JARVIS_APP"'
```

---

## Building & packaging

```bash
# Build backend
npm run build

# Build + package desktop as macOS .app and install to /Applications
cd desktop && npm run package
```

---

## Auth

Claude OAuth tokens are stored in the macOS keychain via the `dorabot_oauth` method. Each instance shares the same keychain entry (same Claude account). To use a different account per instance, use an API key instead (`loginWithApiKey` via the Settings view).
