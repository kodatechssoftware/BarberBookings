CREATE TABLE IF NOT EXISTS {{schema}}.whatsapp_messages (
  id serial PRIMARY KEY,
  appointment_id integer REFERENCES {{schema}}.appointments(id) ON DELETE SET NULL,
  message_type text NOT NULL,
  phone text NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'pending',
  provider_status text,
  response_status integer,
  response_body text,
  webhook_payload text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_provider_message_id_idx
  ON {{schema}}.whatsapp_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_status_idx
  ON {{schema}}.whatsapp_messages (status, updated_at DESC);
