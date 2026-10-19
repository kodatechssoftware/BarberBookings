CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_availability_windows (
  id serial PRIMARY KEY,
  appointment_id integer NOT NULL
    REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  start_time timestamp NOT NULL,
  end_time timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_availability_windows_range_check
    CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS appointment_availability_windows_appointment_order_idx
  ON {{schema}}.appointment_availability_windows (appointment_id, start_time, end_time);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_availability_windows_exact_unique
  ON {{schema}}.appointment_availability_windows (appointment_id, start_time, end_time);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.appointment_availability_windows'::regclass
      AND conname = 'appointment_availability_windows_no_overlap'
  ) THEN
    ALTER TABLE {{schema}}.appointment_availability_windows
      ADD CONSTRAINT appointment_availability_windows_no_overlap
      EXCLUDE USING gist (
        appointment_id WITH =,
        tsrange(start_time, end_time, '[)') WITH &&
      ) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- This is an internal projection of effective occupied time. Keeping it as
-- rows lets PostgreSQL retain concurrency-safe overlap protection even when a
-- long appointment exposes one or more gaps.
CREATE TABLE IF NOT EXISTS {{schema}}.appointment_occupancy_periods (
  appointment_id integer NOT NULL
    REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  position integer NOT NULL,
  barber_id integer NOT NULL
    REFERENCES {{schema}}.barbers(id) ON DELETE RESTRICT,
  start_time timestamp NOT NULL,
  end_time timestamp NOT NULL,
  PRIMARY KEY (appointment_id, position),
  CONSTRAINT appointment_occupancy_periods_range_check
    CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS appointment_occupancy_periods_barber_range_idx
  ON {{schema}}.appointment_occupancy_periods (barber_id, start_time, end_time);

CREATE OR REPLACE FUNCTION {{schema}}.rebuild_appointment_occupancy_periods(target_appointment_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row record;
  window_row record;
  occupied_from timestamp;
  operational_end timestamp;
  next_position integer := 0;
BEGIN
  DELETE FROM {{schema}}.appointment_occupancy_periods
  WHERE appointment_id = target_appointment_id;

  SELECT id, barber_id, start_time, duration_minutes,
         buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, status
  INTO appointment_row
  FROM {{schema}}.appointments
  WHERE id = target_appointment_id;

  IF NOT FOUND OR appointment_row.status <> 'booked' THEN
    RETURN;
  END IF;

  occupied_from := appointment_row.start_time
    - make_interval(mins => appointment_row.buffer_before_minutes_snapshot);
  operational_end := appointment_row.start_time
    + make_interval(mins => appointment_row.duration_minutes + appointment_row.buffer_after_minutes_snapshot);

  FOR window_row IN
    SELECT start_time, end_time
    FROM {{schema}}.appointment_availability_windows
    WHERE appointment_id = target_appointment_id
    ORDER BY start_time, end_time, id
  LOOP
    IF occupied_from < window_row.start_time THEN
      INSERT INTO {{schema}}.appointment_occupancy_periods (
        appointment_id, position, barber_id, start_time, end_time
      ) VALUES (
        appointment_row.id, next_position, appointment_row.barber_id,
        occupied_from, window_row.start_time
      );
      next_position := next_position + 1;
    END IF;
    IF window_row.end_time > occupied_from THEN
      occupied_from := window_row.end_time;
    END IF;
  END LOOP;

  IF occupied_from < operational_end THEN
    INSERT INTO {{schema}}.appointment_occupancy_periods (
      appointment_id, position, barber_id, start_time, end_time
    ) VALUES (
      appointment_row.id, next_position, appointment_row.barber_id,
      occupied_from, operational_end
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.validate_appointment_availability_windows(target_appointment_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row record;
BEGIN
  SELECT id, start_time, duration_minutes, series_id
  INTO appointment_row
  FROM {{schema}}.appointments
  WHERE id = target_appointment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF appointment_row.series_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM {{schema}}.appointment_availability_windows
    WHERE appointment_id = target_appointment_id
  ) THEN
    RAISE EXCEPTION 'Availability windows are not supported for recurring appointments.'
      USING ERRCODE = '23514', CONSTRAINT = 'appointment_availability_windows_non_recurring_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM {{schema}}.appointment_availability_windows
    WHERE appointment_id = target_appointment_id
      AND (
        start_time < appointment_row.start_time
        OR end_time > appointment_row.start_time + make_interval(mins => appointment_row.duration_minutes)
      )
  ) THEN
    RAISE EXCEPTION 'Availability windows must stay inside the commercial appointment interval.'
      USING ERRCODE = '23514', CONSTRAINT = 'appointment_availability_windows_inside_appointment_check';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.appointment_availability_windows_rebuild_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM {{schema}}.rebuild_appointment_occupancy_periods(OLD.appointment_id);
    RETURN OLD;
  END IF;
  PERFORM {{schema}}.rebuild_appointment_occupancy_periods(NEW.appointment_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.appointments_rebuild_occupancy_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM {{schema}}.rebuild_appointment_occupancy_periods(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.appointment_availability_windows_validate_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM {{schema}}.validate_appointment_availability_windows(OLD.appointment_id);
    RETURN OLD;
  END IF;
  PERFORM {{schema}}.validate_appointment_availability_windows(NEW.appointment_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.appointments_validate_availability_windows_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM {{schema}}.validate_appointment_availability_windows(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointment_availability_windows_rebuild
  ON {{schema}}.appointment_availability_windows;
CREATE TRIGGER appointment_availability_windows_rebuild
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.appointment_availability_windows
FOR EACH ROW EXECUTE FUNCTION {{schema}}.appointment_availability_windows_rebuild_trigger();

DROP TRIGGER IF EXISTS appointments_rebuild_occupancy
  ON {{schema}}.appointments;
CREATE TRIGGER appointments_rebuild_occupancy
AFTER INSERT OR UPDATE OF barber_id, start_time, duration_minutes,
  buffer_before_minutes_snapshot, buffer_after_minutes_snapshot, status
ON {{schema}}.appointments
FOR EACH ROW EXECUTE FUNCTION {{schema}}.appointments_rebuild_occupancy_trigger();

DROP TRIGGER IF EXISTS appointment_availability_windows_validate
  ON {{schema}}.appointment_availability_windows;
CREATE CONSTRAINT TRIGGER appointment_availability_windows_validate
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.appointment_availability_windows
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.appointment_availability_windows_validate_trigger();

DROP TRIGGER IF EXISTS appointments_validate_availability_windows
  ON {{schema}}.appointments;
CREATE CONSTRAINT TRIGGER appointments_validate_availability_windows
AFTER INSERT OR UPDATE OF start_time, duration_minutes, series_id ON {{schema}}.appointments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.appointments_validate_availability_windows_trigger();

-- Existing appointments have no windows and retain exactly their previous
-- continuous operational interval, including preparation buffers.
DO $$
DECLARE appointment_id integer;
BEGIN
  FOR appointment_id IN SELECT id FROM {{schema}}.appointments LOOP
    PERFORM {{schema}}.rebuild_appointment_occupancy_periods(appointment_id);
  END LOOP;
END $$;

-- The legacy constraint owns an index with the same name. Drop it only after
-- the internal projection has been fully backfilled; the whole migration is
-- transactional, so there is no externally visible protection gap.
ALTER TABLE {{schema}}.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_booked_overlap;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.appointment_occupancy_periods'::regclass
      AND conname = 'appointments_no_booked_overlap'
  ) THEN
    ALTER TABLE {{schema}}.appointment_occupancy_periods
      ADD CONSTRAINT appointments_no_booked_overlap
      EXCLUDE USING gist (
        barber_id WITH =,
        tsrange(start_time, end_time, '[)') WITH &&
      ) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
