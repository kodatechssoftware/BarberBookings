-- Compensation used to be a global effective-dated history per barber. Keep
-- that history, but make every rule explicit for one barber/location pair.
CREATE TABLE IF NOT EXISTS {{schema}}.barber_compensation_rules (
  id serial PRIMARY KEY,
  barber_id integer NOT NULL REFERENCES {{schema}}.barbers (id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT 'none',
  commission_percent integer,
  chair_rent_cents integer,
  chair_rent_period text,
  effective_from timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Historical appointments can outlive an inactive/missing catalogue
-- association. Materialize those pairs as inactive before adding the composite
-- FK so their financial history remains resolvable.
INSERT INTO {{schema}}.barber_locations (barber_id, location_id, is_active)
SELECT DISTINCT appointment.barber_id, appointment.location_id, false
FROM {{schema}}.appointments AS appointment
LEFT JOIN {{schema}}.barber_locations AS association
  ON association.barber_id = appointment.barber_id
 AND association.location_id = appointment.location_id
WHERE association.barber_id IS NULL
ON CONFLICT (barber_id, location_id) DO NOTHING;

-- A global rule without any known location cannot be assigned safely.
DO $migration$
DECLARE
  orphan_barber_id integer;
BEGIN
  SELECT rule.barber_id
  INTO orphan_barber_id
  FROM {{schema}}.barber_compensation_rules AS rule
  WHERE NOT EXISTS (
    SELECT 1
    FROM {{schema}}.barber_locations AS association
    WHERE association.barber_id = rule.barber_id
  )
  ORDER BY rule.barber_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot migrate compensation for barber_id=%: no location association exists.',
      orphan_barber_id
      USING ERRCODE = '23514';
  END IF;
END $migration$;

-- Copying a legacy chair rent to multiple shops could multiply a single
-- commercial agreement. Require an explicit business decision instead.
DO $migration$
DECLARE
  ambiguous record;
BEGIN
  SELECT
    rule.barber_id,
    array_agg(DISTINCT association.location_id ORDER BY association.location_id) AS location_ids
  INTO ambiguous
  FROM {{schema}}.barber_compensation_rules AS rule
  INNER JOIN {{schema}}.barber_locations AS association
    ON association.barber_id = rule.barber_id
  WHERE rule.model = 'chair_rent'
  GROUP BY rule.barber_id
  HAVING count(DISTINCT association.location_id) > 1
  ORDER BY rule.barber_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot duplicate legacy chair rent for barber_id=% across locations=%; configure each shop explicitly.',
      ambiguous.barber_id,
      ambiguous.location_ids
      USING ERRCODE = '23514';
  END IF;
END $migration$;

ALTER TABLE {{schema}}.barber_compensation_rules
  ADD COLUMN location_id integer;

-- Keep each legacy id on the first location. IDs were not persisted on
-- appointments before this migration, so copies for other locations can use
-- new sequence values without changing any historical reference.
UPDATE {{schema}}.barber_compensation_rules AS rule
SET location_id = mapping.location_id
FROM (
  SELECT barber_id, min(location_id) AS location_id
  FROM {{schema}}.barber_locations
  GROUP BY barber_id
) AS mapping
WHERE mapping.barber_id = rule.barber_id;

INSERT INTO {{schema}}.barber_compensation_rules (
  barber_id,
  location_id,
  model,
  commission_percent,
  chair_rent_cents,
  chair_rent_period,
  effective_from,
  created_at
)
SELECT
  rule.barber_id,
  association.location_id,
  rule.model,
  rule.commission_percent,
  rule.chair_rent_cents,
  rule.chair_rent_period,
  rule.effective_from,
  rule.created_at
FROM {{schema}}.barber_compensation_rules AS rule
INNER JOIN {{schema}}.barber_locations AS association
  ON association.barber_id = rule.barber_id
 AND association.location_id <> rule.location_id;

-- Refuse malformed legacy values instead of silently normalizing financial
-- agreements during a schema migration.
DO $migration$
DECLARE
  invalid_rule_id integer;
BEGIN
  SELECT id
  INTO invalid_rule_id
  FROM {{schema}}.barber_compensation_rules
  WHERE NOT (
    (model = 'none'
      AND commission_percent IS NULL
      AND chair_rent_cents IS NULL
      AND chair_rent_period IS NULL)
    OR (model = 'commission'
      AND commission_percent BETWEEN 0 AND 100
      AND chair_rent_cents IS NULL
      AND chair_rent_period IS NULL)
    OR (model = 'chair_rent'
      AND commission_percent IS NULL
      AND chair_rent_cents > 0
      AND chair_rent_period IN ('day', 'week', 'month'))
  )
  ORDER BY id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot migrate invalid barber_compensation_rules row id=%.',
      invalid_rule_id
      USING ERRCODE = '23514';
  END IF;
END $migration$;

DROP INDEX IF EXISTS {{schema}}.barber_compensation_rules_barber_effective_idx;

ALTER TABLE {{schema}}.barber_compensation_rules
  ALTER COLUMN location_id SET NOT NULL,
  ADD CONSTRAINT barber_compensation_rules_barber_location_fkey
    FOREIGN KEY (barber_id, location_id)
    REFERENCES {{schema}}.barber_locations (barber_id, location_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT barber_compensation_rules_model_check
    CHECK (model IN ('none', 'commission', 'chair_rent')),
  ADD CONSTRAINT barber_compensation_rules_values_check
    CHECK (
      (model = 'none'
        AND commission_percent IS NULL
        AND chair_rent_cents IS NULL
        AND chair_rent_period IS NULL)
      OR (model = 'commission'
        AND commission_percent BETWEEN 0 AND 100
        AND chair_rent_cents IS NULL
        AND chair_rent_period IS NULL)
      OR (model = 'chair_rent'
        AND commission_percent IS NULL
        AND chair_rent_cents > 0
        AND chair_rent_period IN ('day', 'week', 'month'))
    );

CREATE UNIQUE INDEX barber_compensation_rules_barber_location_effective_uidx
  ON {{schema}}.barber_compensation_rules
  (barber_id, location_id, effective_from);

CREATE UNIQUE INDEX barber_compensation_rules_snapshot_identity_uidx
  ON {{schema}}.barber_compensation_rules
  (id, barber_id, location_id);

CREATE INDEX barber_compensation_rules_barber_location_effective_idx
  ON {{schema}}.barber_compensation_rules
  (barber_id, location_id, effective_from DESC);

-- Completed appointments created after this migration freeze both the rule id
-- and its commercial values. Existing appointments deliberately remain NULL:
-- their pre-migration financial rule may be ambiguous and is resolved through
-- the legacy local history at read time.
ALTER TABLE {{schema}}.appointments
  ADD COLUMN compensation_rule_id_snapshot integer,
  ADD COLUMN compensation_model_snapshot text,
  ADD COLUMN commission_percent_snapshot integer,
  ADD COLUMN chair_rent_cents_snapshot integer,
  ADD COLUMN chair_rent_period_snapshot text,
  ADD CONSTRAINT appointments_compensation_rule_snapshot_fkey
    FOREIGN KEY (compensation_rule_id_snapshot, barber_id, location_id)
    REFERENCES {{schema}}.barber_compensation_rules (id, barber_id, location_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT appointments_compensation_snapshot_check
    CHECK (
      (compensation_model_snapshot IS NULL
        AND compensation_rule_id_snapshot IS NULL
        AND commission_percent_snapshot IS NULL
        AND chair_rent_cents_snapshot IS NULL
        AND chair_rent_period_snapshot IS NULL)
      OR (compensation_model_snapshot = 'none'
        AND commission_percent_snapshot IS NULL
        AND chair_rent_cents_snapshot IS NULL
        AND chair_rent_period_snapshot IS NULL)
      OR (compensation_model_snapshot = 'commission'
        AND compensation_rule_id_snapshot IS NOT NULL
        AND commission_percent_snapshot BETWEEN 0 AND 100
        AND chair_rent_cents_snapshot IS NULL
        AND chair_rent_period_snapshot IS NULL)
      OR (compensation_model_snapshot = 'chair_rent'
        AND compensation_rule_id_snapshot IS NOT NULL
        AND commission_percent_snapshot IS NULL
        AND chair_rent_cents_snapshot > 0
        AND chair_rent_period_snapshot IN ('day', 'week', 'month'))
    );
