-- Additive authorization foundation only. This migration deliberately creates
-- no users and does not change the legacy login/session paths.

CREATE TABLE IF NOT EXISTS {{schema}}.users (
  id serial PRIMARY KEY,
  display_name text NOT NULL,
  username text,
  username_key text GENERATED ALWAYS AS (lower(btrim(username))) STORED,
  email text NOT NULL,
  email_key text GENERATED ALWAYS AS (lower(btrim(email))) STORED NOT NULL,
  password_hash text,
  status text NOT NULL DEFAULT 'invited',
  auth_version integer NOT NULL DEFAULT 1,
  last_login_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT users_display_name_not_blank_check CHECK ((btrim(display_name) <> '') IS TRUE),
  CONSTRAINT users_email_not_blank_check CHECK ((btrim(email) <> '') IS TRUE),
  CONSTRAINT users_username_not_blank_check CHECK ((username IS NULL OR btrim(username) <> '') IS TRUE),
  CONSTRAINT users_status_check CHECK ((status IN ('invited', 'active', 'disabled')) IS TRUE),
  CONSTRAINT users_auth_version_check CHECK ((auth_version > 0) IS TRUE),
  CONSTRAINT users_password_state_check CHECK ((
    (status = 'active' AND password_hash IS NOT NULL AND btrim(password_hash) <> '')
    OR (status IN ('invited', 'disabled') AND (password_hash IS NULL OR btrim(password_hash) <> ''))
  ) IS TRUE),
  CONSTRAINT users_timestamps_check CHECK ((updated_at >= created_at) IS TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key_unique
  ON {{schema}}.users (email_key);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key_unique
  ON {{schema}}.users (username_key)
  WHERE username_key IS NOT NULL;

ALTER TABLE {{schema}}.barbers
  ADD COLUMN IF NOT EXISTS user_id integer;
ALTER TABLE {{schema}}.admins
  ADD COLUMN IF NOT EXISTS user_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.barbers'::regclass
      AND conname = 'barbers_user_id_fkey'
  ) THEN
    ALTER TABLE {{schema}}.barbers
      ADD CONSTRAINT barbers_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES {{schema}}.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.admins'::regclass
      AND conname = 'admins_user_id_fkey'
  ) THEN
    ALTER TABLE {{schema}}.admins
      ADD CONSTRAINT admins_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES {{schema}}.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS barbers_user_id_unique
  ON {{schema}}.barbers (user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admins_user_id_unique
  ON {{schema}}.admins (user_id)
  WHERE user_id IS NOT NULL;

-- Preset definitions and their capabilities remain code-owned. The database
-- stores only a known preset key and explicit capability additions.
CREATE TABLE IF NOT EXISTS {{schema}}.user_access_scopes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  location_id integer REFERENCES {{schema}}.locations(id) ON DELETE CASCADE,
  preset_key text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_access_scopes_preset_key_check
    CHECK ((preset_key IS NULL OR preset_key IN ('administrator', 'professional')) IS TRUE),
  CONSTRAINT user_access_scopes_administrator_global_check
    CHECK ((preset_key IS DISTINCT FROM 'administrator' OR location_id IS NULL) IS TRUE),
  CONSTRAINT user_access_scopes_timestamps_check
    CHECK ((updated_at >= created_at) IS TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_access_scopes_global_unique
  ON {{schema}}.user_access_scopes (user_id)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_access_scopes_location_unique
  ON {{schema}}.user_access_scopes (user_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.user_access_scope_capabilities (
  access_scope_id integer NOT NULL
    REFERENCES {{schema}}.user_access_scopes(id) ON DELETE CASCADE,
  capability_code text NOT NULL,
  CONSTRAINT user_access_scope_capabilities_pkey
    PRIMARY KEY (access_scope_id, capability_code),
  CONSTRAINT user_access_scope_capabilities_code_check CHECK ((capability_code IN (
    'agenda.view_own',
    'agenda.view_team',
    'appointments.create_manual',
    'appointments.block_time',
    'appointments.manage_own',
    'appointments.manage_team',
    'appointments.change_status_own',
    'appointments.change_status_team',
    'customers.view_own',
    'customers.view_team',
    'customers.notes_own',
    'customers.notes_team',
    'customers.block',
    'team.view',
    'team.manage_global',
    'team.assign_location',
    'catalog.view',
    'catalog.manage_global',
    'catalog.manage_location',
    'hours.manage_own',
    'hours.manage_team',
    'hours.manage_establishment',
    'extras.manage',
    'finance.view_own',
    'finance.view_team',
    'finance.manage_expenses',
    'reports.export_own',
    'reports.export_team',
    'locations.manage',
    'users.manage',
    'access.manage',
    'settings.manage',
    'audit.view',
    'system.diagnostics'
  )) IS TRUE)
);

-- Enforce P1's rule that installation-wide identity/configuration capabilities
-- cannot be granted through a location scope.
CREATE OR REPLACE FUNCTION {{schema}}.validate_location_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scope_location_id integer;
BEGIN
  SELECT location_id
  INTO scope_location_id
  FROM {{schema}}.user_access_scopes
  WHERE id = NEW.access_scope_id;

  IF FOUND
    AND scope_location_id IS NOT NULL
    AND NEW.capability_code IN (
      'team.manage_global',
      'catalog.manage_global',
      'locations.manage',
      'users.manage',
      'settings.manage',
      'system.diagnostics'
    )
  THEN
    RAISE EXCEPTION 'capability % cannot be granted at location scope', NEW.capability_code
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_access_scope_capabilities_location_check
  ON {{schema}}.user_access_scope_capabilities;
CREATE TRIGGER user_access_scope_capabilities_location_check
BEFORE INSERT OR UPDATE ON {{schema}}.user_access_scope_capabilities
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_location_capability_grant();

CREATE OR REPLACE FUNCTION {{schema}}.validate_access_scope_location_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM {{schema}}.user_access_scope_capabilities capability
    WHERE capability.access_scope_id = NEW.id
      AND capability.capability_code IN (
        'team.manage_global',
        'catalog.manage_global',
        'locations.manage',
        'users.manage',
        'settings.manage',
        'system.diagnostics'
      )
  ) THEN
    RAISE EXCEPTION 'global-only capabilities prevent moving scope % to a location', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_access_scopes_location_change_check
  ON {{schema}}.user_access_scopes;
CREATE TRIGGER user_access_scopes_location_change_check
BEFORE UPDATE OF location_id ON {{schema}}.user_access_scopes
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_access_scope_location_change();

CREATE TABLE IF NOT EXISTS {{schema}}.user_invites (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES {{schema}}.users(id) ON DELETE CASCADE,
  token_digest text NOT NULL,
  invited_by_user_id integer REFERENCES {{schema}}.users(id) ON DELETE SET NULL,
  expires_at timestamp NOT NULL,
  accepted_at timestamp,
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_invites_token_digest_not_blank_check
    CHECK ((btrim(token_digest) <> '') IS TRUE),
  CONSTRAINT user_invites_expiry_check
    CHECK ((expires_at > created_at) IS TRUE),
  CONSTRAINT user_invites_terminal_state_check
    CHECK ((accepted_at IS NULL OR revoked_at IS NULL) IS TRUE),
  CONSTRAINT user_invites_accepted_at_check
    CHECK ((accepted_at IS NULL OR accepted_at >= created_at) IS TRUE),
  CONSTRAINT user_invites_revoked_at_check
    CHECK ((revoked_at IS NULL OR revoked_at >= created_at) IS TRUE)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_invites_token_digest_unique
  ON {{schema}}.user_invites (token_digest);
CREATE INDEX IF NOT EXISTS user_invites_user_idx
  ON {{schema}}.user_invites (user_id, created_at);

ALTER TABLE {{schema}}.audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id integer,
  ADD COLUMN IF NOT EXISTS actor_professional_id integer,
  ADD COLUMN IF NOT EXISTS location_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.audit_logs'::regclass
      AND conname = 'audit_logs_actor_user_id_fkey'
  ) THEN
    ALTER TABLE {{schema}}.audit_logs
      ADD CONSTRAINT audit_logs_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES {{schema}}.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.audit_logs'::regclass
      AND conname = 'audit_logs_actor_professional_id_fkey'
  ) THEN
    ALTER TABLE {{schema}}.audit_logs
      ADD CONSTRAINT audit_logs_actor_professional_id_fkey
      FOREIGN KEY (actor_professional_id) REFERENCES {{schema}}.barbers(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '{{schema}}.audit_logs'::regclass
      AND conname = 'audit_logs_location_id_fkey'
  ) THEN
    ALTER TABLE {{schema}}.audit_logs
      ADD CONSTRAINT audit_logs_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_logs_actor_user_idx
  ON {{schema}}.audit_logs (actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_professional_idx
  ON {{schema}}.audit_logs (actor_professional_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_location_idx
  ON {{schema}}.audit_logs (location_id, created_at);
