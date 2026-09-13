ALTER TABLE {{schema}}.appointments
  ADD COLUMN IF NOT EXISTS reschedule_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamp;

CREATE TABLE IF NOT EXISTS {{schema}}.appointment_notification_events (
  id serial PRIMARY KEY,
  appointment_id integer REFERENCES {{schema}}.appointments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_revision integer NOT NULL,
  event_key text NOT NULL,
  appointment_start_time timestamp,
  previous_start_time timestamp,
  new_start_time timestamp,
  provider text,
  template_name text,
  whatsapp_status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  provider_status text,
  response_status integer,
  error_code text,
  processing_started_at timestamp,
  processing_completed_at timestamp,
  whatsapp_attempted_at timestamp,
  whatsapp_accepted_at timestamp,
  sent_at timestamp,
  delivered_at timestamp,
  read_at timestamp,
  failed_at timestamp,
  last_provider_timestamp timestamp,
  webhook_fallback_claimed_at timestamp,
  email_status text NOT NULL DEFAULT 'not_needed',
  email_provider_message_id text,
  email_error_code text,
  email_attempted_at timestamp,
  email_sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE {{schema}}.appointment_notification_events
  ADD COLUMN IF NOT EXISTS appointment_start_time timestamp,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS template_name text,
  ADD COLUMN IF NOT EXISTS whatsapp_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS response_status integer,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamp,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamp,
  ADD COLUMN IF NOT EXISTS whatsapp_attempted_at timestamp,
  ADD COLUMN IF NOT EXISTS whatsapp_accepted_at timestamp,
  ADD COLUMN IF NOT EXISTS sent_at timestamp,
  ADD COLUMN IF NOT EXISTS delivered_at timestamp,
  ADD COLUMN IF NOT EXISTS read_at timestamp,
  ADD COLUMN IF NOT EXISTS failed_at timestamp,
  ADD COLUMN IF NOT EXISTS last_provider_timestamp timestamp,
  ADD COLUMN IF NOT EXISTS webhook_fallback_claimed_at timestamp,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_needed',
  ADD COLUMN IF NOT EXISTS email_provider_message_id text,
  ADD COLUMN IF NOT EXISTS email_error_code text,
  ADD COLUMN IF NOT EXISTS email_attempted_at timestamp,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

UPDATE {{schema}}.appointment_notification_events
SET appointment_start_time = COALESCE(appointment_start_time, new_start_time, previous_start_time)
WHERE appointment_start_time IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointment_notification_events_event_key_idx
  ON {{schema}}.appointment_notification_events (event_key);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_notification_events_provider_message_id_idx
  ON {{schema}}.appointment_notification_events (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS appointment_notification_events_pending_idx
  ON {{schema}}.appointment_notification_events (id)
  WHERE processing_completed_at IS NULL;

UPDATE {{schema}}.appointments appointment
SET notification_revision = GREATEST(
  appointment.notification_revision,
  appointment.reschedule_revision,
  COALESCE((SELECT MAX(event.event_revision) FROM {{schema}}.appointment_notification_events event WHERE event.appointment_id = appointment.id), 0)
);

CREATE TABLE IF NOT EXISTS {{schema}}.meta_webhook_receipts (
  id serial PRIMARY KEY,
  receipt_key text NOT NULL,
  provider_message_id text NOT NULL,
  status text NOT NULL,
  provider_timestamp timestamp,
  error_code text,
  waba_id text NOT NULL,
  phone_number_id text NOT NULL,
  notification_event_id integer REFERENCES {{schema}}.appointment_notification_events(id) ON DELETE SET NULL,
  payload_summary text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meta_webhook_receipts_receipt_key_idx
  ON {{schema}}.meta_webhook_receipts (receipt_key);
CREATE INDEX IF NOT EXISTS meta_webhook_receipts_provider_message_id_idx
  ON {{schema}}.meta_webhook_receipts (provider_message_id, provider_timestamp, id);
