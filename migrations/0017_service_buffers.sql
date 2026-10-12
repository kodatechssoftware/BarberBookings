CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE {{schema}}.service_locations
  ADD COLUMN IF NOT EXISTS buffer_before_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE {{schema}}.appointments
  ADD COLUMN IF NOT EXISTS buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.service_locations'::regclass
      AND conname = 'service_locations_buffer_minutes_check'
  ) THEN
    ALTER TABLE {{schema}}.service_locations
      ADD CONSTRAINT service_locations_buffer_minutes_check
      CHECK (
        buffer_before_minutes BETWEEN 0 AND 720
        AND buffer_after_minutes BETWEEN 0 AND 720
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.appointments'::regclass
      AND conname = 'appointments_buffer_snapshot_check'
  ) THEN
    ALTER TABLE {{schema}}.appointments
      ADD CONSTRAINT appointments_buffer_snapshot_check
      CHECK (
        buffer_before_minutes_snapshot BETWEEN 0 AND 720
        AND buffer_after_minutes_snapshot BETWEEN 0 AND 720
      );
  END IF;
END $$;

ALTER TABLE {{schema}}.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_booked_overlap;

ALTER TABLE {{schema}}.appointments
  ADD CONSTRAINT appointments_no_booked_overlap
  EXCLUDE USING gist (
    barber_id WITH =,
    tsrange(
      start_time - make_interval(mins => buffer_before_minutes_snapshot),
      start_time + make_interval(mins => duration_minutes + buffer_after_minutes_snapshot),
      '[)'
    ) WITH &&
  )
  WHERE (status = 'booked');
