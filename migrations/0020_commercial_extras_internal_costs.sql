ALTER TABLE {{schema}}.extra_definitions
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_publicly_bookable boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.extra_definitions'::regclass
      AND conname = 'extra_definitions_description_check'
  ) THEN
    ALTER TABLE {{schema}}.extra_definitions
      ADD CONSTRAINT extra_definitions_description_check
      CHECK (description IS NULL OR char_length(description) <= 500);
  END IF;
END $$;

ALTER TABLE {{schema}}.appointment_extras
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.appointment_extras'::regclass
      AND conname = 'appointment_extras_quantity_check'
  ) THEN
    ALTER TABLE {{schema}}.appointment_extras
      ADD CONSTRAINT appointment_extras_quantity_check
      CHECK (quantity BETWEEN 1 AND 99);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS {{schema}}.extra_definition_services (
  extra_definition_id integer NOT NULL
    REFERENCES {{schema}}.extra_definitions(id) ON DELETE CASCADE,
  service_id integer NOT NULL
    REFERENCES {{schema}}.services(id) ON DELETE RESTRICT,
  PRIMARY KEY (extra_definition_id, service_id)
);

CREATE INDEX IF NOT EXISTS extra_definition_services_service_idx
  ON {{schema}}.extra_definition_services (service_id, extra_definition_id);

CREATE TABLE IF NOT EXISTS {{schema}}.internal_cost_definitions (
  id serial PRIMARY KEY,
  location_id integer NOT NULL
    REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  default_unit_cost_cents integer NOT NULL,
  unit_label text NOT NULL DEFAULT 'unidade',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT internal_cost_definitions_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  CONSTRAINT internal_cost_definitions_description_check
    CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT internal_cost_definitions_unit_cost_check
    CHECK (default_unit_cost_cents BETWEEN 0 AND 1000000),
  CONSTRAINT internal_cost_definitions_unit_label_check
    CHECK (btrim(unit_label) <> '' AND char_length(unit_label) <= 40),
  CONSTRAINT internal_cost_definitions_sort_order_check
    CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS internal_cost_definitions_location_name_ci_idx
  ON {{schema}}.internal_cost_definitions (location_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS internal_cost_definitions_location_active_order_idx
  ON {{schema}}.internal_cost_definitions (location_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_internal_costs (
  id serial PRIMARY KEY,
  appointment_id integer NOT NULL
    REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  internal_cost_definition_id integer NOT NULL
    REFERENCES {{schema}}.internal_cost_definitions(id) ON DELETE RESTRICT,
  name_snapshot text NOT NULL,
  unit_cost_cents_snapshot integer NOT NULL,
  unit_label_snapshot text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  position integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_internal_costs_name_snapshot_check
    CHECK (btrim(name_snapshot) <> '' AND char_length(name_snapshot) <= 100),
  CONSTRAINT appointment_internal_costs_unit_cost_snapshot_check
    CHECK (unit_cost_cents_snapshot BETWEEN 0 AND 1000000),
  CONSTRAINT appointment_internal_costs_unit_label_snapshot_check
    CHECK (btrim(unit_label_snapshot) <> '' AND char_length(unit_label_snapshot) <= 40),
  CONSTRAINT appointment_internal_costs_quantity_check
    CHECK (quantity BETWEEN 1 AND 9999),
  CONSTRAINT appointment_internal_costs_position_check
    CHECK (position >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_internal_costs_definition_unique
  ON {{schema}}.appointment_internal_costs (appointment_id, internal_cost_definition_id);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_internal_costs_position_unique
  ON {{schema}}.appointment_internal_costs (appointment_id, position);

CREATE INDEX IF NOT EXISTS appointment_internal_costs_definition_idx
  ON {{schema}}.appointment_internal_costs (internal_cost_definition_id, appointment_id);

-- Existing commercial Extra snapshots retain their original meaning. Quantity
-- defaults to one, so historical totals remain byte-for-byte equivalent.
-- No internal cost rows are inferred from business expenses or old Extras.
