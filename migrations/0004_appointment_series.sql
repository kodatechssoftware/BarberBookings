CREATE TABLE IF NOT EXISTS {{schema}}.appointment_series (
  id text PRIMARY KEY,
  location_id integer NOT NULL REFERENCES {{schema}}.locations(id),
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers(id),
  service_id integer NOT NULL REFERENCES {{schema}}.services(id),
  customer_name text NOT NULL,
  customer_email text,
  customer_phone text NOT NULL,
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  whatsapp_opt_in_at timestamp,
  interval_weeks integer NOT NULL,
  duration_months integer NOT NULL,
  occurrence_count integer NOT NULL,
  first_start_time timestamp NOT NULL,
  notification_revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_series_recurrence_values_check
    CHECK (interval_weeks > 0 AND duration_months > 0 AND occurrence_count > 1),
  CONSTRAINT appointment_series_notification_revision_check CHECK (notification_revision > 0)
);

ALTER TABLE {{schema}}.appointments
  ADD COLUMN IF NOT EXISTS series_id text,
  ADD COLUMN IF NOT EXISTS series_occurrence_index integer;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES {{schema}}.appointment_series(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_series_occurrence_idx
  ON {{schema}}.appointments (series_id, series_occurrence_index);

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointments ADD CONSTRAINT appointments_series_membership_check CHECK (
    (series_id IS NULL AND series_occurrence_index IS NULL)
    OR (series_id IS NOT NULL AND series_occurrence_index IS NOT NULL AND series_occurrence_index >= 0)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

ALTER TABLE {{schema}}.appointment_notification_events
  ADD COLUMN IF NOT EXISTS series_id text,
  ADD COLUMN IF NOT EXISTS payload_snapshot jsonb;

ALTER TABLE {{schema}}.appointment_notification_events ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE {{schema}}.appointment_notification_events ALTER COLUMN previous_start_time DROP NOT NULL;
ALTER TABLE {{schema}}.appointment_notification_events ALTER COLUMN new_start_time DROP NOT NULL;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointment_notification_events ADD CONSTRAINT appointment_notification_events_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES {{schema}}.appointment_series(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.appointment_notification_events ADD CONSTRAINT appointment_notification_events_subject_check
    CHECK (num_nonnulls(appointment_id, series_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

ALTER TABLE {{schema}}.appointment_notification_events ALTER COLUMN appointment_start_time SET NOT NULL;
CREATE INDEX IF NOT EXISTS appointment_notification_events_series_idx
  ON {{schema}}.appointment_notification_events (series_id, event_revision) WHERE series_id IS NOT NULL;
