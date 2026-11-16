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
