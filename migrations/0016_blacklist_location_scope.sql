-- Make customer blocking location-scoped while preserving the former global
-- semantics of every legacy row. Existing rows are copied to every location;
-- the original row is retained at the explicit default location.

ALTER TABLE {{schema}}.blacklist
  ADD COLUMN IF NOT EXISTS location_id integer;

DO $migration$
DECLARE
  default_location_count integer;
BEGIN
  SELECT count(*)
  INTO default_location_count
  FROM {{schema}}.locations
  WHERE is_default IS TRUE;

  IF default_location_count <> 1 THEN
    RAISE EXCEPTION 'blacklist location migration requires exactly one default location; found %',
      default_location_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM {{schema}}.locations) THEN
    RAISE EXCEPTION 'blacklist location migration requires at least one location';
  END IF;
END $migration$;

-- Copy each still-global legacy row to every non-default location first. The
-- WHERE clause makes this deterministic and safe on a repeated migration run.
INSERT INTO {{schema}}.blacklist (location_id, email, phone, reason, created_at)
SELECT location.id, entry.email, entry.phone, entry.reason, entry.created_at
FROM {{schema}}.blacklist AS entry
CROSS JOIN {{schema}}.locations AS location
WHERE entry.location_id IS NULL
  AND location.is_default IS NOT TRUE;

UPDATE {{schema}}.blacklist AS entry
SET location_id = location.id
FROM {{schema}}.locations AS location
WHERE entry.location_id IS NULL
  AND location.is_default IS TRUE;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM {{schema}}.blacklist WHERE location_id IS NULL
  ) THEN
    RAISE EXCEPTION 'blacklist location migration left rows without a location';
  END IF;
END $migration$;

ALTER TABLE {{schema}}.blacklist
  ALTER COLUMN location_id SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '{{schema}}.blacklist'::regclass
      AND conname = 'blacklist_location_id_fkey'
      AND contype = 'f'
  ) THEN
    ALTER TABLE {{schema}}.blacklist
      ADD CONSTRAINT blacklist_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES {{schema}}.locations(id) ON DELETE RESTRICT;
  END IF;
END $migration$;

CREATE INDEX IF NOT EXISTS blacklist_location_phone_idx
  ON {{schema}}.blacklist (location_id, phone);
CREATE INDEX IF NOT EXISTS blacklist_location_created_at_idx
  ON {{schema}}.blacklist (location_id, created_at);

-- Extend the code-owned capability registry constraint without rewriting the
-- already-applied 0015 migration.
ALTER TABLE {{schema}}.user_access_scope_capabilities
  DROP CONSTRAINT user_access_scope_capabilities_code_check;
ALTER TABLE {{schema}}.user_access_scope_capabilities
  ADD CONSTRAINT user_access_scope_capabilities_code_check CHECK ((capability_code IN (
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
    'finance.manage_compensation',
    'reports.export_own',
    'reports.export_team',
    'locations.manage',
    'users.manage',
    'access.manage',
    'settings.manage',
    'audit.view',
    'system.diagnostics'
  )) IS TRUE);
