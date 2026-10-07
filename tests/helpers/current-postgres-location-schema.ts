import type pg from "pg";

/**
 * Runtime PostgreSQL tests start from drizzle-kit push plus legacy migrations.
 * The push fixture deliberately filters the location-parent tables, so the
 * cross-table constraints and the versioned compensation table are installed
 * here. The migrations themselves are validated separately by test:migrations.
 */
export async function installCurrentLocationFinanceSchema(pool: pg.Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS barber_compensation_rules (
      id serial PRIMARY KEY,
      barber_id integer NOT NULL REFERENCES barbers (id) ON DELETE CASCADE,
      location_id integer NOT NULL,
      model text NOT NULL DEFAULT 'none',
      commission_percent integer,
      chair_rent_cents integer,
      chair_rent_period text,
      effective_from timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT barber_compensation_rules_barber_location_fkey
        FOREIGN KEY (barber_id, location_id)
        REFERENCES barber_locations (barber_id, location_id)
        ON DELETE RESTRICT,
      CONSTRAINT barber_compensation_rules_model_check
        CHECK (model IN ('none', 'commission', 'chair_rent')),
      CONSTRAINT barber_compensation_rules_values_check CHECK (
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
    );
    CREATE UNIQUE INDEX IF NOT EXISTS barber_compensation_rules_barber_location_effective_uidx
      ON barber_compensation_rules (barber_id, location_id, effective_from);
    CREATE UNIQUE INDEX IF NOT EXISTS barber_compensation_rules_snapshot_identity_uidx
      ON barber_compensation_rules (id, barber_id, location_id);
    CREATE INDEX IF NOT EXISTS barber_compensation_rules_barber_location_effective_idx
      ON barber_compensation_rules (barber_id, location_id, effective_from DESC);
  `);
  await pool.query(`
    DO $fixture$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'appointments'::regclass
          AND conname = 'appointments_compensation_rule_snapshot_fkey'
      ) THEN
        ALTER TABLE appointments
          ADD CONSTRAINT appointments_compensation_rule_snapshot_fkey
          FOREIGN KEY (compensation_rule_id_snapshot, barber_id, location_id)
          REFERENCES barber_compensation_rules (id, barber_id, location_id)
          ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'barber_services'::regclass
          AND conname = 'barber_services_barber_location_fkey'
      ) THEN
        ALTER TABLE barber_services
          ADD CONSTRAINT barber_services_barber_location_fkey
          FOREIGN KEY (barber_id, location_id)
          REFERENCES barber_locations (barber_id, location_id)
          ON DELETE CASCADE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'barber_services'::regclass
          AND conname = 'barber_services_service_location_fkey'
      ) THEN
        ALTER TABLE barber_services
          ADD CONSTRAINT barber_services_service_location_fkey
          FOREIGN KEY (service_id, location_id)
          REFERENCES service_locations (service_id, location_id)
          ON DELETE CASCADE;
      END IF;
    END
    $fixture$;
  `);
}
