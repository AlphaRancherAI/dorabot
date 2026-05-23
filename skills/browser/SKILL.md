---
name: browser
description: "Browser automation using Chrome Canary via the browser MCP tool. Use for web testing, scraping authenticated pages, form interactions, screenshots, and any task requiring a real browser. Supports both headless and headed (visible window) modes."
metadata:
  { "requires": { "bins": ["osascript"] } }
---

# Browser Automation Skill

Automate Chrome Canary via the `browser` MCP tool (Playwright over CDP). Canary is a dedicated automation browser, separate from regular Chrome to avoid disrupting active sessions.

## Configuration

Profile: `~/.dorabot3/browser/profile` (persistent cookies/sessions)
CDP port: 19222
Config: `~/.dorabot3/config.json`

```json
{
  "browser": {
    "enabled": true,
    "headless": true,
    "executablePath": "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "settleTimeout": 500
  }
}
```

## Headed Mode (Visible Window)

The browser tool runs headless by default, even with `headless: false` in config. To get a visible Canary window, manually launch it first, then let the browser tool reconnect:

```bash
# Kill any stale instances
pkill -f "Google Chrome Canary"

# Launch Canary with CDP enabled
"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
  --remote-debugging-port=19222 \
  --user-data-dir="$HOME/.dorabot3/browser/profile" \
  --no-first-run --no-default-browser-check \
  "https://example.com" &

# Bring to foreground
osascript -e 'tell application "Google Chrome Canary" to activate'
```

Then call the browser tool's `start` action, which reconnects to the existing CDP session on port 19222.

## Core Workflow

```
1. start                    - connect to browser (auto-launches if not running)
2. open / navigate (url)    - load a page
3. take_snapshot            - get accessibility tree with element refs
4. click / fill / select    - interact using refs (use includeSnapshot=true)
5. take_screenshot          - capture visual state
```

### Key Principles

- **Snapshots over screenshots**: `take_snapshot` returns the accessibility tree with refs for every interactive element. Use this for navigation and interaction. Use `take_screenshot` only for visual verification.
- **includeSnapshot=true**: Pass this on interaction actions (click, fill, select, press_key, hover, scroll) to get the updated page state in the same response, saving a round-trip.
- **wait_for(text) over wait(timeMs)**: More reliable and faster. Use `wait(timeMs)` only when there's no text indicator to wait on.

## Actions Reference

### Navigation

```
open          url="https://example.com"         Open URL in current page
navigate      url="https://..." type="url"      Navigate (also: back, forward, reload)
new_page                                        Open a new tab
list_pages                                      List all open tabs
select_page   pageId=N                          Switch to tab by ID
close_page                                      Close current tab
```

### Reading the Page

```
take_snapshot                                   Get accessibility tree (element refs)
take_screenshot                                 Capture PNG screenshot
wait_for      text="Loading complete"           Wait until text appears on page
wait          timeMs=2000                       Wait fixed duration (avoid if possible)
```

### Interaction

All interaction actions accept `includeSnapshot=true` to return the updated page state.

```
click         ref="e42"                         Click element by ref
click         text="Submit"                     Click element by visible text
click_at      x=500 y=300                       Click at coordinates
fill          ref="e42" value="hello"           Fill input field
select        ref="e42" values=["option1"]      Select dropdown option
press_key     key="Enter"                       Press keyboard key
hover         ref="e42"                         Hover over element
scroll        deltaY=-500                       Scroll (negative=up, positive=down)
scroll        ref="e42" deltaY=300              Scroll within element
drag          from_ref="e1" to_ref="e2"         Drag and drop
upload_file   ref="e42" filePath="/path/to.png" Upload file to input
```

### JavaScript

```
evaluate_script  function="return document.title"     Run JS, return result
```

The `function` param is the body of a function that gets called. Use `return` to get values back.

```
# Get scroll height
evaluate_script  function="return document.body.scrollHeight"

# Scroll to element
evaluate_script  function="document.querySelector('#flow').scrollIntoView(); return 'done'"

# Extract data
evaluate_script  function="return JSON.stringify(Array.from(document.querySelectorAll('h2')).map(h => h.textContent))"
```

### Dialogs

```
handle_dialog  dialogAction="accept"            Accept alert/confirm/prompt
handle_dialog  dialogAction="dismiss"           Dismiss dialog
handle_dialog  dialogAction="accept" promptText="input"   Accept prompt with text
```

### Network & Console

```
list_console_messages                           View console output
get_console_message  msgid=N                    Get specific message
list_network_requests                           View network activity
get_network_request  reqid=N                    Get request details (headers, body)
```

### Cookies

```
cookies  cookieAction="get" cookieUrl="https://example.com"                Get cookies
cookies  cookieAction="set" cookieUrl="https://..." cookieName="x" cookieValue="y"  Set cookie
cookies  cookieAction="delete" cookieUrl="https://..." cookieName="x"      Delete cookie
```

### Other

```
status                                          Check browser connection status
start                                           Start/reconnect browser
stop                                            Stop browser
pdf           path="/tmp/page.pdf"              Save page as PDF
```

## Common Patterns

### Scrape authenticated content

Sessions persist in the profile. After first login, cookies carry over.

```
1. navigate to page
2. take_snapshot
3. If login page detected: ask user to log in manually, then snapshot again
4. Extract data via snapshot refs or evaluate_script
```

### Fill and submit a form

```
1. take_snapshot to find form field refs
2. fill ref="input_ref" value="data" (for each field)
3. click ref="submit_ref" includeSnapshot=true
4. Check result in returned snapshot
```

### Download a file

Don't download via the browser. Extract the URL and use curl:

```
1. take_snapshot or evaluate_script to find the download URL
2. Use Bash: curl -o /path/to/file "https://..."
```

### Handle large snapshots

Some pages produce snapshots that exceed token limits. When this happens:

```
1. The snapshot is saved to a temp file (path in error message)
2. Use Grep to search the file for specific elements (e.g., "error", "heading")
3. Use Bash with grep to extract refs for specific elements
4. Or use take_screenshot for visual context instead
```

### Multi-tab workflow

```
1. list_pages to see all tabs
2. new_page to open a new tab
3. select_page pageId=N to switch
4. close_page to close current tab
```

## Login Handling

Never fill credentials yourself. If you detect a login page:

1. Use AskUserQuestion to ask the user to log in manually in the visible browser window
2. After they confirm, take_snapshot to verify the session
3. Continue with the authenticated page

## Troubleshooting

```bash
# Check if Canary is running
pgrep -la "Google Chrome Canary"

# Check CDP port is listening
lsof -i :19222

# Kill stale instances and restart
pkill -f "Google Chrome Canary"

# If not installed
brew install --cask google-chrome@canary
```

If the browser MCP tool disconnects ("Stream closed" errors), use the CDP WebSocket as a fallback:

```python
# Connect via websockets to execute JS in an authenticated tab
import asyncio, websockets, json

async def run_in_tab(url_match, js_code):
    async with websockets.connect("ws://localhost:19222/json") as ws:
        tabs = json.loads(await ws.recv())
    tab = next(t for t in tabs if url_match in t["url"])
    async with websockets.connect(tab["webSocketDebuggerUrl"]) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js_code}}))
        return json.loads(await ws.recv())
```
