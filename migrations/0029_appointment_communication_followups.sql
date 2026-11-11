CREATE TABLE IF NOT EXISTS {{schema}}.appointment_communication_followups (
  appointment_notification_event_id integer PRIMARY KEY
    REFERENCES {{schema}}.appointment_notification_events(id) ON DELETE CASCADE,
  contacted_by_user_id integer NOT NULL
    REFERENCES {{schema}}.users(id) ON DELETE RESTRICT,
  contact_method text NOT NULL,
  contacted_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT appointment_communication_followups_method_check
    CHECK (contact_method IN ('sms', 'phone', 'other')),
  CONSTRAINT appointment_communication_followups_timestamps_check
    CHECK (contacted_at <= created_at)
);

CREATE INDEX IF NOT EXISTS appointment_communication_followups_user_contacted_idx
  ON {{schema}}.appointment_communication_followups (contacted_by_user_id, contacted_at);

CREATE INDEX IF NOT EXISTS appointment_notification_events_appointment_failed_idx
  ON {{schema}}.appointment_notification_events (
    appointment_id, event_revision, appointment_start_time, id
  )
  WHERE whatsapp_status = 'failed' AND appointment_id IS NOT NULL;
