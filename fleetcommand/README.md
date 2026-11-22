# FleetCommand — MVP foundation

This isolated folder starts a multi-operator transportation booking/dispatch product.
The existing SET limo website and production booking workflow remain untouched.

## Implemented
- Pure booking validation and status-transition rules.
- Operator boundary checks on in-memory records.
- Driver and vehicle schedule conflict detection.
- Auditable status transitions without mutation of source objects.
- Proposed PostgreSQL schema with tenant keys and RLS policies.
- Node built-in test suite: run `npm test` inside this folder.

## Not yet implemented / NOT production ready
- Authenticated HTTP API, deployment, password/session lifecycle, subscriptions.
- Database migration execution, database integration tests, real PostgreSQL roles.
- Transactional schedule locks, immutable database events, production-grade tenant isolation.
- Operator/customer UI, driver Android/PWA interface, pricing, payment integrations.
- Multi-operator acceptance testing and payment-provider setup.

The schema is a design artifact, not a verified live database. Do not
run it against SET production systems. Do not expose this MVP publicly
before an authenticated API and tenancy isolation tests pass.

## Next build gate
Implement server-side authentication and tenant-scoped transactional booking
routes; verify in a dedicated test database, including attempts at cross-tenant
access and simultaneous overlapping vehicle assignments.

## Local operator dashboard milestone (fictional demo only)

A local HTTP API and responsive dispatcher interface now live in `src/demo-server.js` and `public/index.html`. No external connections or persistent records are used.

From `fleetcommand/` on a Node.js 22+ computer:

```bash
npm test
node src/demo-server.js
```

Open `http://127.0.0.1:8787` on that computer. The server binds to localhost only.

**Fictional test accounts only:**

- `operator-a@example.invalid` / `DemoOnly-A-2026!`
- `operator-b@example.invalid` / `DemoOnly-B-2026!`

Use these solely to verify separation between two fake businesses. These hardcoded demo credentials and the in-memory session store are NOT safe for production. No external booking messages, real payments, or subscriptions are implemented. Server restart clears all test bookings.

**Production acceptance remains blocked** until real authentication, persistent tenant-isolated storage, database isolation tests, conflict prevention under concurrent requests, CSRF/session hardening, and production deployment authorization have passed.
