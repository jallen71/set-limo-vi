# Persistent backend (not yet wired to public HTTP routes)

This development-only PostgreSQL adapter adds salted scrypt password hashes,
hashed expiring sessions, operator-scoped transactions, and transaction-locked
driver/vehicle assignments. It does **not** connect to the live SET site.

## Critical deployment security requirements

- Use two distinct PostgreSQL connections: an authentication role limited to
  `fc_users` and `fc_sessions`, and a separate operational role limited to
  `fc_bookings`, `fc_vehicles`, and append-only `fc_events`.
- The operational role **must not** own these tables or have `BYPASSRLS`,
  and must not have permission to `UPDATE` or `DELETE` events.
- The operational role must **not** have permission to edit operator IDs,
  bypass an audit trail, or assume unrestricted database ownership.
- Authentication SQL reads are outside the tenant-scoped role by necessity;
  no operator API may expose global user or session information.
- Database role provisioning and secrets must be externally managed and verified;
  this directory is not a deployment configuration.
- Authenticate first, derive the tenant exclusively from the authenticated
  user record, then set `fleetcommand.operator_id` **within each transaction**.
- Test RLS with separate real database credentials before exposing an endpoint.
- Add request throttling, secure transport, session lifecycle, password recovery,
  DB migrations, crash recovery and integration tests before production launch.

`001_schema.sql` is intended **only** for a new isolated PostgreSQL database.
No real company account or data was modified. The existing localhost fictional
demo remains independent and unchanged.

## Persistent dashboard gateway (new development stage)

`persistent/server.js` exposes the same booking, transition, history and
login endpoints expected by the existing local dashboard. It uses
`FleetRepository` and the PostgreSQL driver, but **has not been validated
against a real PostgreSQL database**.

Start only with a completely isolated test database after the schema has been
applied and separate roles provisioned. Required environment variables:

- `FLEETCOMMAND_DEV_ACK=ISOLATED_TEST_DATABASE`
- `FLEETCOMMAND_AUTH_DATABASE_URL` (restricted auth role)
- `FLEETCOMMAND_OPERATIONS_DATABASE_URL` (restricted operational role)
- Optional `FLEETCOMMAND_DEV_PORT` (default 8788)

Run `npm install`, then `npm test` and `npm run dev:persistent`.
The gateway binds to `127.0.0.1` only. There are no seeded real users:
test-account setup and database permission validation remain prerequisites.

### Known pre-production blockers

- **Real PostgreSQL** RLS/role permission tests, including cross-tenant
  SELECT/UPDATE and events immutability, are NOT yet complete.
- Authentication rate limits, secure password recovery, proper browser
  sessions/cookie protection and TLS reverse proxy are NOT implemented.
- Schema migration management and trusted test-user provisioning are absent.
- Driver/vehicle authorization and overlapping assignments still require
  concurrent database integration tests.
- The existing dashboard exposes assignment prompts and local demo styling;
  real operator UX and Android device testing are incomplete.
- Do not merge as an internet-facing deployment and do not point at the
  live SET booking system or its customer data.

## Offline operator onboarding (development only)

`provisioning.js` adds an explicitly offline-only `OperatorProvisioner`
for creating an operator with its first OWNER, adding authorized staff, and
disabling accounts while revoking their sessions. Passwords are salted and
hashed; no password is returned. Each operation requires a named administrative
actor and a correction reason, and writes to `fc_admin_events` in the same
transaction. The operational and login database roles have no access to that
audit table. All tests use fictional customers.

This is **not** a public invitation or self-signup endpoint. There is no
user-facing onboarding yet. Production provisioning requires an authorized
admin interface, privileged credential management, user identity verification,
and operational policy for restoring owner access. Do not grant administrative
database rights to the web server.

**Still blocking public launch:** login rate-limiting and brute-force
protection; email verification; password recovery; secure browser cookie
sessions and CSRF protections; approved initial admin provisioning; staging
deployment and Android device tests.

## Browser login-hardening milestone (development branch)

- Account-level failed-login attempts are stored by SHA-256 email identifier in
  PostgreSQL, serialized with an advisory lock, with a 5-attempt / 15-minute
  lockout window. Account lockout can also be triggered maliciously, so a
  production login service still needs an IP/network-level abuse defense.
- The persistent gateway now uses a SameSite=Strict, HttpOnly session cookie;
  the bearer token is no longer returned to the browser for that gateway.
  The original **fictional local demo** remains unchanged.
- The persistent browser UI sends a CSRF header; the gateway checks it
  against the authenticated session and checks the exact same-origin request.
- This build binds to localhost HTTP only. The cookie deliberately lacks
  Secure in development; a real TLS-only deployment must add Secure cookies,
  a trusted-host proxy configuration, and a distributable session/CSRF store.
- The CSRF binding is in server memory, so gateway restarts require fresh login.
  This is an intentional development limitation, not production session design.
- Authenticated operator creation remains offline-only. No email activation
  or password recovery mechanism is present.

Do not expose this development server publicly. Validate complete browser
behavior and multi-replica session behavior before commercial release.

## Invitation activation and password-reset foundation

The offline `OperatorProvisioner.inviteUser` method creates a user with an
unusable random password and `email_verified=false`. These users are denied
login until activation.

`AccountRecovery` provides trusted-server-only `issue(email,purpose)` and
`consume(token,purpose,newPassword)` methods. Purpose is `ACTIVATE` or
`RESET`. Activation tokens expire after 24 hours and reset tokens after
30 minutes. Issuing a replacement invalidates the previous token of that
purpose. Redemption is single-use, sets a fresh salted password, and revokes
all existing sessions. The database stores only SHA-256 token hashes.

This is **not an operational customer recovery service**: issuance returns
the raw one-time token only to an internal trusted delivery adapter; email
delivery is NOT configured, and neither issuance nor consumption is exposed
as a public endpoint. No real emails are sent. The dedicated recovery role
has no permission to assign roles or disable accounts.

**Before allowing real customers:** create a trusted email-delivery worker
that never logs secrets or returns token data to callers, rate-limit recovery
requests, verify a branded HTTPS origin, handle retries and expiry UX, and
test account activation and reset end to end through the deployed service.

## Authorized test administrator contact (designation only)

The project owner selected `testingthings@gmail.com` as the **test
administrator email** for FleetCommand acceptance testing. This is a
contact designation, **not** an activated user account or a database grant.

When the isolated test deployment and trusted delivery worker are ready,
provision this address through the authenticated onboarding process as the
pilot OWNER/test administrator, deliver a single-use activation link, and
verify the account is activated by its recipient. Do not create hardcoded
credentials or place activation secrets in this repository. Do not grant
production authority automatically based only on this document.

Test messages must be explicitly enabled for this address; no real email
or live transaction is triggered by this designation.
