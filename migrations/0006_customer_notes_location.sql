ALTER TABLE {{schema}}.customer_notes
  ADD COLUMN IF NOT EXISTS location_id integer;

UPDATE {{schema}}.customer_notes
SET location_id = (
  SELECT id
  FROM {{schema}}.locations
  ORDER BY is_default DESC, sort_order ASC, id ASC
  LIMIT 1
)
WHERE location_id IS NULL;

ALTER TABLE {{schema}}.customer_notes
  ALTER COLUMN location_id SET NOT NULL;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.customer_notes ADD CONSTRAINT customer_notes_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

CREATE INDEX IF NOT EXISTS customer_notes_location_id_idx
  ON {{schema}}.customer_notes (location_id);

CREATE UNIQUE INDEX IF NOT EXISTS customer_notes_location_phone_name_idx
  ON {{schema}}.customer_notes (location_id, phone, customer_name_key);

DROP INDEX IF EXISTS {{schema}}.customer_notes_phone_name_idx;
