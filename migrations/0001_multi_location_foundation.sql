CREATE TABLE IF NOT EXISTS {{schema}}.locations (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  address text NOT NULL DEFAULT '',
  map_url text,
  map_embed_url text,
  phone text,
  email text,
  timezone text NOT NULL DEFAULT 'Europe/Lisbon',
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE {{schema}}.locations ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE {{schema}}.locations ADD COLUMN IF NOT EXISTS email text;

INSERT INTO {{schema}}.locations (
  name, slug, address, map_url, map_embed_url, timezone, is_default
)
SELECT
  current_setting('barberbookings.default_location_name'),
  'principal',
  current_setting('barberbookings.default_location_address'),
  NULLIF(current_setting('barberbookings.default_location_map_url'), ''),
  NULLIF(current_setting('barberbookings.default_location_map_embed_url'), ''),
  current_setting('barberbookings.default_location_timezone'),
  true
WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.locations);

WITH selected AS (
  SELECT id FROM {{schema}}.locations ORDER BY is_default DESC, sort_order, id LIMIT 1
)
UPDATE {{schema}}.locations location
SET is_default = (location.id = selected.id), updated_at = now()
FROM selected
WHERE location.is_default IS DISTINCT FROM (location.id = selected.id);

CREATE UNIQUE INDEX IF NOT EXISTS locations_slug_idx ON {{schema}}.locations (slug);
CREATE UNIQUE INDEX IF NOT EXISTS locations_single_default_idx
  ON {{schema}}.locations (is_default) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS {{schema}}.barber_locations (
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (barber_id, location_id)
);
CREATE INDEX IF NOT EXISTS barber_locations_location_idx
  ON {{schema}}.barber_locations (location_id, barber_id);

CREATE TABLE IF NOT EXISTS {{schema}}.service_locations (
  service_id integer NOT NULL REFERENCES {{schema}}.services(id) ON DELETE CASCADE,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  price_override integer,
  duration_override integer,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (service_id, location_id),
  CONSTRAINT service_locations_price_override_check CHECK (price_override IS NULL OR price_override >= 0),
  CONSTRAINT service_locations_duration_override_check CHECK (duration_override IS NULL OR duration_override > 0)
);
CREATE INDEX IF NOT EXISTS service_locations_location_idx
  ON {{schema}}.service_locations (location_id, service_id);

ALTER TABLE {{schema}}.appointments ADD COLUMN IF NOT EXISTS location_id integer;
ALTER TABLE {{schema}}.shop_availability ADD COLUMN IF NOT EXISTS location_id integer;
ALTER TABLE {{schema}}.barber_availability ADD COLUMN IF NOT EXISTS location_id integer;
ALTER TABLE {{schema}}.business_expenses ADD COLUMN IF NOT EXISTS location_id integer;

UPDATE {{schema}}.appointments SET location_id = (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) WHERE location_id IS NULL;
UPDATE {{schema}}.shop_availability SET location_id = (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) WHERE location_id IS NULL;
UPDATE {{schema}}.barber_availability SET location_id = (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) WHERE location_id IS NULL;
UPDATE {{schema}}.business_expenses SET location_id = (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) WHERE location_id IS NULL;

ALTER TABLE {{schema}}.appointments ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE {{schema}}.shop_availability ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE {{schema}}.barber_availability ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE {{schema}}.business_expenses ALTER COLUMN location_id SET NOT NULL;

DO $migration$
DECLARE default_id integer;
BEGIN
  SELECT id INTO default_id FROM {{schema}}.locations WHERE is_default LIMIT 1;
  EXECUTE format('ALTER TABLE {{schema}}.appointments ALTER COLUMN location_id SET DEFAULT %s', default_id);
  EXECUTE format('ALTER TABLE {{schema}}.shop_availability ALTER COLUMN location_id SET DEFAULT %s', default_id);
  EXECUTE format('ALTER TABLE {{schema}}.barber_availability ALTER COLUMN location_id SET DEFAULT %s', default_id);
  EXECUTE format('ALTER TABLE {{schema}}.business_expenses ALTER COLUMN location_id SET DEFAULT %s', default_id);
END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN
  ALTER TABLE {{schema}}.shop_availability ADD CONSTRAINT shop_availability_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN
  ALTER TABLE {{schema}}.barber_availability ADD CONSTRAINT barber_availability_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
DO $migration$ BEGIN
  ALTER TABLE {{schema}}.business_expenses ADD CONSTRAINT business_expenses_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

CREATE INDEX IF NOT EXISTS appointments_location_id_idx ON {{schema}}.appointments (location_id);
CREATE INDEX IF NOT EXISTS shop_availability_location_id_idx ON {{schema}}.shop_availability (location_id);
CREATE INDEX IF NOT EXISTS barber_availability_location_id_idx ON {{schema}}.barber_availability (location_id);
CREATE INDEX IF NOT EXISTS business_expenses_location_id_idx ON {{schema}}.business_expenses (location_id);

INSERT INTO {{schema}}.barber_locations (barber_id, location_id)
SELECT barber.id, location.id
FROM {{schema}}.barbers barber
CROSS JOIN (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) location
WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.barber_locations assignment WHERE assignment.barber_id = barber.id)
ON CONFLICT (barber_id, location_id) DO NOTHING;

INSERT INTO {{schema}}.service_locations (service_id, location_id)
SELECT service.id, location.id
FROM {{schema}}.services service
CROSS JOIN (SELECT id FROM {{schema}}.locations WHERE is_default LIMIT 1) location
WHERE NOT EXISTS (SELECT 1 FROM {{schema}}.service_locations assignment WHERE assignment.service_id = service.id)
ON CONFLICT (service_id, location_id) DO NOTHING;
