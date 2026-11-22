-- Isolated FleetCommand PostgreSQL database only. Never run against SET production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS fc_operators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name))>1)
);
CREATE TABLE IF NOT EXISTS fc_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 email text NOT NULL,
 password_salt text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('OWNER','DISPATCHER','DRIVER')),
 disabled boolean NOT NULL DEFAULT false,
 email_verified boolean NOT NULL DEFAULT true,
 UNIQUE(operator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fc_users_email_unique ON fc_users(lower(email));
CREATE TABLE IF NOT EXISTS fc_sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES fc_users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Single-use invitation/verification and password-reset records; never store raw tokens.
CREATE TABLE IF NOT EXISTS fc_account_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES fc_users(id),
 purpose text NOT NULL CHECK(purpose IN ('ACTIVATE','RESET')),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fc_account_tokens_user ON fc_account_tokens(user_id,purpose);
-- Login throttling persists across backend restarts. Store only hashed email keys.
CREATE TABLE IF NOT EXISTS fc_login_attempts (
 email_key text PRIMARY KEY,
 failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
 window_started_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS fc_vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 label text NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 50),
 UNIQUE(operator_id,id)
);
CREATE TABLE IF NOT EXISTS fc_drivers (
 user_id uuid NOT NULL,
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 display_name text NOT NULL,
 PRIMARY KEY(user_id),
 FOREIGN KEY(operator_id,user_id) REFERENCES fc_users(operator_id,id)
);
CREATE TABLE IF NOT EXISTS fc_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 customer_name text NOT NULL,
 pickup text NOT NULL,
 dropoff text NOT NULL,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 passengers integer NOT NULL CHECK(passengers BETWEEN 1 AND 50),
 status text NOT NULL CHECK(status IN ('REQUESTED','CONFIRMED','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
 driver_id uuid,
 vehicle_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at),
 UNIQUE(operator_id,id),
 FOREIGN KEY(operator_id,driver_id) REFERENCES fc_users(operator_id,id),
 FOREIGN KEY(operator_id,vehicle_id) REFERENCES fc_vehicles(operator_id,id)
);
CREATE TABLE IF NOT EXISTS fc_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 booking_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 previous_status text,
 new_status text NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(operator_id,booking_id) REFERENCES fc_bookings(operator_id,id),
 FOREIGN KEY(operator_id,actor_id) REFERENCES fc_users(operator_id,id)
);
-- Offline-only administrative audit. Operational and login roles get no access.
CREATE TABLE IF NOT EXISTS fc_admin_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 subject_user_id uuid NOT NULL REFERENCES fc_users(id),
 operation text NOT NULL CHECK(operation IN ('OPERATOR_CREATED','USER_CREATED','USER_DISABLED')),
 performed_by text NOT NULL CHECK(length(trim(performed_by))>=3),
 reason text NOT NULL CHECK(length(trim(reason))>=12),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
-- Billing events are updated exclusively by a separate restricted webhook role.
CREATE TABLE IF NOT EXISTS fc_subscriptions (
 operator_id uuid PRIMARY KEY REFERENCES fc_operators(id),
 provider text NOT NULL DEFAULT 'MANUAL' CHECK(provider IN ('MANUAL','PAYPAL','OTHER')),
 provider_customer_id text UNIQUE,
 provider_subscription_id text UNIQUE,
 plan text NOT NULL DEFAULT 'PILOT' CHECK(plan IN ('PILOT','STARTER','BUSINESS','PRO')),
 status text NOT NULL DEFAULT 'PILOT' CHECK(status IN ('PILOT','INCOMPLETE','TRIALING','ACTIVE','PAST_DUE','UNPAID','CANCELED')),
 current_period_end timestamptz,
 last_event_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fc_billing_events (
 provider_event_id text PRIMARY KEY,
 event_type text NOT NULL,
 event_created_at timestamptz NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now()
);
-- Only the backend login path may inspect global account records.
-- All operational queries execute under a distinct, non-owner, non-BYPASSRLS database role.
ALTER TABLE fc_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_drivers FORCE ROW LEVEL SECURITY;
ALTER TABLE fc_vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE fc_bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE fc_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fc_drivers_tenant ON fc_drivers;
DROP POLICY IF EXISTS fc_vehicles_tenant ON fc_vehicles;
DROP POLICY IF EXISTS fc_bookings_tenant ON fc_bookings;
DROP POLICY IF EXISTS fc_events_tenant ON fc_events;
CREATE POLICY fc_drivers_tenant ON fc_drivers USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
CREATE POLICY fc_vehicles_tenant ON fc_vehicles USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
CREATE POLICY fc_bookings_tenant ON fc_bookings USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
CREATE POLICY fc_events_tenant ON fc_events USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
-- Service credentials must be scoped by GRANT outside this migration.
-- Deny UPDATE/DELETE on fc_events to the operational database role.
