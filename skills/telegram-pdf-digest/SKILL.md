# Skill: Telegram PDF Digest

Generate a formatted PDF compiling assistant replies sent to George over Telegram, organized by topic with a table of contents.

## When to Use

When George asks to compile, collate, or export Telegram replies into a PDF. Common phrasings:
- "compile your telegram replies into a PDF"
- "make a PDF of what you told me on Telegram"
- "collate recent topics into a document"

## Scope Decision (Do This First)

Before extracting, determine scope:

1. **If recent context makes it obvious** (e.g., George just finished a long analysis session, or asked "export what you just told me") — use messages from the last 7-14 days only. Apply date filter.
2. **If ambiguous** — ask: "Do you want everything since we started (May 2026), or just recent topics from the last week or two?"
3. **Never dump the full history by default** — 1,600+ messages spanning months produces a 100+ page document that's not useful. Target 10-40 pages.

Default scope when in doubt: **last 30 days**, `len(msg) > 400` threshold (substantive analysis only).

## System Knowledge (Pre-verified, No Lookups Needed)

### Database
- **dorabot DB**: `/Users/Kevin/.dorabot4/dorabot.db` (SQLite)
- **Messages table schema**: `id, session_id, type, content (JSON), metadata, timestamp`
- **Telegram session IDs** (as of May 2026):
  - `telegram-dm-8616433691-1778516452142` (George Hamilton, primary)
  - `telegram-dm-8565735343-1778516224425` (George, alt ID "A R" / "OpenClaw Bot")
  - `telegram-dm-8565735343-1778556476814` (George, additional session)
- Messages sent to George are **tool_use blocks** with `name = "mcp__dorabot-tools__message"`, `action = "send"`, `channel = "telegram"` — the actual text is in `input.message`

### PDF Toolchain (Pre-installed)
- **pandoc**: `/opt/homebrew/bin/pandoc` — converts Markdown → HTML5
- **weasyprint**: `/Users/Kevin/Library/Python/3.9/bin/weasyprint` — converts HTML → PDF
- **CRITICAL**: weasyprint needs `DYLD_LIBRARY_PATH="$(brew --prefix)/lib:$DYLD_LIBRARY_PATH"` set, otherwise it fails with `libgobject-2.0-0` not found
- **brew prefix**: `/opt/homebrew`

## Step-by-Step Process

### 1. Extract messages from DB

```python
import sqlite3, json
from datetime import datetime
from collections import defaultdict

conn = sqlite3.connect("/Users/Kevin/.dorabot4/dorabot.db")
rows = conn.execute("""
    SELECT timestamp, content FROM messages
    WHERE session_id LIKE '%telegram%' AND type = 'assistant'
    ORDER BY timestamp
""").fetchall()

sent = []
for ts, raw in rows:
    try:
        data = json.loads(raw)
        for block in data.get("message", {}).get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == "mcp__dorabot-tools__message":
                inp = block.get("input", {})
                if inp.get("action") == "send" and inp.get("channel") == "telegram":
                    msg = inp.get("message", "").strip()
                    if len(msg) > 150:  # filter trivial acks
                        sent.append((ts, msg))
    except:
        pass
```

### 2. Classify by topic

Use keyword heuristics on `msg.lower()`. Add new topics as the case evolves. Current topic map (update as needed):

```python
TOPICS = [
    ("Case Overview",                    lambda m: "pioneer bancorp / mypayrollhr case summary" in m or ("core story:" in m and "pioneer" in m)),
    ("RBRR Score Collapse (3/16/2017)",  lambda m: "rbrr" in m or ("83" in m and "13" in m and "score" in m)),
    ("Arc-Serv and Maleka Ali",          lambda m: "arc-serv" in m or "maleka ali" in m),
    ("Overdraft Approval Chain",         lambda m: "overdraft" in m and ("approval" in m or "advance memo" in m)),
    ("Blessing Off-Channel Communications", lambda m: "blessing" in m and ("personal email" in m or "hotmail" in m or "off-channel" in m)),
    ("Berkshire Bank Stonewalling",      lambda m: "berkshire" in m and ("malinowski" in m or "newspaper" in m or "times union" in m)),
    ("SAR Committee Analysis",           lambda m: "sar committee" in m or ("sar" in m and "108" in m)),
    ("Wolf and Co. BSA Audit Defense",   lambda m: "wolf & co" in m or ("wolf" in m and "bsa" in m and "strong" in m)),
    ("FDIC Examination Findings",        lambda m: "fdic" in m and ("deficient" in m or "safety and soundness" in m)),
    ("DLA Piper BCC Patterns",           lambda m: "dla piper" in m or ("bcc" in m and "alessi" in m)),
    ("Devil's Advocate Analysis",        lambda m: "devil" in m and "advocate" in m),
    ("Pipeline and Technical Status",    lambda m: ("farmshare" in m or "vllm" in m or ("embedding" in m and "points" in m)) and len(m) > 300),
    ("Search Quality Improvements",      lambda m: "search" in m and ("benchmark" in m or "compound" in m or "pinned" in m)),
    ("RAG Improvement Roadmap",          lambda m: "re-rank" in m or "hyde" in m or ("deposition" in m and "index" in m) or ("tier" in m and "improvement" in m)),
]
```

Messages that don't match any topic are silently dropped (short acks, status pings). To include everything, add a catch-all `("Other", lambda m: True)` at the end.

**Date filtering**: To limit to recent topics only, filter `ts` before classifying:
```python
# Only include messages from last 30 days
from datetime import datetime, timezone, timedelta
cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
sent = [(ts, msg) for ts, msg in sent if ts >= cutoff]
```

### 3. Build Markdown

```python
import re

def slugify(s):
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'\s+', '-', s.strip())
    return s

lines = []
lines.append("# evidenceRAG: Telegram Analysis Digest\n")
lines.append(f"*SWP v. Pioneer Bancorp, 1:19-cv-1349 (NDNY) — Compiled {datetime.now().strftime('%B %d, %Y')}*\n\n---\n")

# TOC
lines.append("## Table of Contents\n")
toc_items = [(label, fn) for label, fn in TOPICS if label in topics]
for i, (label, _) in enumerate(toc_items, 1):
    lines.append(f"{i}. [{label}](#{slugify(label)})")
lines.append("\n---\n")

# Sections — use raw HTML h2 with id for reliable anchor links
for label, _ in TOPICS:
    msgs = topics.get(label)
    if not msgs:
        continue
    lines.append(f'\n<h2 id="{slugify(label)}">{label}</h2>\n')
    for j, (date_str, msg) in enumerate(msgs):
        if len(msgs) > 1:
            lines.append(f"\n*{date_str}*\n")
        lines.append(msg)
        lines.append("\n")
    lines.append("\n---\n")
```

**Note**: Use `<h2 id="...">` raw HTML instead of `## heading` for TOC anchors — pandoc doesn't auto-generate anchors from `## headings` reliably enough for weasyprint's link resolution.

### 4. Convert to PDF

```bash
# Step 1: Markdown → HTML5
pandoc /tmp/telegram_digest.md -t html5 --standalone -o /tmp/telegram_digest.html

# Step 2: Inject CSS (do this in Python before calling weasyprint)
# See CSS block below

# Step 3: HTML → PDF (DYLD_LIBRARY_PATH is required)
DYLD_LIBRARY_PATH="$(brew --prefix)/lib:$DYLD_LIBRARY_PATH" \
  /Users/Kevin/Library/Python/3.9/bin/weasyprint \
  /tmp/telegram_digest_styled.html \
  /Users/Kevin/Desktop/evidenceRAG_telegram_digest.pdf
```

### CSS Template

```python
css = """
<style>
@page { margin: 2.2cm 2.8cm; }
body { font-family: Georgia, serif; font-size: 11pt; line-height: 1.7; color: #111; }
h1 { font-size: 20pt; border-bottom: 2.5px solid #1a1a4a; padding-bottom: 10px; margin-bottom: 0.4em; color: #0a0a2a; }
h2 { font-size: 14pt; margin-top: 2.2em; border-bottom: 1px solid #bbb; padding-bottom: 5px; color: #1a1a4a; }
p { margin-bottom: 0.75em; }
strong { font-weight: bold; }
ol, ul { padding-left: 1.7em; }
li { margin-bottom: 0.35em; }
hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
em { color: #555; font-style: italic; }
code { font-family: "Courier New", monospace; font-size: 9pt; background: #f4f4f4; padding: 1px 4px; }
a { color: #1a1a4a; text-decoration: none; }
</style>
"""
content = open("/tmp/telegram_digest.html").read()
content = content.replace("</head>", css + "</head>")
open("/tmp/telegram_digest_styled.html", "w").write(content)
```

## Output

Default output: `/Users/Kevin/Desktop/evidenceRAG_telegram_digest.pdf`

Open automatically with `open /Users/Kevin/Desktop/evidenceRAG_telegram_digest.pdf`.

## Customization Options

- **Recent topics only**: Add date filter (see Step 2)
- **Include tables/timelines**: After extracting messages, look for tabular content (lines with `|`) and render as HTML `<table>` before PDF conversion
- **Add cover page**: Prepend a styled `<div class="cover">` block in the HTML before weasyprint
- **Multiple output formats**: Change extension to `.html` if George wants a browsable version instead
- **Filter by topic**: Pass `--topic "RBRR"` style arg to only include matching sections

## Troubleshooting

| Error | Fix |
|-------|-----|
| `libgobject-2.0-0` not found | Set `DYLD_LIBRARY_PATH="$(brew --prefix)/lib:$DYLD_LIBRARY_PATH"` |
| `weasyprint: command not found` | Use full path: `/Users/Kevin/Library/Python/3.9/bin/weasyprint` |
| `pandoc: command not found` | `brew install pandoc` |
| TOC links broken | Use `<h2 id="slug">` raw HTML, not `## Heading` markdown |
| Empty PDF / no sections | Lower the `len(msg) > 150` threshold or add new topic matchers |
| weasyprint CSS warnings | Safe to ignore — `overflow-x: auto` and `gap: min(...)` not supported but don't break output |
