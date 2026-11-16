-- Beauty v2: private, sanitised certificate images for published team qualifications.
-- Storage objects live outside PostgreSQL; this table only stores controlled metadata.

ALTER TABLE {{schema}}.barber_qualifications
  ADD CONSTRAINT barber_qualifications_identity_unique
  UNIQUE (id, barber_id, location_id);

CREATE TABLE {{schema}}.barber_qualification_documents (
  id serial PRIMARY KEY,
  qualification_id integer NOT NULL,
  barber_id integer NOT NULL,
  location_id integer NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'beauty-team-certificates',
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  upload_state text NOT NULL DEFAULT 'uploading',
  is_current boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  publication_authorized_at timestamp,
  publication_authorized_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  uploaded_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  removed_at timestamp,
  removed_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT barber_qualification_documents_qualification_fkey
    FOREIGN KEY (qualification_id, barber_id, location_id)
    REFERENCES {{schema}}.barber_qualifications(id, barber_id, location_id)
    ON DELETE RESTRICT,
  CONSTRAINT barber_qualification_documents_bucket_check
    CHECK (storage_bucket = 'beauty-team-certificates'),
  CONSTRAINT barber_qualification_documents_path_check
    CHECK (
      storage_path = btrim(storage_path)
      AND length(storage_path) BETWEEN 20 AND 500
      AND storage_path !~ '(^|/)\.\.(/|$)'
      AND storage_path !~ '^/'
    ),
  CONSTRAINT barber_qualification_documents_mime_check
    CHECK (mime_type = 'image/webp'),
  CONSTRAINT barber_qualification_documents_size_check
    CHECK (byte_size BETWEEN 1 AND 3145728),
  CONSTRAINT barber_qualification_documents_sha256_check
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT barber_qualification_documents_state_check
    CHECK (upload_state IN ('uploading', 'ready', 'pending_delete', 'failed')),
  CONSTRAINT barber_qualification_documents_current_check
    CHECK (
      is_current = false
      OR (upload_state = 'ready' AND removed_at IS NULL)
    ),
  CONSTRAINT barber_qualification_documents_publication_check
    CHECK (
      is_published = false
      OR (
        is_current = true
        AND upload_state = 'ready'
        AND publication_authorized_at IS NOT NULL
        AND removed_at IS NULL
      )
    ),
  CONSTRAINT barber_qualification_documents_removal_check
    CHECK (
      removed_at IS NULL
      OR (is_current = false AND is_published = false AND upload_state = 'pending_delete')
    ),
  CONSTRAINT barber_qualification_documents_timestamps_check
    CHECK (updated_at >= created_at AND (removed_at IS NULL OR removed_at >= created_at)),
  CONSTRAINT barber_qualification_documents_storage_path_unique UNIQUE (storage_path)
);

CREATE UNIQUE INDEX barber_qualification_documents_current_idx
  ON {{schema}}.barber_qualification_documents(qualification_id)
  WHERE is_current = true;

CREATE INDEX barber_qualification_documents_profile_idx
  ON {{schema}}.barber_qualification_documents(location_id, barber_id, qualification_id, id);

CREATE INDEX barber_qualification_documents_cleanup_idx
  ON {{schema}}.barber_qualification_documents(upload_state, updated_at, id)
  WHERE upload_state IN ('uploading', 'failed', 'pending_delete');

CREATE INDEX barber_qualification_documents_public_idx
  ON {{schema}}.barber_qualification_documents(location_id, qualification_id, id)
  WHERE is_current = true AND is_published = true AND upload_state = 'ready';

-- This metadata is accessed only by the trusted application server. Supabase
-- projects can grant privileges to Data API roles through default ACLs, and
-- RLS does not protect TRUNCATE, REFERENCES or TRIGGER. Neutralise both direct
-- and PUBLIC grants on the newly-created objects without changing global
-- defaults. Keep this conditional so the migration also works in plain local
-- PostgreSQL installations that do not define Supabase roles.
REVOKE ALL PRIVILEGES ON TABLE {{schema}}.barber_qualification_documents FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SEQUENCE {{schema}}.barber_qualification_documents_id_seq FROM PUBLIC;

DO $revoke_data_api_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE {{schema}}.barber_qualification_documents FROM anon';
    EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE {{schema}}.barber_qualification_documents_id_seq FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE {{schema}}.barber_qualification_documents FROM authenticated';
    EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE {{schema}}.barber_qualification_documents_id_seq FROM authenticated';
  END IF;
END
$revoke_data_api_roles$;

ALTER TABLE {{schema}}.barber_qualification_documents ENABLE ROW LEVEL SECURITY;

DO $validate_certificate_metadata_security$
DECLARE
  checked_role text;
  checked_privilege text;
BEGIN
  IF NOT (
    SELECT class_record.relrowsecurity
    FROM pg_class class_record
    WHERE class_record.oid = '{{schema}}.barber_qualification_documents'::regclass
  ) THEN
    RAISE EXCEPTION 'Certificate metadata table must have row level security enabled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy policy_record
    WHERE policy_record.polrelid = '{{schema}}.barber_qualification_documents'::regclass
  ) THEN
    RAISE EXCEPTION 'Certificate metadata table must not define Data API policies.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class class_record
    CROSS JOIN LATERAL aclexplode(
      coalesce(class_record.relacl, acldefault('r', class_record.relowner))
    ) acl
    WHERE class_record.oid = '{{schema}}.barber_qualification_documents'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type IN (
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER', 'MAINTAIN'
      )
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains privileges on certificate metadata.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class class_record
    CROSS JOIN LATERAL aclexplode(
      coalesce(class_record.relacl, acldefault('S', class_record.relowner))
    ) acl
    WHERE class_record.oid = '{{schema}}.barber_qualification_documents_id_seq'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type IN ('USAGE', 'SELECT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains privileges on certificate metadata sequence.';
  END IF;

  FOREACH checked_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = checked_role) THEN
      FOREACH checked_privilege IN ARRAY (
        CASE
          WHEN current_setting('server_version_num')::integer >= 170000 THEN ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER', 'MAINTAIN'
          ]
          ELSE ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'REFERENCES', 'TRIGGER'
          ]
        END
      ) LOOP
        IF has_table_privilege(
          checked_role,
          '{{schema}}.barber_qualification_documents',
          checked_privilege
        ) THEN
          RAISE EXCEPTION '% retains effective % on certificate metadata.',
            checked_role, checked_privilege;
        END IF;
      END LOOP;

      FOREACH checked_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
        IF has_sequence_privilege(
          checked_role,
          '{{schema}}.barber_qualification_documents_id_seq',
          checked_privilege
        ) THEN
          RAISE EXCEPTION '% retains effective % on certificate metadata sequence.',
            checked_role, checked_privilege;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$validate_certificate_metadata_security$;
