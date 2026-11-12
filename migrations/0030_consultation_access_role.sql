-- Beauty v2: location-scoped, strictly read-only consultation access preset.
-- Preset capabilities remain code-owned; this migration only enforces storage invariants.

ALTER TABLE {{schema}}.user_access_scopes
  DROP CONSTRAINT user_access_scopes_preset_key_check;

ALTER TABLE {{schema}}.user_access_scopes
  ADD CONSTRAINT user_access_scopes_preset_key_check
  CHECK ((preset_key IS NULL OR preset_key IN ('administrator', 'professional', 'consultation')) IS TRUE);

ALTER TABLE {{schema}}.user_access_scopes
  ADD CONSTRAINT user_access_scopes_consultation_location_check
  CHECK ((preset_key IS DISTINCT FROM 'consultation' OR location_id IS NOT NULL) IS TRUE);

CREATE OR REPLACE FUNCTION {{schema}}.validate_consultation_access_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize changes to all scopes belonging to the same identity.
  PERFORM 1 FROM {{schema}}.users WHERE id = NEW.user_id FOR UPDATE;

  IF NEW.preset_key = 'consultation' THEN
    IF NEW.location_id IS NULL THEN
      RAISE EXCEPTION 'consultation preset requires a location scope'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM {{schema}}.barbers professional WHERE professional.user_id = NEW.user_id
    ) OR EXISTS (
      SELECT 1 FROM {{schema}}.admins administrator WHERE administrator.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'consultation preset cannot be linked to an administrator or professional identity'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM {{schema}}.user_access_scope_capabilities capability
      WHERE capability.access_scope_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'consultation preset does not allow explicit capabilities'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM {{schema}}.user_access_scopes scope
      WHERE scope.user_id = NEW.user_id
        AND scope.id IS DISTINCT FROM NEW.id
        AND scope.preset_key IS DISTINCT FROM 'consultation'
    ) THEN
      RAISE EXCEPTION 'consultation preset cannot be combined with other access scopes'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM {{schema}}.user_access_scopes scope
    WHERE scope.user_id = NEW.user_id
      AND scope.id IS DISTINCT FROM NEW.id
      AND scope.preset_key = 'consultation'
  ) THEN
    RAISE EXCEPTION 'consultation preset cannot be combined with other access scopes'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_access_scopes_consultation_check
  ON {{schema}}.user_access_scopes;
CREATE TRIGGER user_access_scopes_consultation_check
BEFORE INSERT OR UPDATE OF user_id, location_id, preset_key
ON {{schema}}.user_access_scopes
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_consultation_access_scope();

CREATE OR REPLACE FUNCTION {{schema}}.validate_consultation_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM {{schema}}.user_access_scopes scope
    WHERE scope.id = NEW.access_scope_id
      AND scope.preset_key = 'consultation'
  ) THEN
    RAISE EXCEPTION 'consultation preset does not allow explicit capabilities'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_access_scope_capabilities_consultation_check
  ON {{schema}}.user_access_scope_capabilities;
CREATE TRIGGER user_access_scope_capabilities_consultation_check
BEFORE INSERT OR UPDATE OF access_scope_id, capability_code
ON {{schema}}.user_access_scope_capabilities
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_consultation_capability_grant();

CREATE OR REPLACE FUNCTION {{schema}}.validate_consultation_identity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    PERFORM 1 FROM {{schema}}.users WHERE id = NEW.user_id FOR UPDATE;
    IF EXISTS (
      SELECT 1
      FROM {{schema}}.user_access_scopes scope
      WHERE scope.user_id = NEW.user_id
        AND scope.preset_key = 'consultation'
    ) THEN
      RAISE EXCEPTION 'consultation user cannot be linked to an administrator or professional identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS barbers_consultation_identity_check ON {{schema}}.barbers;
CREATE TRIGGER barbers_consultation_identity_check
BEFORE INSERT OR UPDATE OF user_id ON {{schema}}.barbers
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_consultation_identity_link();

DROP TRIGGER IF EXISTS admins_consultation_identity_check ON {{schema}}.admins;
CREATE TRIGGER admins_consultation_identity_check
BEFORE INSERT OR UPDATE OF user_id ON {{schema}}.admins
FOR EACH ROW EXECUTE FUNCTION {{schema}}.validate_consultation_identity_link();

-- Validate pre-existing data explicitly before accepting the new invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM {{schema}}.user_access_scopes consultation_scope
    WHERE consultation_scope.preset_key = 'consultation'
      AND (
        consultation_scope.location_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM {{schema}}.user_access_scope_capabilities capability
          WHERE capability.access_scope_id = consultation_scope.id
        )
        OR EXISTS (
          SELECT 1
          FROM {{schema}}.user_access_scopes other_scope
          WHERE other_scope.user_id = consultation_scope.user_id
            AND other_scope.id <> consultation_scope.id
            AND other_scope.preset_key IS DISTINCT FROM 'consultation'
        )
        OR EXISTS (
          SELECT 1 FROM {{schema}}.barbers professional
          WHERE professional.user_id = consultation_scope.user_id
        )
        OR EXISTS (
          SELECT 1 FROM {{schema}}.admins administrator
          WHERE administrator.user_id = consultation_scope.user_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'existing access data violates consultation invariants'
      USING ERRCODE = '23514';
  END IF;
END $$;
