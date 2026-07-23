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
  ["Perfil de demonstra??o DEV", "Perfil de demonstração DEV"],
  ["Perfil de demonstra\uFFFD\uFFFDo DEV", "Perfil de demonstração DEV"],
  ["Jo?o Mendes", "João Mendes"],
  ["Lu?s Freitas", "Luís Freitas"],
  ["Tom?s Almeida", "Tomás Almeida"],
  ["S?rgio Matos", "Sérgio Matos"],
  ["Gon?alo Reis", "Gonçalo Reis"],
  ["C?sar Monteiro", "César Monteiro"],
  ["F?bio Lopes", "Fábio Lopes"],
  ["Sim?o Pires", "Simão Pires"],
  ["Andr\uFFFD Silva (DEV)", "André Silva (DEV)"],
  ["Gon\uFFFDalo Costa (DEV)", "Gonçalo Costa (DEV)"],
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
