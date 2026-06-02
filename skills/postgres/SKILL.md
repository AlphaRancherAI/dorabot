---
name: postgres
description: "Query Orion Postgres databases (Observer and Icarus) for user data, PTT metadata, transcriptions, geolocation, and emergency state. VPN required."
---

# Postgres Skill

Direct database access to Orion's production and staging Postgres instances. VPN required for all connections.

## Connection Strings

### Observer DB (Production)

User/group/org data, emergency state, sessions.

```
Host: $OBSERVER_PROD_HOST
Port: 5432
Database: observer
User: postgres
Password: <set $OBSERVER_PROD_PGPASSWORD; see team secrets manager>
SSL: require
```

```bash
PGPASSWORD="$OBSERVER_PROD_PGPASSWORD" psql -h $OBSERVER_PROD_HOST -U postgres -d observer
```

Key tables:
- `users` (id, uid, name, email, created_at)
- `organizations` (id, name, condition)
- `organization_users` (user_id, organization_id, is_owner, is_manager)
- `groups` (id, name, organization_id)
- `group_members` (group_id, user_id)
- `emergency_state` (group_id, user_id, trigger_type, location, updated_at)
- `user_status` (user_id, data JSONB with location, mute state, etc.)

Note: The `orion` database on the same RDS instance is FusionAuth's DB. Don't modify it directly.

### Icarus DB (Production)

Analytics, PTT metadata, transcriptions, geolocation.

```
Host: $ICARUS_PROD_HOST
Port: 5432
Database: icarus_db1
User: orioncanis
Password: <set $ICARUS_PROD_PGPASSWORD; see team secrets manager>
Schema: icarus_sch1
```

```bash
PGPASSWORD="$ICARUS_PROD_PGPASSWORD" psql -h $ICARUS_PROD_HOST -U orioncanis -d icarus_db1
```

Set search path after connecting:
```sql
SET search_path TO icarus_sch1;
```

Key tables:
- `ptt_events` (media_file_id, sender_id, sender_name, group_id, group_name, org_id, target_type, media_type_id, created, event_time, duration, media_metadata JSONB)
- `transcriptions` (media_file_id, transcript, duration, word_count, sender_name, model, created_at)
- `vehicle_breadcrumbs` (user_id, org_id, recorded_at, latitude, longitude, accuracy, speed_mph, heading, state, source)
- `ptt_locations` (media_file_id, latitude, longitude, location_name, source, created_at)

### Observer DB (Staging)

```
Host: $OBSERVER_STAGING_HOST
Port: 5432
Database: orion
User: postgres
Password: <set $OBSERVER_STAGING_PGPASSWORD; see team secrets manager>
```

```bash
PGPASSWORD="$OBSERVER_STAGING_PGPASSWORD" psql -h $OBSERVER_STAGING_HOST -U postgres -d orion
```

### Icarus DB (Staging)

```
Host: $ICARUS_STAGING_HOST
Port: 5432
Database: icarus_db1
User: orioncanis
Password: <set $ICARUS_STAGING_PGPASSWORD; see team secrets manager>
Schema: icarus_sch1
```

## Common Queries

### Look up a user by ID or name

```sql
-- Observer DB
SELECT id, uid, name, email FROM users WHERE id = 'uuid-here';
SELECT id, uid, name, email FROM users WHERE name ILIKE '%search%';
```

### Find user's org and groups

```sql
-- Observer DB
SELECT u.id, u.name, o.name as org_name, g.name as group_name
FROM users u
JOIN organization_users ou ON ou.user_id = u.id
JOIN organizations o ON o.id = ou.organization_id
LEFT JOIN group_members gm ON gm.user_id = u.id
LEFT JOIN groups g ON g.id = gm.group_id
WHERE u.id = 'uuid-here';
```

### Recent PTTs for a group

```sql
-- Icarus DB (set search_path to icarus_sch1)
SELECT media_file_id, sender_name, duration, event_time
FROM ptt_events
WHERE group_id = 'group-uuid'
ORDER BY event_time DESC
LIMIT 20;
```

### PTTs with transcriptions

```sql
-- Icarus DB
SELECT p.sender_name, p.event_time, p.duration, t.transcript
FROM ptt_events p
JOIN transcriptions t ON t.media_file_id = p.media_file_id
WHERE p.group_id = 'group-uuid'
ORDER BY p.event_time DESC
LIMIT 20;
```

### Emergency state for a group

```sql
-- Observer DB
SELECT es.*, u.name as user_name
FROM emergency_state es
JOIN users u ON u.id = es.user_id
WHERE es.group_id = 'group-uuid';
```

## Safety

- **Read-only by default.** Only run SELECT queries unless explicitly asked to modify data.
- **Never modify FusionAuth tables** (the `orion` database on prod RDS). Use the admin UI or API.
- **Staging is safe for writes.** Production writes need explicit permission.
