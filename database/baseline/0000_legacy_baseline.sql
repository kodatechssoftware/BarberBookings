-- Immutable schema baseline used only by `npm run db:bootstrap`.
--
-- This is the legacy application schema that existed before versioned
-- migration 0001. It deliberately contains DDL only: installation-specific
-- locations are created by 0001 and application identities are created by the
-- canonical /setup flow or by the preserved legacy startup policy.

CREATE TABLE {{schema}}.admins (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  email text UNIQUE,
  password text NOT NULL
);

CREATE TABLE {{schema}}.barbers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  specialty text NOT NULL,
  bio text,
  avatar text,
  email text UNIQUE,
  password text,
  color text NOT NULL DEFAULT '#D4AF37',
  is_visible boolean DEFAULT true
);

CREATE TABLE {{schema}}.services (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  agenda_label text,
  price integer NOT NULL,
  duration integer NOT NULL,
  is_visible boolean DEFAULT true
);

CREATE TABLE {{schema}}.appointments (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id),
  service_id integer REFERENCES {{schema}}.services(id),
  start_time timestamp NOT NULL,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'booked',
  cancel_token text NOT NULL,
  cancelled_at timestamp,
  payment_method text NOT NULL DEFAULT 'pending',
  deposit_required boolean NOT NULL DEFAULT false,
  deposit_reason text,
  created_at timestamp DEFAULT now(),
  CONSTRAINT appointments_payment_method_check
    CHECK (payment_method IN ('pending', 'cash', 'card', 'gift'))
);

CREATE TABLE {{schema}}.blacklist (
  id serial PRIMARY KEY,
  email text,
  phone text NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.verification_codes (
  id serial PRIMARY KEY,
  phone text NOT NULL,
  code text NOT NULL,
  expires_at timestamp NOT NULL,
  used boolean NOT NULL DEFAULT false
);

CREATE TABLE {{schema}}.shop_availability (
  id serial PRIMARY KEY,
  day_of_week integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  is_open boolean NOT NULL DEFAULT true
);

CREATE TABLE {{schema}}.barber_availability (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id),
  day_of_week integer NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  is_working boolean NOT NULL DEFAULT true
);

CREATE TABLE {{schema}}.barber_services (
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id),
  service_id integer NOT NULL REFERENCES {{schema}}.services(id),
  PRIMARY KEY (barber_id, service_id)
);

CREATE TABLE {{schema}}.barber_invites (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id),
  token text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.customer_notes (
  id serial PRIMARY KEY,
  phone text NOT NULL,
  customer_name_key text NOT NULL DEFAULT '',
  email text,
  notes text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_notes_phone_name_idx
  ON {{schema}}.customer_notes (phone, customer_name_key);

CREATE TABLE {{schema}}.audit_logs (
  id serial PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id integer,
  actor_name text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id integer,
  summary text NOT NULL,
  metadata text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE {{schema}}.business_expenses (
  id serial PRIMARY KEY,
  category text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL,
  expense_date timestamp NOT NULL,
  recurrence text NOT NULL DEFAULT 'once',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
