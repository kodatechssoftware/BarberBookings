ALTER TABLE {{schema}}.customer_notes
  ADD COLUMN IF NOT EXISTS email_key text;

UPDATE {{schema}}.customer_notes
SET email_key = lower(btrim(email))
WHERE email IS NOT NULL
  AND btrim(email) <> ''
  AND email_key IS DISTINCT FROM lower(btrim(email));

DO $migration$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM {{schema}}.customer_notes
    WHERE email_key IS NOT NULL
    GROUP BY location_id, email_key, customer_name_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Ambiguous legacy customer-note email identities require review before migration 0009.';
  END IF;
END $migration$;

ALTER TABLE {{schema}}.customer_notes
  ALTER COLUMN phone DROP NOT NULL;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.customer_notes
    ADD CONSTRAINT customer_notes_contact_required_check CHECK (
      (phone IS NOT NULL AND btrim(phone) <> '')
      OR (email_key IS NOT NULL AND btrim(email_key) <> '')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.customer_notes
    ADD CONSTRAINT customer_notes_phone_nonempty_check CHECK (
      phone IS NULL OR btrim(phone) <> ''
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DO $migration$ BEGIN
  ALTER TABLE {{schema}}.customer_notes
    ADD CONSTRAINT customer_notes_email_key_normalized_check CHECK (
      (
        (email IS NULL OR btrim(email) = '')
        AND email_key IS NULL
      ) OR (
        email IS NOT NULL
        AND btrim(email) <> ''
        AND email_key = lower(btrim(email))
        AND email_key <> ''
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $migration$;

DROP INDEX IF EXISTS {{schema}}.customer_notes_location_phone_name_idx;

CREATE UNIQUE INDEX IF NOT EXISTS customer_notes_location_phone_name_idx
  ON {{schema}}.customer_notes (location_id, phone, customer_name_key)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_notes_location_email_name_idx
  ON {{schema}}.customer_notes (location_id, email_key, customer_name_key)
  WHERE email_key IS NOT NULL;
