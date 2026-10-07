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

ALTER TABLE {{schema}}.barber_services
  DROP CONSTRAINT barber_services_pkey;

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
