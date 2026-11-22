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
 UNIQUE(operator_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fc_users_email_unique ON fc_users(lower(email));
CREATE TABLE IF NOT EXISTS fc_sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES fc_users(id),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fc_vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES fc_operators(id),
 label text NOT NULL,
 capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 50),
 UNIQUE(operator_id,id)
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
-- Only the backend login path may inspect global account records.
-- All operational queries execute under a distinct, non-owner, non-BYPASSRLS database role.
ALTER TABLE fc_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fc_vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE fc_bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE fc_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fc_vehicles_tenant ON fc_vehicles;
DROP POLICY IF EXISTS fc_bookings_tenant ON fc_bookings;
DROP POLICY IF EXISTS fc_events_tenant ON fc_events;
CREATE POLICY fc_vehicles_tenant ON fc_vehicles USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
CREATE POLICY fc_bookings_tenant ON fc_bookings USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
CREATE POLICY fc_events_tenant ON fc_events USING (operator_id::text=current_setting('fleetcommand.operator_id',true)) WITH CHECK (operator_id::text=current_setting('fleetcommand.operator_id',true));
-- Service credentials must be scoped by GRANT outside this migration.
-- Deny UPDATE/DELETE on fc_events to the operational database role.
