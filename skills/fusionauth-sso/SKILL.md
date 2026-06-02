# FusionAuth SSO User Management

Add, verify, or troubleshoot SSO users in Orion's FusionAuth instance. Use when asked to onboard a user to SSO, link a user to an identity provider, or debug SSO login failures.

## Prerequisites

- VPN connection to AWS (required for RDS access)
- Prod FusionAuth DB: `postgresql://postgres:$OBSERVER_PROD_PGPASSWORD@$OBSERVER_PROD_HOST:5432/orion?sslmode=require` (credentials in team secrets manager)
- Observer DB: same host, database `observer`

## Architecture

```
Customer IdP (OneLogin/Okta/Entra) --SAML--> FusionAuth --OAuth2/JWT--> Atlas Console --token--> api-go
```

FusionAuth is the identity broker. SSO login requires three things in the FusionAuth `orion` database:

1. **User record** (`users` table) - the FusionAuth user account
2. **Application registration** (`user_registrations` table) - links user to the Orion Atlas app (`3d050049-e208-4fa9-85c0-ca47e53f2a88`)
3. **Identity provider link** (`identity_provider_links` table) - maps the IdP assertion to the FusionAuth user

Most users already have #1 and #2 (created when their Orion account was provisioned). The common task is adding #3.

## Known Identity Providers

| Name | ID | Type | Customers |
|------|----|------|-----------|
| Transdev | `7cea0489-aa84-4879-9221-10c463a336d3` | SAML | MBTA (VTS, WeDriveU, Transdev domains) |

**Tenant ID** (all users): `0de7dafc-a589-c435-3065-66e5c5bce29f`

**External domains (Transdev IdP)**: vts.co, veteranstransportation.com, wedriveu.com, tractransdev.com, mbtatrac.com

## Add SSO for an Existing User

Given: email, user ID, org ID.

### Step 1: Verify user exists in FusionAuth

```sql
-- Check FusionAuth user + app registration
SELECT u.id, u.active, i.email, ur.applications_id
FROM users u
JOIN identities i ON i.users_id = u.id
LEFT JOIN user_registrations ur ON ur.users_id = u.id AND ur.applications_id = '3d050049-e208-4fa9-85c0-ca47e53f2a88'
WHERE u.id = '<USER_UUID_WITH_DASHES>'
   OR i.email = '<EMAIL>';
```

Expected: row with `active = true` and `applications_id` not null.

If no app registration exists, that's a separate problem (user was never registered for Orion Atlas). Fix via FusionAuth admin UI or API.

### Step 2: Check if IdP link already exists

```sql
SELECT ipl.identity_providers_id, ipl.identity_providers_user_id, ip.name
FROM identity_provider_links ipl
JOIN identity_providers ip ON ip.id = ipl.identity_providers_id
WHERE ipl.users_id = '<USER_UUID_WITH_DASHES>';
```

If a row exists for the correct IdP, the user is already linked. Problem is elsewhere.

### Step 3: Find the right IdP by checking existing users from the same domain

```sql
SELECT i.email, ipl.identity_providers_id, ipl.identity_providers_user_id, ip.name
FROM identity_provider_links ipl
JOIN identity_providers ip ON ip.id = ipl.identity_providers_id
JOIN identities i ON i.users_id = ipl.users_id
WHERE i.email LIKE '%@<DOMAIN>'
LIMIT 5;
```

This confirms which IdP to use and what format the `identity_providers_user_id` takes (usually the email address).

### Step 4: Insert the identity provider link

```sql
INSERT INTO identity_provider_links (
  data, identity_providers_id, identity_providers_user_id,
  tenants_id, insert_instant, last_login_instant, users_id
) VALUES (
  '{"data":{},"displayName":"<EMAIL>"}',
  '<IDP_ID>',
  '<EMAIL>',
  '0de7dafc-a589-c435-3065-66e5c5bce29f',
  EXTRACT(EPOCH FROM NOW()) * 1000,
  EXTRACT(EPOCH FROM NOW()) * 1000,
  '<USER_UUID_WITH_DASHES>'
);
```

**Column notes:**
- `data` (JSONB, NOT NULL): must be `{"data":{},"displayName":"<email>"}`, not null
- `insert_instant` (BIGINT, NOT NULL): epoch milliseconds
- `last_login_instant` (BIGINT, NOT NULL): epoch milliseconds, set to now
- `identity_providers_user_id`: usually the email, matches what the IdP sends in the SAML assertion NameID
- `users_id`: UUID format with dashes (e.g., `e7764b06-07f8-46f5-84c7-34905a52d616`)

### Step 5: Verify

```sql
SELECT ipl.identity_providers_user_id, ip.name, i.email
FROM identity_provider_links ipl
JOIN identity_providers ip ON ip.id = ipl.identity_providers_id
JOIN identities i ON i.users_id = ipl.users_id
WHERE ipl.users_id = '<USER_UUID_WITH_DASHES>';
```

User can now log in via SSO. For MBTA/Transdev users, that means logging in through OneLogin which redirects to `auth.orionlabs.io`.

## User ID Format

Orion user IDs are 32-char hex strings without dashes (e.g., `e7764b0607f846f584c734905a52d616`).
FusionAuth stores UUIDs with dashes (e.g., `e7764b06-07f8-46f5-84c7-34905a52d616`).

Convert: insert dashes at positions 8-4-4-4-12.

## Troubleshooting

| Symptom | Likely Cause |
|---------|-------------|
| "Registration Required" page after SSO | User exists in FusionAuth but missing app registration. Enable "Create Registration" on IdP config, or add manually. |
| SSO redirects but lands on blank login form | FusionAuth auto-click hack not present on that deploy. User needs `/log_in?sso` URL. |
| "User not found" after SSO | No FusionAuth user for that email. Create user first via Observer/API. |
| SSO works but Atlas shows "not authorized" | User exists in FusionAuth but not in Observer Postgres `users` + `organization_users` tables. |

## Safety

- NEVER edit FusionAuth's `data` JSONB columns on `users` or `applications` tables directly. Use the admin UI or API for those.
- `identity_provider_links` is safe to INSERT into directly (it's a simple mapping table).
- Always verify by querying existing users from the same domain first, to match the pattern.
