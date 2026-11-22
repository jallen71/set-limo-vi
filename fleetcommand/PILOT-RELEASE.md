# FleetCommand — Isolated Pilot Release Candidate

**Scope:** A multi-operator transportation booking, dispatcher and driver web application. The project is contained entirely under `fleetcommand/` in `jallen71/set-limo-vi`. Nothing in these instructions deploys or alters the existing SET limo website.

## Shipped in this development branch

- Independent business accounts with owner/dispatcher/driver roles and hashed-password login.
- PostgreSQL tenant row-level security, separate authentication, operations, recovery and guest database roles.
- Account invitations, activation and password-reset tokens; opt-in allowlisted email delivery.
- Company-owned customer booking link; customer request form; dispatcher review and explicit acceptance or decline; immutable intake decisions.
- Booking lifecycle, vehicle and driver selection, passenger-capacity checks, conflicting-dispatch prevention, and driver-restricted trip status changes.
- Booking CSV export with spreadsheet-formula sanitization and immutable status event trail.
- Read-only owner billing summary and offline, audited manual invoice issuance, verified-receipt reconciliation and voiding.
- PostgreSQL 16 service tests in GitHub Actions and Docker Compose / Caddy configuration validation.

## Operational limitations

**Do not describe this as publicly launched or receiving live payments.**

- Hosting provider, owned pilot domain with DNS, and HTTPS certificate provisioning have not been exercised in a real deployment.
- No email provider key, verified sending domain or actual message delivery is connected; `testingthings@gmail.com` remains a designated test administrator, not an active login.
- The email, account and customer request forms have automated code and API tests, not human Android/browser acceptance.
- The browser CSRF store and public request throttles are process-local and unsuitable for load-balanced production; use a shared store and edge-level defenses before real customer data.
- Manual invoice recording is **not** payment processing. Paid status is entered only following independent external receipt verification.
- Subscription merchant account eligibility in the U.S. Virgin Islands has not been established. Stripe's official eligibility guidance explicitly excludes businesses based in the USVI; **do not use Stripe as the assumed payment provider.**
- No subscription checkout, hosted credit card collection, tax engine, client reminders, or payment receipts are issued by the application.
- Backup/restore drills, comprehensive privacy review, accessibility/mobile device acceptance and real-money reconciliation are required before customer launch.
- The pilot stack is designed for fictional test data until those gates pass.

## Automated tests

GitHub Actions executes three independent jobs on the development branch:
1. Unit/API tests with Node 22, including public booking requests and CSV safeguards.
2. PostgreSQL 16 integration tests with fictitious companies and least-privilege app roles.
3. Docker Compose syntax checks and Caddy reverse-proxy configuration validation.

Check the current results in `Actions → FleetCommand core and PostgreSQL tests`. Passing code tests are not proof that any external sender, domain, database host or payment provider is connected.

## Isolated pilot deployment procedure

Use a host dedicated to FleetCommand. Never reuse SET's production data sources, credentials or domain deployment.

1. Create a domain under your control, point DNS to the isolated pilot server and allow Caddy to obtain an HTTPS certificate.
2. Place this `fleetcommand/` directory on the server with Docker Compose available.
3. Copy `.env.compose.example` to a private `.env`; replace every placeholder with **distinct URL-safe secrets of at least 20 characters** and a real test domain. Keep it outside the repository.
4. Run `docker compose -f docker-compose.pilot.yml up --build -d` from `fleetcommand/`. This provisions the isolated PostgreSQL schema and four restricted roles. It does not create any test administrator.
5. Only after verifying HTTPS and the isolated database, configure a verified email sender with the Resend API key. Then run `docker compose --profile onboarding -f docker-compose.pilot.yml run --rm invite-test-admin` once to create or reuse a pending test OWNER at `testingthings@gmail.com`, issue an expiring activation token and request email delivery.
6. The designated test recipient activates via the emailed one-time link, logs into the pilot domain, adds a fictional vehicle, and an authorized admin invites a fictional driver using `admin/invite-staff.mjs` with an isolated administrative connection.
7. The test owner generates a booking link. A fictional customer submits a request. A dispatcher accepts it, confirms it and assigns an available driver and vehicle. The driver marks the trip in progress and completed. Test CSV export, disabled accounts and cross-tenant isolation.
8. Confirm runtime backups and a restore drill before using any personal information outside fictitious tests.

**Never publish `.env`, email API keys, database credentials or activation tokens to GitHub or frontend JavaScript.**

## Provider-neutral pilot monetization

Provisional plans: Starter $49/month, Business $99/month, Pro $149/month. These prices remain subject to customer validation. Invoice issue/void/settle is supported through `admin/manual-invoice.mjs` using a separate trusted admin database connection. The app does not auto-charge customers; an admin may only record PAID after independently verifying an external settlement receipt. Every change creates an append-only billing audit record.

## Go/no-go

- **Code foundation:** Automated tests must all pass at the exact release commit.
- **Private pilot with synthetic data:** Complete the HTTPS domain and administrator activation test; test with a real browser and Android device.
- **Real customer data:** Add shared security controls, backup recovery verification, privacy/retention review and operational monitoring.
- **Commercial launch:** Confirm eligible merchant billing or an approved manual collection workflow, run real receipt reconciliation and obtain actual pilot customers.
