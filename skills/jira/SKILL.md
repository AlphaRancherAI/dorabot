---
name: jira
description: "Create, search, and manage Jira tickets in the Vontas ORION project. Use for creating issues, querying sprints, linking epics, and managing releases."
---

# Jira Skill

Interact with Vontas Jira (vontas.atlassian.net) via the REST API.

## Authentication

Credentials are stored in `~/workspace/jira_automation/.env`:

```
JIRA_EMAIL=henry.liao@vontas.com
JIRA_KEY=<api_token>
JIRA_DOMAIN=vontas.atlassian.net
```

Load them with:

```python
from dotenv import load_dotenv
load_dotenv(os.path.expanduser("~/workspace/jira_automation/.env"))
email = os.getenv("JIRA_EMAIL")
token = os.getenv("JIRA_KEY")
base = f"https://{os.getenv('JIRA_DOMAIN')}"
```

Auth is HTTP Basic: `auth=(email, token)` with the `requests` library.

## API Notes

- **Search endpoint**: Atlassian removed `/rest/api/3/search`. Use `POST /rest/api/3/search/jql` with JSON body `{"jql": "...", "fields": [...], "maxResults": N}`.
- **Description format**: Use Atlassian Document Format (ADF), not markdown. The `description` field is a JSON doc with `type: "doc"`, `version: 1`, and `content` array of block nodes.
- **Project key**: `ORION`

## Common Operations

### Search issues

```python
resp = requests.post(f"{base}/rest/api/3/search/jql", auth=(email, token),
    json={"jql": "project=ORION AND status != Done ORDER BY created DESC", "fields": ["summary","status"], "maxResults": 20},
    headers={"Content-Type": "application/json"})
```

### Create a ticket

```python
resp = requests.post(f"{base}/rest/api/3/issue", auth=(email, token),
    json={"fields": {
        "project": {"key": "ORION"},
        "summary": "Title here",
        "issuetype": {"name": "Task"},  # or "Bug", "Story"
        "fixVersions": [{"id": "21109"}],  # release version ID
        "parent": {"key": "ORION-272"},  # epic parent
        "description": {"type": "doc", "version": 1, "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Description here"}]}
        ]}
    }},
    headers={"Content-Type": "application/json"})
```

### List unreleased versions (for fixVersions)

```python
resp = requests.get(f"{base}/rest/api/3/project/ORION/versions", auth=(email, token))
versions = [v for v in resp.json() if not v.get("released") and not v.get("archived")]
```

### Get issue details

```python
resp = requests.get(f"{base}/rest/api/3/issue/ORION-123", auth=(email, token))
```

### Update an issue

```python
resp = requests.put(f"{base}/rest/api/3/issue/ORION-123", auth=(email, token),
    json={"fields": {"summary": "New title"}},
    headers={"Content-Type": "application/json"})
```

### Add a comment

```python
resp = requests.post(f"{base}/rest/api/3/issue/ORION-123/comment", auth=(email, token),
    json={"body": {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Comment text"}]}
    ]}},
    headers={"Content-Type": "application/json"})
```

## Key Reference Data

### Active Epics
- ORION-272: Platform 2.0
- ORION-220: AI Project
- ORION-230: Customer Support Priority
- ORION-215: OCC Frontend improvements
- ORION-252: Geolocation
- ORION-116: OnCall Integration Phase 3 (KCATA)
- ORION-304: SSO JIT User Provisioning
- ORION-318: OCC Beta Features: Productize for GA
- ORION-337: Beta Feature Promotion to Production (Platform 1.6.0)

### Release Versions (2026)
| Release | Target | JIRA ID |
|---------|--------|---------|
| Platform 1.6.0 | May 29 | 21108 |
| Platform 1.7.0 | Jun 30 | 21109 |
| Platform 1.8.0 | Jul 31 | 21110 |
| iOS 8.7.0 | May 29 | 21131 |
| iOS 8.8.0 | Jul 31 | 21122 |
| Android 7.26.2 | Jul 31 | 21130 |
| Platform 2.0 | Dec 31 | 21132 |
