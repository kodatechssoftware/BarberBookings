-- Preserve the legacy effective visibility before service_locations becomes
-- the source of truth for per-location availability.
UPDATE {{schema}}.service_locations AS assignment
SET is_active = false
FROM {{schema}}.services AS service
WHERE assignment.service_id = service.id
  AND service.is_visible = false;

-- Visibility is now controlled by each service_locations row. Keep the legacy
-- column enabled so it cannot unexpectedly hide an otherwise active location.
UPDATE {{schema}}.services AS service
SET is_visible = true
WHERE service.is_visible = false
  AND EXISTS (
    SELECT 1
    FROM {{schema}}.service_locations AS assignment
    WHERE assignment.service_id = service.id
  );
