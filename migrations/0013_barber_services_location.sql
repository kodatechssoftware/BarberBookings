-- barber_services used to be global to a barber. Before replacing that model,
-- refuse to discard any explicit legacy relation that cannot be mapped to at
-- least one location shared by the barber and the service.
DO $migration$
DECLARE
  orphan_relation record;
BEGIN
  SELECT assignment.barber_id, assignment.service_id
  INTO orphan_relation
  FROM {{schema}}.barber_services AS assignment
  WHERE NOT EXISTS (
    SELECT 1
    FROM {{schema}}.barber_locations AS barber_location
    INNER JOIN {{schema}}.service_locations AS service_location
      ON service_location.location_id = barber_location.location_id
     AND service_location.service_id = assignment.service_id
    WHERE barber_location.barber_id = assignment.barber_id
  )
  ORDER BY assignment.barber_id, assignment.service_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot migrate barber_services relation (barber_id=%, service_id=%): no common location exists.',
      orphan_relation.barber_id,
      orphan_relation.service_id
      USING ERRCODE = '23514';
  END IF;
END $migration$;

CREATE TEMP TABLE barber_services_location_backfill_0013 (
  barber_id integer NOT NULL,
  service_id integer NOT NULL,
  location_id integer NOT NULL,
  PRIMARY KEY (barber_id, service_id, location_id)
) ON COMMIT DROP;

-- An explicit legacy relation applied everywhere the barber and service shared
-- a location. Include inactive parent associations so reactivation preserves
-- the configuration that existed before this migration.
INSERT INTO barber_services_location_backfill_0013 (barber_id, service_id, location_id)
SELECT assignment.barber_id, assignment.service_id, barber_location.location_id
FROM {{schema}}.barber_services AS assignment
INNER JOIN {{schema}}.barber_locations AS barber_location
  ON barber_location.barber_id = assignment.barber_id
INNER JOIN {{schema}}.service_locations AS service_location
  ON service_location.service_id = assignment.service_id
 AND service_location.location_id = barber_location.location_id
ON CONFLICT DO NOTHING;

-- Zero legacy rows meant "all services". Materialize that wildcard now; the
-- new model has explicit rows only and an empty set means no local services.
INSERT INTO barber_services_location_backfill_0013 (barber_id, service_id, location_id)
SELECT barber_location.barber_id, service_location.service_id, barber_location.location_id
FROM {{schema}}.barber_locations AS barber_location
INNER JOIN {{schema}}.service_locations AS service_location
  ON service_location.location_id = barber_location.location_id
WHERE NOT EXISTS (
  SELECT 1
  FROM {{schema}}.barber_services AS assignment
  WHERE assignment.barber_id = barber_location.barber_id
)
ON CONFLICT DO NOTHING;

ALTER TABLE {{schema}}.barber_services
  ADD COLUMN location_id integer;

-- Drizzle-generated legacy schemas use a descriptive primary-key name while
-- older SQL fixtures use PostgreSQL's default barber_services_pkey. Resolve
-- the constraint by its semantics instead of assuming either identifier.
DO $migration$
DECLARE
  primary_key_count integer;
  primary_key_name text;
  primary_key_columns text[];
BEGIN
  SELECT count(*)
  INTO primary_key_count
  FROM pg_constraint AS constraint_record
  WHERE constraint_record.conrelid = '{{schema}}.barber_services'::regclass
    AND constraint_record.contype = 'p';

  IF primary_key_count <> 1 THEN
    RAISE EXCEPTION
      'Cannot migrate barber_services: expected exactly one primary key on (barber_id, service_id), found %.',
      primary_key_count
      USING ERRCODE = '23514';
  END IF;

  SELECT
    constraint_record.conname,
    array_agg(attribute_record.attname::text ORDER BY key_column.ordinality)
  INTO primary_key_name, primary_key_columns
  FROM pg_constraint AS constraint_record
  CROSS JOIN LATERAL unnest(constraint_record.conkey)
    WITH ORDINALITY AS key_column(attnum, ordinality)
  INNER JOIN pg_attribute AS attribute_record
    ON attribute_record.attrelid = constraint_record.conrelid
   AND attribute_record.attnum = key_column.attnum
  WHERE constraint_record.conrelid = '{{schema}}.barber_services'::regclass
    AND constraint_record.contype = 'p'
  GROUP BY constraint_record.oid, constraint_record.conname;

  IF primary_key_columns IS DISTINCT FROM ARRAY['barber_id', 'service_id']::text[] THEN
    RAISE EXCEPTION
      'Cannot migrate barber_services: primary key "%" has columns %, expected {barber_id,service_id}.',
      primary_key_name,
      primary_key_columns
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format(
    'ALTER TABLE %s DROP CONSTRAINT %I',
    '{{schema}}.barber_services'::regclass,
    primary_key_name
  );
END $migration$;

DELETE FROM {{schema}}.barber_services;

INSERT INTO {{schema}}.barber_services (barber_id, service_id, location_id)
SELECT barber_id, service_id, location_id
FROM barber_services_location_backfill_0013
ORDER BY barber_id, service_id, location_id;

ALTER TABLE {{schema}}.barber_services
  ALTER COLUMN location_id SET NOT NULL,
  ADD CONSTRAINT barber_services_pkey
    PRIMARY KEY (barber_id, service_id, location_id),
  ADD CONSTRAINT barber_services_barber_location_fkey
    FOREIGN KEY (barber_id, location_id)
    REFERENCES {{schema}}.barber_locations (barber_id, location_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT barber_services_service_location_fkey
    FOREIGN KEY (service_id, location_id)
    REFERENCES {{schema}}.service_locations (service_id, location_id)
    ON DELETE CASCADE;

CREATE INDEX barber_services_location_barber_idx
  ON {{schema}}.barber_services (location_id, barber_id, service_id);

CREATE INDEX barber_services_location_service_idx
  ON {{schema}}.barber_services (location_id, service_id, barber_id);
