CREATE TABLE IF NOT EXISTS {{schema}}.extra_definitions (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  amount_cents integer NOT NULL,
  financial_rule text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT extra_definitions_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  CONSTRAINT extra_definitions_amount_cents_check
    CHECK (amount_cents > 0 AND amount_cents <= 1000000),
  CONSTRAINT extra_definitions_financial_rule_check
    CHECK (financial_rule IN ('follow_compensation', 'barber', 'establishment')),
  CONSTRAINT extra_definitions_sort_order_check CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS extra_definitions_location_name_ci_idx
  ON {{schema}}.extra_definitions (location_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS extra_definitions_location_active_order_idx
  ON {{schema}}.extra_definitions (location_id, is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_extras (
  appointment_id integer NOT NULL REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  extra_definition_id integer NOT NULL REFERENCES {{schema}}.extra_definitions(id) ON DELETE RESTRICT,
  name_snapshot text NOT NULL,
  amount_cents_snapshot integer NOT NULL,
  financial_rule_snapshot text NOT NULL,
  position integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, extra_definition_id),
  CONSTRAINT appointment_extras_name_snapshot_check
    CHECK (btrim(name_snapshot) <> '' AND char_length(name_snapshot) <= 100),
  CONSTRAINT appointment_extras_amount_cents_snapshot_check
    CHECK (amount_cents_snapshot > 0 AND amount_cents_snapshot <= 1000000),
  CONSTRAINT appointment_extras_financial_rule_snapshot_check
    CHECK (financial_rule_snapshot IN ('follow_compensation', 'barber', 'establishment')),
  CONSTRAINT appointment_extras_position_check CHECK (position >= 0),
  CONSTRAINT appointment_extras_appointment_position_unique UNIQUE (appointment_id, position)
);

CREATE INDEX IF NOT EXISTS appointment_extras_extra_definition_id_idx
  ON {{schema}}.appointment_extras (extra_definition_id, appointment_id);
