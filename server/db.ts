import 'dotenv/config';
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";


const { Pool } = pg;

const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true";
const fallbackMemoryDatabaseUrl = "postgresql://memory:memory@127.0.0.1:1/memory";

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

if (!process.env.DATABASE_URL && !useMemoryStorage) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || fallbackMemoryDatabaseUrl,
  max: getPositiveInteger(process.env.DATABASE_POOL_MAX, 2),
  connectionTimeoutMillis: getPositiveInteger(
    process.env.DATABASE_CONNECTION_TIMEOUT_MS,
    10_000,
  ),
  idleTimeoutMillis: getPositiveInteger(
    process.env.DATABASE_IDLE_TIMEOUT_MS,
    30_000,
  ),
});

pool.on("error", (error) => {
  console.error("Unexpected idle PostgreSQL client error", error);
});

export const db = drizzle(pool, { schema });

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function ensureMultiLocationFoundation() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const locationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("locations")}`;
  const barbersTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barbers")}`;
  const servicesTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("services")}`;
  const barberLocationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barber_locations")}`;
  const serviceLocationsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("service_locations")}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(424242, 1101)");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${locationsTable} (
        id serial PRIMARY KEY,
        name text NOT NULL,
        slug text NOT NULL,
        address text NOT NULL DEFAULT '',
        map_url text,
        map_embed_url text,
        phone text,
        email text,
        timezone text NOT NULL DEFAULT 'Europe/Lisbon',
        is_active boolean NOT NULL DEFAULT true,
        is_default boolean NOT NULL DEFAULT false,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(`ALTER TABLE ${locationsTable} ADD COLUMN IF NOT EXISTS phone text`);
    await client.query(`ALTER TABLE ${locationsTable} ADD COLUMN IF NOT EXISTS email text`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS locations_slug_idx
      ON ${locationsTable} (slug)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS locations_single_default_idx
      ON ${locationsTable} (is_default)
      WHERE is_default = true
    `);

    const existingLocations = await client.query<{ id: number; is_default: boolean }>(`
      SELECT id, is_default
      FROM ${locationsTable}
      ORDER BY is_default DESC, sort_order ASC, id ASC
    `);

    let defaultLocationId: number;
    if (existingLocations.rows.length === 0) {
      const insertedLocation = await client.query<{ id: number }>(`
        INSERT INTO ${locationsTable} (
          name,
          slug,
          address,
          map_url,
          map_embed_url,
          timezone,
          is_default
        )
        VALUES ($1, 'principal', $2, $3, $4, $5, true)
        RETURNING id
      `, [
        process.env.SHOP_NAME?.trim() || "Barbearia",
        process.env.SHOP_ADDRESS?.trim() || "",
        process.env.SHOP_MAP_URL?.trim() || process.env.VITE_SHOP_MAP_URL?.trim() || null,
        process.env.SHOP_MAP_EMBED_URL?.trim() || process.env.VITE_SHOP_MAP_EMBED_URL?.trim() || null,
        process.env.SHOP_TIME_ZONE?.trim() || "Europe/Lisbon",
      ]);
      defaultLocationId = insertedLocation.rows[0].id;
    } else {
      const defaultLocation = existingLocations.rows.find((location) => location.is_default);
      defaultLocationId = defaultLocation?.id ?? existingLocations.rows[0].id;
      if (!defaultLocation) {
        await client.query(`
          UPDATE ${locationsTable}
          SET is_default = true, updated_at = now()
          WHERE id = $1
        `, [defaultLocationId]);
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${barberLocationsTable} (
        barber_id integer NOT NULL REFERENCES ${barbersTable}(id) ON DELETE CASCADE,
        location_id integer NOT NULL REFERENCES ${locationsTable}(id) ON DELETE RESTRICT,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (barber_id, location_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS barber_locations_location_idx
      ON ${barberLocationsTable} (location_id, barber_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${serviceLocationsTable} (
        service_id integer NOT NULL REFERENCES ${servicesTable}(id) ON DELETE CASCADE,
        location_id integer NOT NULL REFERENCES ${locationsTable}(id) ON DELETE RESTRICT,
        is_active boolean NOT NULL DEFAULT true,
        price_override integer,
        duration_override integer,
        created_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (service_id, location_id),
        CONSTRAINT service_locations_price_override_check
          CHECK (price_override IS NULL OR price_override >= 0),
        CONSTRAINT service_locations_duration_override_check
          CHECK (duration_override IS NULL OR duration_override > 0)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS service_locations_location_idx
      ON ${serviceLocationsTable} (location_id, service_id)
    `);

    for (const tableName of [
      "appointments",
      "shop_availability",
      "barber_availability",
      "business_expenses",
    ]) {
      const qualifiedTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
      const constraintName = `${tableName}_location_id_fkey`;
      const indexName = `${tableName}_location_id_idx`;

      await client.query(`ALTER TABLE ${qualifiedTable} ADD COLUMN IF NOT EXISTS location_id integer`);
      await client.query(`UPDATE ${qualifiedTable} SET location_id = $1 WHERE location_id IS NULL`, [defaultLocationId]);
      await client.query(`ALTER TABLE ${qualifiedTable} ALTER COLUMN location_id SET DEFAULT ${defaultLocationId}`);
      await client.query(`ALTER TABLE ${qualifiedTable} ALTER COLUMN location_id SET NOT NULL`);
      await client.query(`
        DO $$
        BEGIN
          ALTER TABLE ${qualifiedTable}
          ADD CONSTRAINT ${quoteIdentifier(constraintName)}
          FOREIGN KEY (location_id) REFERENCES ${locationsTable}(id) ON DELETE RESTRICT;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)}
        ON ${qualifiedTable} (location_id)
      `);
    }

    await client.query(`
      INSERT INTO ${barberLocationsTable} (barber_id, location_id)
      SELECT barber.id, $1 FROM ${barbersTable} barber
      WHERE NOT EXISTS (
        SELECT 1 FROM ${barberLocationsTable} assignment WHERE assignment.barber_id = barber.id
      )
      ON CONFLICT (barber_id, location_id) DO NOTHING
    `, [defaultLocationId]);
    await client.query(`
      INSERT INTO ${serviceLocationsTable} (service_id, location_id)
      SELECT service.id, $1 FROM ${servicesTable} service
      WHERE NOT EXISTS (
        SELECT 1 FROM ${serviceLocationsTable} assignment WHERE assignment.service_id = service.id
      )
      ON CONFLICT (service_id, location_id) DO NOTHING
    `, [defaultLocationId]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureAppointmentOverlapProtection() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const tableName = "appointments";
  const constraintName = "appointments_no_booked_overlap";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;

  await pool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");

  const existingConstraint = await pool.query(
    `
      SELECT 1
      FROM pg_constraint constraint_info
      JOIN pg_class table_info ON table_info.oid = constraint_info.conrelid
      JOIN pg_namespace namespace_info ON namespace_info.oid = table_info.relnamespace
      WHERE constraint_info.conname = $1
        AND namespace_info.nspname = $2
        AND table_info.relname = $3
      LIMIT 1
    `,
    [constraintName, schemaName, tableName],
  );

  if (existingConstraint.rowCount) return;

  await pool.query(`
    ALTER TABLE ${qualifiedTableName}
    ADD CONSTRAINT ${quoteIdentifier(constraintName)}
    EXCLUDE USING gist (
      barber_id WITH =,
      tsrange(
        start_time,
        start_time + make_interval(mins => duration_minutes),
        '[)'
      ) WITH &&
    )
    WHERE (status = 'booked')
  `);
}

export async function ensureServiceAgendaLabelColumn() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("services")}`;

  await pool.query(`
    ALTER TABLE ${qualifiedTableName}
    ADD COLUMN IF NOT EXISTS agenda_label text
  `);
}

export async function ensureAppointmentPaymentMethodColumn() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("appointments")}`;
  const constraintName = "appointments_payment_method_check";

  await pool.query(`
    ALTER TABLE ${qualifiedTableName}
    ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'pending'
  `);

  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE ${qualifiedTableName}
      ADD CONSTRAINT ${quoteIdentifier(constraintName)}
      CHECK (payment_method IN ('pending', 'cash', 'card', 'gift'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
}

export async function ensureBarberServicesTable() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barber_services")}`;
  const qualifiedBarbersTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barbers")}`;
  const qualifiedServicesTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("services")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTableName} (
      barber_id integer NOT NULL REFERENCES ${qualifiedBarbersTable}(id) ON DELETE CASCADE,
      service_id integer NOT NULL REFERENCES ${qualifiedServicesTable}(id) ON DELETE CASCADE,
      PRIMARY KEY (barber_id, service_id)
    )
  `);
}

const knownTextEncodingRepairs = [
  ["Corte cl?ssico e barba", "Corte clássico e barba"],
  ["Perfil de demonstra??o DEV", "Perfil de demonstração"],
  ["Perfil de demonstra\uFFFD\uFFFDo DEV", "Perfil de demonstração"],
  ["Perfil de demonstração DEV", "Perfil de demonstração"],
  ["Jo?o Mendes", "João Mendes"],
  ["Lu?s Freitas", "Luís Freitas"],
  ["Tom?s Almeida", "Tomás Almeida"],
  ["S?rgio Matos", "Sérgio Matos"],
  ["Gon?alo Reis", "Gonçalo Reis"],
  ["C?sar Monteiro", "César Monteiro"],
  ["F?bio Lopes", "Fábio Lopes"],
  ["Sim?o Pires", "Simão Pires"],
  ["Andr\uFFFD Silva (DEV)", "André Silva"],
  ["Gon\uFFFDalo Costa (DEV)", "Gonçalo Costa"],
  ["André Silva (DEV)", "André Silva"],
  ["Gonçalo Costa (DEV)", "Gonçalo Costa"],
] as const;

const encodingRepairTargets = [
  ["barbers", "name"],
  ["barbers", "specialty"],
  ["barbers", "bio"],
  ["appointments", "customer_name"],
  ["audit_logs", "actor_name"],
  ["audit_logs", "summary"],
  ["audit_logs", "metadata"],
] as const;

export async function repairKnownTextEncodingArtifacts() {
  if (useMemoryStorage) return 0;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const client = await pool.connect();
  let repairedRows = 0;

  try {
    await client.query("BEGIN");

    for (const [tableName, columnName] of encodingRepairTargets) {
      const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
      const quotedColumnName = quoteIdentifier(columnName);

      for (const [corruptedText, correctedText] of knownTextEncodingRepairs) {
        const result = await client.query(
          `UPDATE ${qualifiedTableName}
           SET ${quotedColumnName} = replace(${quotedColumnName}, $1, $2)
           WHERE position($1 in ${quotedColumnName}) > 0`,
          [corruptedText, correctedText],
        );
        repairedRows += result.rowCount || 0;
      }
    }

    await client.query("COMMIT");
    return repairedRows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureBarberCompensationRulesTable() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barber_compensation_rules")}`;
  const qualifiedBarbersTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("barbers")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTableName} (
      id serial PRIMARY KEY,
      barber_id integer NOT NULL REFERENCES ${qualifiedBarbersTable}(id) ON DELETE CASCADE,
      model text NOT NULL DEFAULT 'none',
      commission_percent integer,
      chair_rent_cents integer,
      chair_rent_period text,
      effective_from timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS barber_compensation_rules_barber_effective_idx
    ON ${qualifiedTableName} (barber_id, effective_from DESC)
  `);
}

export async function ensureBusinessExpensesTable() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("business_expenses")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTableName} (
      id serial PRIMARY KEY,
      category text NOT NULL,
      description text NOT NULL,
      amount_cents integer NOT NULL,
      expense_date timestamp NOT NULL,
      recurrence text NOT NULL DEFAULT 'once',
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS business_expenses_expense_date_idx
    ON ${qualifiedTableName} (expense_date DESC)
  `);
}

export async function ensureWhatsappMessagesTable() {
  if (useMemoryStorage) return;

  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const qualifiedTableName = `${quoteIdentifier(schemaName)}.${quoteIdentifier("whatsapp_messages")}`;
  const qualifiedAppointmentsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier("appointments")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTableName} (
      id serial PRIMARY KEY,
      appointment_id integer REFERENCES ${qualifiedAppointmentsTable}(id) ON DELETE SET NULL,
      message_type text NOT NULL,
      phone text NOT NULL,
      provider_message_id text,
      status text NOT NULL DEFAULT 'pending',
      provider_status text,
      response_status integer,
      response_body text,
      webhook_payload text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_provider_message_id_idx
    ON ${qualifiedTableName} (provider_message_id)
    WHERE provider_message_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS whatsapp_messages_status_idx
    ON ${qualifiedTableName} (status, updated_at DESC)
  `);
}
