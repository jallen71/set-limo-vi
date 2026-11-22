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
