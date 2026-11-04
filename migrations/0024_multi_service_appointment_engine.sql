CREATE TABLE IF NOT EXISTS {{schema}}.appointment_service_sets (
  appointment_id integer PRIMARY KEY
    REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_service_segments (
  id serial PRIMARY KEY,
  appointment_id integer NOT NULL
    REFERENCES {{schema}}.appointment_service_sets(appointment_id) ON DELETE CASCADE,
  position integer NOT NULL,
  service_id integer NOT NULL
    REFERENCES {{schema}}.services(id) ON DELETE RESTRICT,
  barber_id integer NOT NULL
    REFERENCES {{schema}}.barbers(id) ON DELETE RESTRICT,
  start_time timestamp NOT NULL,
  duration_minutes integer NOT NULL,
  buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
  buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0,
  service_name_snapshot text NOT NULL,
  service_price_cents_snapshot integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_service_segments_position_check
    CHECK (position >= 0 AND position < 12),
  CONSTRAINT appointment_service_segments_duration_check
    CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  CONSTRAINT appointment_service_segments_buffers_check
    CHECK (
      buffer_before_minutes_snapshot BETWEEN 0 AND 720
      AND buffer_after_minutes_snapshot BETWEEN 0 AND 720
    ),
  CONSTRAINT appointment_service_segments_name_check
    CHECK (btrim(service_name_snapshot) <> '' AND char_length(service_name_snapshot) <= 100),
  CONSTRAINT appointment_service_segments_price_check
    CHECK (service_price_cents_snapshot BETWEEN 0 AND 1000000),
  CONSTRAINT appointment_service_segments_appointment_position_unique
    UNIQUE (appointment_id, position)
);

CREATE INDEX IF NOT EXISTS appointment_service_segments_appointment_idx
  ON {{schema}}.appointment_service_segments (appointment_id, position);

CREATE INDEX IF NOT EXISTS appointment_service_segments_barber_time_idx
  ON {{schema}}.appointment_service_segments (barber_id, start_time);

CREATE OR REPLACE FUNCTION {{schema}}.rebuild_appointment_occupancy_periods(target_appointment_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row {{schema}}.appointments%ROWTYPE;
  has_service_set boolean;
BEGIN
  DELETE FROM {{schema}}.appointment_occupancy_periods
  WHERE appointment_id = target_appointment_id;

  SELECT * INTO appointment_row
  FROM {{schema}}.appointments
  WHERE id = target_appointment_id;

  IF NOT FOUND OR appointment_row.status <> 'booked' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM {{schema}}.appointment_service_sets
    WHERE appointment_id = target_appointment_id
  ) INTO has_service_set;

  IF has_service_set THEN
    WITH segment_periods AS (
      SELECT
        barber_id,
        start_time - make_interval(mins => buffer_before_minutes_snapshot) AS occupied_start,
        start_time + make_interval(mins => duration_minutes + buffer_after_minutes_snapshot) AS occupied_end
      FROM {{schema}}.appointment_service_segments
      WHERE appointment_id = target_appointment_id
    ),
    ordered_periods AS (
      SELECT
        *,
        max(occupied_end) OVER (
          PARTITION BY barber_id
          ORDER BY occupied_start, occupied_end
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS previous_max_end
      FROM segment_periods
    ),
    grouped_periods AS (
      SELECT
        *,
        sum(CASE
          WHEN previous_max_end IS NULL OR occupied_start > previous_max_end THEN 1
          ELSE 0
        END) OVER (
          PARTITION BY barber_id
          ORDER BY occupied_start, occupied_end
        ) AS period_group
      FROM ordered_periods
    ),
    merged_periods AS (
      SELECT
        barber_id,
        min(occupied_start) AS occupied_start,
        max(occupied_end) AS occupied_end
      FROM grouped_periods
      GROUP BY barber_id, period_group
    )
    INSERT INTO {{schema}}.appointment_occupancy_periods (
      appointment_id, position, barber_id, start_time, end_time
    )
    SELECT
      target_appointment_id,
      row_number() OVER (ORDER BY occupied_start, occupied_end, barber_id) - 1,
      barber_id,
      occupied_start,
      occupied_end
    FROM merged_periods
    ORDER BY occupied_start, occupied_end, barber_id;
    RETURN;
  END IF;

  WITH bounds AS (
    SELECT
      appointment_row.start_time
        - make_interval(mins => appointment_row.buffer_before_minutes_snapshot) AS occupied_start,
      appointment_row.start_time
        + make_interval(mins => appointment_row.duration_minutes + appointment_row.buffer_after_minutes_snapshot) AS occupied_end
  ),
  clipped_windows AS (
    SELECT
      greatest(availability_window.start_time, bounds.occupied_start) AS window_start,
      least(availability_window.end_time, bounds.occupied_end) AS window_end
    FROM {{schema}}.appointment_availability_windows availability_window
    CROSS JOIN bounds
    WHERE availability_window.appointment_id = target_appointment_id
      AND availability_window.start_time < bounds.occupied_end
      AND availability_window.end_time > bounds.occupied_start
  ),
  ordered_windows AS (
    SELECT
      window_start,
      window_end,
      max(window_end) OVER (
        ORDER BY window_start, window_end
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS previous_max_end
    FROM clipped_windows
  ),
  grouped_windows AS (
    SELECT
      window_start,
      window_end,
      sum(CASE
        WHEN previous_max_end IS NULL OR window_start > previous_max_end THEN 1
        ELSE 0
      END) OVER (ORDER BY window_start, window_end) AS window_group
    FROM ordered_windows
  ),
  merged_windows AS (
    SELECT min(window_start) AS window_start, max(window_end) AS window_end
    FROM grouped_windows
    GROUP BY window_group
  ),
  occupied_periods AS (
    SELECT
      bounds.occupied_start AS period_start,
      coalesce(first_window.window_start, bounds.occupied_end) AS period_end
    FROM bounds
    LEFT JOIN LATERAL (
      SELECT window_start FROM merged_windows ORDER BY window_start, window_end LIMIT 1
    ) first_window ON true

    UNION ALL

    SELECT
      current_window.window_end AS period_start,
      coalesce(next_window.window_start, bounds.occupied_end) AS period_end
    FROM merged_windows current_window
    CROSS JOIN bounds
    LEFT JOIN LATERAL (
      SELECT window_start
      FROM merged_windows candidate
      WHERE candidate.window_start > current_window.window_start
      ORDER BY candidate.window_start, candidate.window_end
      LIMIT 1
    ) next_window ON true
  )
  INSERT INTO {{schema}}.appointment_occupancy_periods (
    appointment_id, position, barber_id, start_time, end_time
  )
  SELECT
    target_appointment_id,
    row_number() OVER (ORDER BY period_start, period_end) - 1,
    appointment_row.barber_id,
    period_start,
    period_end
  FROM occupied_periods
  WHERE period_start < period_end
  ORDER BY period_start, period_end;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.refresh_appointment_occupancy_from_service_segments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM {{schema}}.rebuild_appointment_occupancy_periods(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.appointment_id ELSE NEW.appointment_id END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS appointment_service_sets_refresh_occupancy
  ON {{schema}}.appointment_service_sets;
CREATE TRIGGER appointment_service_sets_refresh_occupancy
AFTER INSERT OR DELETE ON {{schema}}.appointment_service_sets
FOR EACH ROW EXECUTE FUNCTION {{schema}}.refresh_appointment_occupancy_from_service_segments();

DROP TRIGGER IF EXISTS appointment_service_segments_refresh_occupancy
  ON {{schema}}.appointment_service_segments;
CREATE TRIGGER appointment_service_segments_refresh_occupancy
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.appointment_service_segments
FOR EACH ROW EXECUTE FUNCTION {{schema}}.refresh_appointment_occupancy_from_service_segments();

CREATE OR REPLACE FUNCTION {{schema}}.validate_multi_service_appointment(target_appointment_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row {{schema}}.appointments%ROWTYPE;
  has_service_set boolean;
  segment_count integer;
  first_segment {{schema}}.appointment_service_segments%ROWTYPE;
  last_segment {{schema}}.appointment_service_segments%ROWTYPE;
  total_price bigint;
  total_duration integer;
  invalid_sequence boolean;
BEGIN
  SELECT * INTO appointment_row
  FROM {{schema}}.appointments
  WHERE id = target_appointment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM {{schema}}.appointment_service_sets
    WHERE appointment_id = target_appointment_id
  ) INTO has_service_set;

  SELECT count(*) INTO segment_count
  FROM {{schema}}.appointment_service_segments
  WHERE appointment_id = target_appointment_id;

  IF NOT has_service_set THEN
    IF segment_count <> 0 THEN
      RAISE EXCEPTION 'Legacy appointment % cannot contain service segments', target_appointment_id
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  IF segment_count < 2 OR segment_count > 12 THEN
    RAISE EXCEPTION 'Multi-service appointment % must contain between 2 and 12 segments', target_appointment_id
      USING ERRCODE = '23514';
  END IF;

  IF appointment_row.series_id IS NOT NULL THEN
    RAISE EXCEPTION 'Multi-service appointment % cannot belong to a recurring series', target_appointment_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM {{schema}}.appointment_availability_windows
    WHERE appointment_id = target_appointment_id
  ) THEN
    RAISE EXCEPTION 'Multi-service appointment % cannot contain availability windows', target_appointment_id
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO first_segment
  FROM {{schema}}.appointment_service_segments
  WHERE appointment_id = target_appointment_id
  ORDER BY position
  LIMIT 1;

  SELECT * INTO last_segment
  FROM {{schema}}.appointment_service_segments
  WHERE appointment_id = target_appointment_id
  ORDER BY position DESC
  LIMIT 1;

  SELECT
    sum(service_price_cents_snapshot),
    sum(duration_minutes),
    bool_or(position <> expected_position OR (position > 0 AND start_time <> previous_end))
  INTO total_price, total_duration, invalid_sequence
  FROM (
    SELECT
      position,
      service_price_cents_snapshot,
      duration_minutes,
      start_time,
      lag(start_time + make_interval(mins => duration_minutes)) OVER (ORDER BY position) AS previous_end,
      row_number() OVER (ORDER BY position) - 1 AS expected_position
    FROM {{schema}}.appointment_service_segments
    WHERE appointment_id = target_appointment_id
  ) ordered_segments;

  IF invalid_sequence
    OR first_segment.position <> 0
    OR first_segment.start_time <> appointment_row.start_time
    OR first_segment.service_id <> appointment_row.service_id
    OR first_segment.barber_id <> appointment_row.barber_id
    OR total_duration <> appointment_row.duration_minutes
    OR total_price <> appointment_row.service_price_cents_snapshot
    OR first_segment.buffer_before_minutes_snapshot <> appointment_row.buffer_before_minutes_snapshot
    OR last_segment.buffer_after_minutes_snapshot <> appointment_row.buffer_after_minutes_snapshot THEN
    RAISE EXCEPTION 'Multi-service appointment % summary or segment sequence is inconsistent', target_appointment_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.validate_multi_service_appointment_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'appointment_service_sets' AND TG_OP = 'DELETE'
    AND EXISTS (
      SELECT 1 FROM {{schema}}.appointments WHERE id = OLD.appointment_id
    ) THEN
    RAISE EXCEPTION 'A multi-service marker cannot be removed while appointment % exists', OLD.appointment_id
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.appointment_id <> NEW.appointment_id THEN
    PERFORM {{schema}}.validate_multi_service_appointment(OLD.appointment_id);
  END IF;
  PERFORM {{schema}}.validate_multi_service_appointment(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.appointment_id ELSE NEW.appointment_id END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.validate_multi_service_parent_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM {{schema}}.validate_multi_service_appointment(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS appointment_service_sets_validate
  ON {{schema}}.appointment_service_sets;
CREATE CONSTRAINT TRIGGER appointment_service_sets_validate
AFTER INSERT OR DELETE ON {{schema}}.appointment_service_sets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_multi_service_appointment_trigger();

DROP TRIGGER IF EXISTS appointment_service_segments_validate
  ON {{schema}}.appointment_service_segments;
CREATE CONSTRAINT TRIGGER appointment_service_segments_validate
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.appointment_service_segments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_multi_service_appointment_trigger();

DROP TRIGGER IF EXISTS appointments_validate_multi_service
  ON {{schema}}.appointments;
CREATE CONSTRAINT TRIGGER appointments_validate_multi_service
AFTER INSERT OR UPDATE OF barber_id, service_id, start_time, duration_minutes,
  buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
  service_price_cents_snapshot, series_id
ON {{schema}}.appointments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_multi_service_parent_trigger();
