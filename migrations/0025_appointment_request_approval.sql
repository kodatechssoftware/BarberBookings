CREATE TABLE IF NOT EXISTS {{schema}}.appointment_requests (
  id serial PRIMARY KEY,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  revision integer NOT NULL DEFAULT 1,
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text NOT NULL,
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  requested_start_time timestamp NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  appointment_id integer REFERENCES {{schema}}.appointments(id) ON DELETE RESTRICT,
  refusal_reason text,
  decided_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_requests_status_check
    CHECK (status IN ('pending', 'proposed', 'approved', 'refused')),
  CONSTRAINT appointment_requests_revision_check CHECK (revision > 0),
  CONSTRAINT appointment_requests_customer_name_check
    CHECK (btrim(customer_name) <> '' AND char_length(customer_name) <= 80),
  CONSTRAINT appointment_requests_customer_email_check
    CHECK (customer_email IS NULL OR char_length(customer_email) <= 120),
  CONSTRAINT appointment_requests_customer_phone_check
    CHECK (btrim(customer_phone) <> '' AND char_length(customer_phone) <= 32),
  CONSTRAINT appointment_requests_idempotency_key_check
    CHECK (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 100),
  CONSTRAINT appointment_requests_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT appointment_requests_refusal_reason_check
    CHECK (refusal_reason IS NULL OR char_length(refusal_reason) <= 500),
  CONSTRAINT appointment_requests_state_check CHECK (
    (status IN ('pending', 'proposed') AND appointment_id IS NULL AND decided_at IS NULL AND refusal_reason IS NULL)
    OR (status = 'approved' AND appointment_id IS NOT NULL AND decided_at IS NOT NULL AND refusal_reason IS NULL)
    OR (status = 'refused' AND appointment_id IS NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT appointment_requests_timestamps_check CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_requests_location_idempotency_unique
  ON {{schema}}.appointment_requests (location_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_requests_appointment_unique
  ON {{schema}}.appointment_requests (appointment_id)
  WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointment_requests_location_status_idx
  ON {{schema}}.appointment_requests (location_id, status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_request_segments (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES {{schema}}.appointment_requests(id) ON DELETE CASCADE,
  position integer NOT NULL,
  service_id integer NOT NULL REFERENCES {{schema}}.services(id) ON DELETE RESTRICT,
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id) ON DELETE RESTRICT,
  start_time timestamp NOT NULL,
  duration_minutes integer NOT NULL,
  buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
  buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0,
  service_name_snapshot text NOT NULL,
  service_price_cents_snapshot integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_request_segments_position_check CHECK (position >= 0 AND position < 12),
  CONSTRAINT appointment_request_segments_duration_check CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  CONSTRAINT appointment_request_segments_buffers_check CHECK (
    buffer_before_minutes_snapshot BETWEEN 0 AND 720
    AND buffer_after_minutes_snapshot BETWEEN 0 AND 720
  ),
  CONSTRAINT appointment_request_segments_name_check
    CHECK (btrim(service_name_snapshot) <> '' AND char_length(service_name_snapshot) <= 100),
  CONSTRAINT appointment_request_segments_price_check
    CHECK (service_price_cents_snapshot BETWEEN 0 AND 1000000),
  CONSTRAINT appointment_request_segments_request_position_unique UNIQUE (request_id, position)
);

CREATE INDEX IF NOT EXISTS appointment_request_segments_request_idx
  ON {{schema}}.appointment_request_segments (request_id, position);
CREATE INDEX IF NOT EXISTS appointment_request_segments_barber_time_idx
  ON {{schema}}.appointment_request_segments (barber_id, start_time);

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_request_proposals (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES {{schema}}.appointment_requests(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  proposed_start_time timestamp NOT NULL,
  status text NOT NULL DEFAULT 'active',
  response_token_hash text NOT NULL,
  command_key text NOT NULL,
  proposal_fingerprint text NOT NULL,
  expires_at timestamp NOT NULL,
  responded_at timestamp,
  created_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  created_by_professional_id integer REFERENCES {{schema}}.barbers(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_request_proposals_revision_check CHECK (revision > 0),
  CONSTRAINT appointment_request_proposals_status_check
    CHECK (status IN ('active', 'accepted', 'rejected', 'replaced', 'expired', 'unavailable')),
  CONSTRAINT appointment_request_proposals_token_hash_check
    CHECK (response_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT appointment_request_proposals_command_key_check
    CHECK (btrim(command_key) <> '' AND char_length(command_key) <= 100),
  CONSTRAINT appointment_request_proposals_fingerprint_check
    CHECK (proposal_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT appointment_request_proposals_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT appointment_request_proposals_response_check CHECK (
    (status IN ('active', 'replaced', 'unavailable') AND responded_at IS NULL)
    OR (status IN ('accepted', 'rejected', 'expired') AND responded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_request_proposals_request_revision_unique
  ON {{schema}}.appointment_request_proposals (request_id, revision);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_request_proposals_request_command_unique
  ON {{schema}}.appointment_request_proposals (request_id, command_key);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_request_proposals_token_unique
  ON {{schema}}.appointment_request_proposals (response_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_request_proposals_one_active
  ON {{schema}}.appointment_request_proposals (request_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_request_events (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES {{schema}}.appointment_requests(id) ON DELETE CASCADE,
  proposal_id integer REFERENCES {{schema}}.appointment_request_proposals(id) ON DELETE SET NULL,
  appointment_id integer REFERENCES {{schema}}.appointments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  actor_professional_id integer REFERENCES {{schema}}.barbers(id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_request_events_type_check CHECK (event_type IN (
    'request_created', 'request_approved', 'request_refused', 'approval_conflict',
    'proposal_created', 'proposal_replaced', 'proposal_accepted',
    'proposal_rejected', 'proposal_expired', 'proposal_unavailable'
  )),
  CONSTRAINT appointment_request_events_actor_check
    CHECK (actor_type IN ('client', 'admin', 'professional', 'system')),
  CONSTRAINT appointment_request_events_reason_check
    CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS appointment_request_events_request_idx
  ON {{schema}}.appointment_request_events (request_id, created_at, id);

ALTER TABLE {{schema}}.appointment_notification_events
  ADD COLUMN IF NOT EXISTS appointment_request_id integer;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointment_notification_events
    ADD CONSTRAINT appointment_notification_events_request_id_fkey
    FOREIGN KEY (appointment_request_id)
    REFERENCES {{schema}}.appointment_requests(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

ALTER TABLE {{schema}}.appointment_notification_events
  DROP CONSTRAINT IF EXISTS appointment_notification_events_subject_check;
ALTER TABLE {{schema}}.appointment_notification_events
  ADD CONSTRAINT appointment_notification_events_subject_check
  CHECK (num_nonnulls(appointment_id, series_id, appointment_request_id) = 1);

CREATE INDEX IF NOT EXISTS appointment_notification_events_request_idx
  ON {{schema}}.appointment_notification_events (appointment_request_id, event_revision, id)
  WHERE appointment_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION {{schema}}.validate_appointment_request_segments(target_request_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  request_row {{schema}}.appointment_requests%ROWTYPE;
  segment_count integer;
  invalid_sequence boolean;
BEGIN
  SELECT * INTO request_row FROM {{schema}}.appointment_requests WHERE id = target_request_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), bool_or(position <> expected_position OR (position > 0 AND start_time <> previous_end))
  INTO segment_count, invalid_sequence
  FROM (
    SELECT
      position,
      start_time,
      lag(start_time + make_interval(mins => duration_minutes)) OVER (ORDER BY position) AS previous_end,
      row_number() OVER (ORDER BY position) - 1 AS expected_position
    FROM {{schema}}.appointment_request_segments
    WHERE request_id = target_request_id
  ) ordered_segments;

  IF segment_count < 1 OR segment_count > 12 OR coalesce(invalid_sequence, true) THEN
    RAISE EXCEPTION 'Appointment request % must contain a contiguous sequence of 1 to 12 services', target_request_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM {{schema}}.appointment_request_segments
    WHERE request_id = target_request_id AND position = 0 AND start_time = request_row.requested_start_time
  ) THEN
    RAISE EXCEPTION 'Appointment request % start time does not match its first service', target_request_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION {{schema}}.validate_appointment_request_segments_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.request_id <> NEW.request_id THEN
    PERFORM {{schema}}.validate_appointment_request_segments(OLD.request_id);
  END IF;
  PERFORM {{schema}}.validate_appointment_request_segments(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS appointment_request_segments_validate
  ON {{schema}}.appointment_request_segments;
CREATE CONSTRAINT TRIGGER appointment_request_segments_validate
AFTER INSERT OR UPDATE OR DELETE ON {{schema}}.appointment_request_segments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_appointment_request_segments_trigger();

CREATE OR REPLACE FUNCTION {{schema}}.validate_appointment_request_parent_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM {{schema}}.validate_appointment_request_segments(coalesce(NEW.id, OLD.id));
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS appointment_requests_validate_segments
  ON {{schema}}.appointment_requests;
CREATE CONSTRAINT TRIGGER appointment_requests_validate_segments
AFTER INSERT OR UPDATE OF requested_start_time ON {{schema}}.appointment_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_appointment_request_parent_trigger();
