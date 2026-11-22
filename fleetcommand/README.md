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
