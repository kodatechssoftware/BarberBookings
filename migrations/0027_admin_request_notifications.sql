CREATE TABLE IF NOT EXISTS {{schema}}.location_request_notification_settings (
  location_id integer PRIMARY KEY
    REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT false,
  reminder_enabled boolean NOT NULL DEFAULT false,
  reminder_delay_minutes integer NOT NULL DEFAULT 30,
  respect_opening_hours boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT location_request_notification_settings_delay_check
    CHECK (reminder_delay_minutes BETWEEN 5 AND 1440),
  CONSTRAINT location_request_notification_settings_timestamps_check
    CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS {{schema}}.location_request_notification_recipients (
  location_id integer NOT NULL
    REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  user_id integer NOT NULL
    REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  new_request_email boolean NOT NULL DEFAULT true,
  pending_reminder_email boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, user_id),
  CONSTRAINT location_request_notification_recipients_timestamps_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS location_request_notification_recipients_user_idx
  ON {{schema}}.location_request_notification_recipients (user_id, location_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS {{schema}}.admin_notifications (
  id serial PRIMARY KEY,
  location_id integer NOT NULL
    REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  appointment_request_id integer NOT NULL
    REFERENCES {{schema}}.appointment_requests(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  event_key text NOT NULL,
  available_at timestamp NOT NULL DEFAULT now(),
  email_delivery_enabled boolean NOT NULL DEFAULT false,
  recipients_prepared_at timestamp,
  cancelled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT admin_notifications_type_check
    CHECK (notification_type IN ('new_request', 'pending_reminder')),
  CONSTRAINT admin_notifications_event_key_check
    CHECK (btrim(event_key) <> '' AND char_length(event_key) <= 180)
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_event_key_unique
  ON {{schema}}.admin_notifications (event_key);
CREATE INDEX IF NOT EXISTS admin_notifications_location_available_idx
  ON {{schema}}.admin_notifications (location_id, available_at DESC, id DESC)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_notifications_email_pending_idx
  ON {{schema}}.admin_notifications (available_at, id)
  WHERE email_delivery_enabled = true
    AND recipients_prepared_at IS NULL
    AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_notifications_request_idx
  ON {{schema}}.admin_notifications (appointment_request_id, notification_type, id);

CREATE TABLE IF NOT EXISTS {{schema}}.admin_notification_user_states (
  notification_id integer NOT NULL
    REFERENCES {{schema}}.admin_notifications(id) ON DELETE CASCADE,
  user_id integer NOT NULL
    REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  read_at timestamp,
  email_status text NOT NULL DEFAULT 'not_needed',
  email_attempts integer NOT NULL DEFAULT 0,
  next_email_attempt_at timestamp,
  email_lease_started_at timestamp,
  email_provider_message_id text,
  email_error_code text,
  email_sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id),
  CONSTRAINT admin_notification_user_states_email_status_check
    CHECK (email_status IN ('not_needed', 'pending', 'sending', 'retry', 'sent', 'failed', 'skipped')),
  CONSTRAINT admin_notification_user_states_attempts_check
    CHECK (email_attempts BETWEEN 0 AND 20),
  CONSTRAINT admin_notification_user_states_timestamps_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS admin_notification_user_states_user_unread_idx
  ON {{schema}}.admin_notification_user_states (user_id, notification_id)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS admin_notification_user_states_email_due_idx
  ON {{schema}}.admin_notification_user_states (next_email_attempt_at, notification_id, user_id)
  WHERE email_status IN ('pending', 'retry', 'sending');
