# FleetCommand — Transportation SaaS pilot

A separate, multi-business transportation booking and dispatch application under development in `fleetcommand/`, built alongside the existing SET limo website without changing its live booking pages.

**Current status:** Tested pilot code on an isolated GitHub branch. Not deployed, no real test administrator login activated, no live payment collection. See [PILOT-RELEASE.md](PILOT-RELEASE.md) for the consolidated build, deployment instructions, and exact commercial blockers.

## Built

- Multi-operator database isolation and role-based owner/dispatcher/driver access
- PostgreSQL booking and public request intake, shared customer request links and dispatcher decisions
- Mobile-responsive operator dashboard and driver trip progress view
- Driver/vehicle assignment, capacity and schedule conflict prevention
- Booking activity logs, spreadsheet-safe CSV export
- Password hashing, login throttling, scoped sessions, CSRF checks, offline account invitations and account reset
- Disabled-by-default, recipient-allowlisted email-delivery adapter
- Provider-neutral subscription and external-receipt invoice records
- Node unit tests, PostgreSQL 16 integration tests, isolated Docker + Caddy staging deployment configuration

## Two modes

**Fictional in-memory demonstration** (no persistent records):

```bash
npm install
npm test
node src/demo-server.js
```

Visit `http://127.0.0.1:8787`; the two fictional users documented in `persistent/README.md` and the original demo tests can sign in with demo-only credentials. Data is deleted when the process stops.

**PostgreSQL pilot:** Isolated database, authenticated operators, guest intake and HTTPS proxy staging. The full configuration is documented in [PILOT-RELEASE.md](PILOT-RELEASE.md). All real email delivery and payments are opt-in, and external hosting and provider credentials have not been connected.

**Never point these commands or deployment files at the production SET app or its customer and financial records.**
