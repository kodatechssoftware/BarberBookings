ALTER TABLE {{schema}}.appointments
  ADD COLUMN IF NOT EXISTS service_name_snapshot text,
  ADD COLUMN IF NOT EXISTS service_price_cents_snapshot integer,
  ADD COLUMN IF NOT EXISTS manual_outside_hours boolean NOT NULL DEFAULT false;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_service_snapshot_pair_check CHECK (
    (service_name_snapshot IS NULL AND service_price_cents_snapshot IS NULL)
    OR (service_name_snapshot IS NOT NULL AND service_price_cents_snapshot IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_service_name_snapshot_check CHECK (
    service_name_snapshot IS NULL
    OR (btrim(service_name_snapshot) <> '' AND char_length(service_name_snapshot) <= 100)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_service_price_snapshot_check CHECK (
    service_price_cents_snapshot IS NULL
    OR (service_price_cents_snapshot >= 0 AND service_price_cents_snapshot <= 1000000)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;
