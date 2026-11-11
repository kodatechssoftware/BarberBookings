ALTER TABLE {{schema}}.appointment_request_proposals
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS email_delivery_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_email_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS email_lease_started_at timestamp,
  ADD COLUMN IF NOT EXISTS email_provider_message_id text,
  ADD COLUMN IF NOT EXISTS email_error_code text,
  ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamp;

ALTER TABLE {{schema}}.appointment_request_proposals
  DROP CONSTRAINT IF EXISTS appointment_request_proposals_email_status_check;
ALTER TABLE {{schema}}.appointment_request_proposals
  ADD CONSTRAINT appointment_request_proposals_email_status_check
  CHECK (email_status IN ('disabled', 'missing', 'pending', 'sending', 'retry', 'sent', 'failed'));

ALTER TABLE {{schema}}.appointment_request_proposals
  DROP CONSTRAINT IF EXISTS appointment_request_proposals_email_attempts_check;
ALTER TABLE {{schema}}.appointment_request_proposals
  ADD CONSTRAINT appointment_request_proposals_email_attempts_check
  CHECK (email_attempts BETWEEN 0 AND 20);

ALTER TABLE {{schema}}.appointment_request_proposals
  DROP CONSTRAINT IF EXISTS appointment_request_proposals_email_delivery_revision_check;
ALTER TABLE {{schema}}.appointment_request_proposals
  ADD CONSTRAINT appointment_request_proposals_email_delivery_revision_check
  CHECK (email_delivery_revision > 0);

CREATE INDEX IF NOT EXISTS appointment_request_proposals_email_due_idx
  ON {{schema}}.appointment_request_proposals (next_email_attempt_at, id)
  WHERE email_status IN ('pending', 'retry', 'sending');

ALTER TABLE {{schema}}.admin_notifications
  DROP CONSTRAINT IF EXISTS admin_notifications_type_check;
ALTER TABLE {{schema}}.admin_notifications
  ADD CONSTRAINT admin_notifications_type_check
  CHECK (notification_type IN (
    'new_request', 'pending_reminder',
    'proposal_accepted', 'proposal_rejected', 'proposal_unavailable'
  ));
