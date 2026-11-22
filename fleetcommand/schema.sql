-- Prototype PostgreSQL schema. Apply only to a NEW, isolated FleetCommand database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE operators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES operators(id),
 email text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('OWNER','DISPATCHER','DRIVER')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operator_id,email),
 UNIQUE(id,operator_id)
);
CREATE TABLE vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES operators(id),
 label text NOT NULL,
 capacity integer NOT NULL CHECK(capacity>0),
 UNIQUE(id,operator_id)
);
CREATE TABLE bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES operators(id),
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
 FOREIGN KEY(driver_id,operator_id) REFERENCES users(id,operator_id),
 FOREIGN KEY(vehicle_id,operator_id) REFERENCES vehicles(id,operator_id),
 UNIQUE(id,operator_id)
);
CREATE TABLE booking_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES operators(id),
 booking_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 action text NOT NULL,
 previous_state jsonb NOT NULL,
 next_state jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=5),
 FOREIGN KEY(booking_id,operator_id) REFERENCES bookings(id,operator_id),
 FOREIGN KEY(actor_id,operator_id) REFERENCES users(id,operator_id)
);
-- SECURITY REQUIREMENT: Each application request must set app.operator_id inside
-- a transaction after independently authenticating the actor. Never derive tenant
-- identity from an untrusted request field. Missing tenant context means zero rows.
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY operator_scope ON operators USING (id::text=current_setting('app.operator_id',true));
CREATE POLICY user_scope ON users USING (operator_id::text=current_setting('app.operator_id',true))
 WITH CHECK (operator_id::text=current_setting('app.operator_id',true));
CREATE POLICY vehicle_scope ON vehicles USING (operator_id::text=current_setting('app.operator_id',true))
 WITH CHECK (operator_id::text=current_setting('app.operator_id',true));
CREATE POLICY booking_scope ON bookings USING (operator_id::text=current_setting('app.operator_id',true))
 WITH CHECK (operator_id::text=current_setting('app.operator_id',true));
CREATE POLICY event_scope ON booking_events USING (operator_id::text=current_setting('app.operator_id',true))
 WITH CHECK (operator_id::text=current_setting('app.operator_id',true));
-- Production implementation must also enforce immutability of booking_events,
-- actor permissions, and atomic assignment/conflict checking in transactions.
