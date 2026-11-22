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
