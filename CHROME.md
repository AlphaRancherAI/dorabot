# Browser Separation: Chrome vs Chrome Canary

## Problem

The browser automation tool (`browser` MCP tool) needs a Chromium-based browser with CDP (Chrome DevTools Protocol). By default it picks the first available browser, which is usually regular Google Chrome. When it launches or stops, it kills the user's Chrome session (including remote desktop tabs, etc).

## Solution

Install **Google Chrome Canary** as a dedicated automation browser. Canary is a completely separate app with its own process name, profile directory, and data. Starting/stopping Canary does not affect regular Chrome.

### Install

```bash
brew install --cask google-chrome@canary
```

Installs to `/Applications/Google Chrome Canary.app`.

### Configure

In `~/.dorabot2/config.json`:

```json
{
  "browser": {
    "enabled": true,
    "headless": true,
    "executablePath": "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
  }
}
```

### How it works

1. `startGateway()` in `src/gateway/server.ts` calls `setBrowserConfig(config.browser)` to pass the config to the browser tool module.
2. The browser tool calls `findChromium(config.executablePath)` which matches the Canary path against `BROWSER_INFO` in `src/browser/manager.ts`.
3. This returns `appName: 'Google Chrome Canary'`, so `quitApp()` only targets Canary (not regular Chrome).
4. Canary uses its own profile at `~/.dorabot2/browser/profile` (not the user's Canary profile).

### Bug that was fixed

`setBrowserConfig()` was defined and exported from `src/tools/browser.ts` but never called anywhere. The browser tool always received an empty config `{}`, so `findChromium()` got no override and defaulted to the first browser found (regular Chrome). Fixed by adding the call in `src/gateway/server.ts`.

### Verification

```bash
# Both should coexist:
pgrep -la "Google Chrome$"        # user's Chrome
pgrep -la "Google Chrome Canary"  # automation browser

# After browser tool stop, regular Chrome should still be running
```

### Browser detection order (when no executablePath set)

Defined in `BROWSER_INFO` in `src/browser/manager.ts`:

1. Google Chrome
2. Brave Browser
3. Microsoft Edge
4. Chromium
5. Google Chrome Canary
