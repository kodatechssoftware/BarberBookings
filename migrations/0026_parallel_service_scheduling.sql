ALTER TABLE {{schema}}.business_feature_settings
  DROP CONSTRAINT IF EXISTS business_feature_settings_name_check;
ALTER TABLE {{schema}}.business_feature_settings
  ADD CONSTRAINT business_feature_settings_name_check CHECK (
    feature_name IN (
      'appointmentRequests',
      'teamProfiles',
      'googleReviews',
      'notificationDeliveryStatus',
      'consultationRole',
      'multiServiceAppointments',
      'parallelServiceScheduling'
    )
  );

CREATE TABLE IF NOT EXISTS {{schema}}.parallel_service_compatibilities (
  location_id integer NOT NULL
    REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  first_service_id integer NOT NULL
    REFERENCES {{schema}}.services(id) ON DELETE CASCADE,
  second_service_id integer NOT NULL
    REFERENCES {{schema}}.services(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT parallel_service_compatibilities_order_check
    CHECK (first_service_id < second_service_id),
  CONSTRAINT parallel_service_compatibilities_timestamps_check
    CHECK (updated_at >= created_at),
  CONSTRAINT parallel_service_compatibilities_first_location_fkey
    FOREIGN KEY (first_service_id, location_id)
    REFERENCES {{schema}}.service_locations(service_id, location_id) ON DELETE CASCADE,
  CONSTRAINT parallel_service_compatibilities_second_location_fkey
    FOREIGN KEY (second_service_id, location_id)
    REFERENCES {{schema}}.service_locations(service_id, location_id) ON DELETE CASCADE,
  CONSTRAINT parallel_service_compatibilities_pkey
    PRIMARY KEY (location_id, first_service_id, second_service_id)
);

CREATE INDEX IF NOT EXISTS parallel_service_compatibilities_location_idx
  ON {{schema}}.parallel_service_compatibilities (location_id, first_service_id, second_service_id);

ALTER TABLE {{schema}}.appointment_service_segments
  ADD COLUMN IF NOT EXISTS execution_stage integer;
ALTER TABLE {{schema}}.appointment_request_segments
  ADD COLUMN IF NOT EXISTS execution_stage integer;

ALTER TABLE {{schema}}.appointment_service_segments
  DROP CONSTRAINT IF EXISTS appointment_service_segments_execution_stage_check;
ALTER TABLE {{schema}}.appointment_service_segments
  ADD CONSTRAINT appointment_service_segments_execution_stage_check
  CHECK (execution_stage IS NULL OR execution_stage BETWEEN 0 AND 11);

ALTER TABLE {{schema}}.appointment_request_segments
  DROP CONSTRAINT IF EXISTS appointment_request_segments_execution_stage_check;
ALTER TABLE {{schema}}.appointment_request_segments
  ADD CONSTRAINT appointment_request_segments_execution_stage_check
  CHECK (execution_stage IS NULL OR execution_stage BETWEEN 0 AND 11);

CREATE INDEX IF NOT EXISTS appointment_service_segments_stage_idx
  ON {{schema}}.appointment_service_segments (appointment_id, execution_stage, position);
CREATE INDEX IF NOT EXISTS appointment_request_segments_stage_idx
  ON {{schema}}.appointment_request_segments (request_id, execution_stage, position);

-- Backfill only after all table/index DDL. The segment validators are deferred;
-- updating before ALTER/CREATE INDEX would leave pending trigger events and make
-- PostgreSQL reject the remaining DDL in a populated 0025 -> 0026 upgrade.
UPDATE {{schema}}.appointment_service_segments
SET execution_stage = position
WHERE execution_stage IS NULL;
UPDATE {{schema}}.appointment_request_segments
SET execution_stage = position
WHERE execution_stage IS NULL;

CREATE OR REPLACE FUNCTION {{schema}}.validate_multi_service_appointment(target_appointment_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_row {{schema}}.appointments%ROWTYPE;
  has_service_set boolean;
  segment_count integer;
  first_segment {{schema}}.appointment_service_segments%ROWTYPE;
  ending_segment {{schema}}.appointment_service_segments%ROWTYPE;
  total_price bigint;
  real_duration integer;
  invalid_positions boolean;
  invalid_stages boolean;
BEGIN
  SELECT * INTO appointment_row FROM {{schema}}.appointments WHERE id = target_appointment_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1 FROM {{schema}}.appointment_service_sets WHERE appointment_id = target_appointment_id
  ) INTO has_service_set;
  SELECT count(*) INTO segment_count
  FROM {{schema}}.appointment_service_segments WHERE appointment_id = target_appointment_id;

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
    SELECT 1 FROM {{schema}}.appointment_availability_windows WHERE appointment_id = target_appointment_id
  ) THEN
    RAISE EXCEPTION 'Multi-service appointment % cannot contain availability windows', target_appointment_id
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO first_segment
  FROM {{schema}}.appointment_service_segments
  WHERE appointment_id = target_appointment_id ORDER BY position LIMIT 1;
  SELECT * INTO ending_segment
  FROM {{schema}}.appointment_service_segments
  WHERE appointment_id = target_appointment_id
  ORDER BY start_time + make_interval(mins => duration_minutes) DESC, position DESC LIMIT 1;

  WITH normalized AS (
    SELECT *, coalesce(execution_stage, position) AS stage,
      row_number() OVER (ORDER BY position) - 1 AS expected_position
    FROM {{schema}}.appointment_service_segments
    WHERE appointment_id = target_appointment_id
  ), stage_summary AS (
    SELECT stage, min(start_time) AS stage_start,
      max(start_time + make_interval(mins => duration_minutes)) AS stage_end,
      count(DISTINCT start_time) AS start_count,
      count(*) AS segment_count,
      count(DISTINCT barber_id) AS professional_count
    FROM normalized GROUP BY stage
  ), ordered_stages AS (
    SELECT *, row_number() OVER (ORDER BY stage) - 1 AS expected_stage,
      lag(stage_end) OVER (ORDER BY stage) AS previous_end
    FROM stage_summary
  )
  SELECT
    (SELECT sum(service_price_cents_snapshot) FROM normalized),
    (SELECT extract(epoch FROM (max(stage_end) - min(stage_start)))::integer / 60 FROM stage_summary),
    (SELECT bool_or(position <> expected_position) FROM normalized),
    (SELECT bool_or(
      ordered_stages.stage <> ordered_stages.expected_stage
      OR ordered_stages.start_count <> 1
      OR ordered_stages.professional_count <> ordered_stages.segment_count
      OR (ordered_stages.stage > 0 AND ordered_stages.stage_start <> ordered_stages.previous_end)
    ) FROM ordered_stages)
  INTO total_price, real_duration, invalid_positions, invalid_stages;

  IF coalesce(invalid_positions, true)
    OR coalesce(invalid_stages, true)
    OR first_segment.position <> 0
    OR coalesce(first_segment.execution_stage, first_segment.position) <> 0
    OR first_segment.start_time <> appointment_row.start_time
    OR first_segment.service_id <> appointment_row.service_id
    OR first_segment.barber_id <> appointment_row.barber_id
    OR real_duration <> appointment_row.duration_minutes
    OR total_price <> appointment_row.service_price_cents_snapshot
    OR first_segment.buffer_before_minutes_snapshot <> appointment_row.buffer_before_minutes_snapshot
    OR ending_segment.buffer_after_minutes_snapshot <> appointment_row.buffer_after_minutes_snapshot THEN
    RAISE EXCEPTION 'Multi-service appointment % summary or execution stages are inconsistent', target_appointment_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.validate_appointment_request_segments(target_request_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  request_row {{schema}}.appointment_requests%ROWTYPE;
  segment_count integer;
  invalid_positions boolean;
  invalid_stages boolean;
BEGIN
  SELECT * INTO request_row FROM {{schema}}.appointment_requests WHERE id = target_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  WITH normalized AS (
    SELECT *, coalesce(execution_stage, position) AS stage,
      row_number() OVER (ORDER BY position) - 1 AS expected_position
    FROM {{schema}}.appointment_request_segments WHERE request_id = target_request_id
  ), stage_summary AS (
    SELECT stage, min(start_time) AS stage_start,
      max(start_time + make_interval(mins => duration_minutes)) AS stage_end,
      count(DISTINCT start_time) AS start_count,
      count(*) AS segment_count,
      count(DISTINCT barber_id) AS professional_count
    FROM normalized GROUP BY stage
  ), ordered_stages AS (
    SELECT *, row_number() OVER (ORDER BY stage) - 1 AS expected_stage,
      lag(stage_end) OVER (ORDER BY stage) AS previous_end
    FROM stage_summary
  )
  SELECT
    (SELECT count(*) FROM normalized),
    (SELECT bool_or(position <> expected_position) FROM normalized),
    (SELECT bool_or(
      ordered_stages.stage <> ordered_stages.expected_stage
      OR ordered_stages.start_count <> 1
      OR ordered_stages.professional_count <> ordered_stages.segment_count
      OR (ordered_stages.stage > 0 AND ordered_stages.stage_start <> ordered_stages.previous_end)
    ) FROM ordered_stages)
  INTO segment_count, invalid_positions, invalid_stages;

  IF segment_count < 1 OR segment_count > 12
    OR coalesce(invalid_positions, true)
    OR coalesce(invalid_stages, true) THEN
    RAISE EXCEPTION 'Appointment request % must contain valid contiguous execution stages', target_request_id
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM {{schema}}.appointment_request_segments
    WHERE request_id = target_request_id
      AND position = 0
      AND coalesce(execution_stage, position) = 0
      AND start_time = request_row.requested_start_time
  ) THEN
    RAISE EXCEPTION 'Appointment request % start time does not match its first execution stage', target_request_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;
