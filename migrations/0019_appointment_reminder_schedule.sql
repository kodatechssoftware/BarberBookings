ALTER TABLE {{schema}}.appointment_notification_events
  ADD COLUMN IF NOT EXISTS available_at timestamp;

UPDATE {{schema}}.appointment_notification_events
SET available_at = COALESCE(created_at, now())
WHERE available_at IS NULL;

ALTER TABLE {{schema}}.appointment_notification_events
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS appointment_notification_events_due_pending_idx
  ON {{schema}}.appointment_notification_events (available_at, id)
  WHERE processing_completed_at IS NULL;
