import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import {
  getMigrationLocationConfig,
  migrationChecksum,
  runSchemaMigrationsWithClient,
  withSchemaMigrationLock,
  type SchemaMigrationOptions,
} from "./migrations";

export const DATABASE_BASELINE_NAME = "0000_legacy_baseline.sql";
const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export type DatabaseBootstrapState =
  | "empty"
  | "empty-ledger"
  | "legacy-baseline"
  | "versioned";

export type DatabaseBootstrapOptions = SchemaMigrationOptions & {
  baselineFile?: string;
};

export type DatabaseBootstrapResult = {
  initialState: DatabaseBootstrapState;
  baselineInstalled: boolean;
  baselineRecorded: boolean;
  applied: string[];
  alreadyApplied: number;
};

export class DatabaseBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseBootstrapError";
  }
}

type ExpectedColumn = readonly [name: string, dataType: string, nullable: "YES" | "NO"];

const legacyBaselineColumns: Readonly<Record<string, readonly ExpectedColumn[]>> = {
  admins: [
    ["id", "integer", "NO"], ["username", "text", "NO"], ["email", "text", "YES"], ["password", "text", "NO"],
  ],
  appointments: [
    ["id", "integer", "NO"], ["barber_id", "integer", "NO"], ["service_id", "integer", "YES"],
    ["start_time", "timestamp without time zone", "NO"], ["customer_name", "text", "NO"],
    ["customer_email", "text", "YES"], ["customer_phone", "text", "NO"], ["duration_minutes", "integer", "NO"],
    ["status", "text", "NO"], ["cancel_token", "text", "NO"], ["cancelled_at", "timestamp without time zone", "YES"],
    ["payment_method", "text", "NO"], ["deposit_required", "boolean", "NO"], ["deposit_reason", "text", "YES"],
    ["created_at", "timestamp without time zone", "YES"],
  ],
  audit_logs: [
    ["id", "integer", "NO"], ["actor_type", "text", "NO"], ["actor_id", "integer", "YES"],
    ["actor_name", "text", "YES"], ["action", "text", "NO"], ["entity_type", "text", "NO"],
    ["entity_id", "integer", "YES"], ["summary", "text", "NO"], ["metadata", "text", "YES"],
    ["created_at", "timestamp without time zone", "NO"],
  ],
  barber_availability: [
    ["id", "integer", "NO"], ["barber_id", "integer", "NO"], ["day_of_week", "integer", "NO"],
    ["start_time", "text", "NO"], ["end_time", "text", "NO"], ["is_working", "boolean", "NO"],
  ],
  barber_invites: [
    ["id", "integer", "NO"], ["barber_id", "integer", "NO"], ["token", "text", "NO"],
    ["expires_at", "timestamp without time zone", "NO"], ["used_at", "timestamp without time zone", "YES"],
    ["created_at", "timestamp without time zone", "NO"],
  ],
  barber_services: [
    ["barber_id", "integer", "NO"], ["service_id", "integer", "NO"],
  ],
  barbers: [
    ["id", "integer", "NO"], ["name", "text", "NO"], ["specialty", "text", "NO"], ["bio", "text", "YES"],
    ["avatar", "text", "YES"], ["email", "text", "YES"], ["password", "text", "YES"],
    ["color", "text", "NO"], ["is_visible", "boolean", "YES"],
  ],
  blacklist: [
    ["id", "integer", "NO"], ["email", "text", "YES"], ["phone", "text", "NO"],
    ["reason", "text", "YES"], ["created_at", "timestamp without time zone", "NO"],
  ],
  business_expenses: [
    ["id", "integer", "NO"], ["category", "text", "NO"], ["description", "text", "NO"],
    ["amount_cents", "integer", "NO"], ["expense_date", "timestamp without time zone", "NO"],
    ["recurrence", "text", "NO"], ["notes", "text", "YES"],
    ["created_at", "timestamp without time zone", "NO"], ["updated_at", "timestamp without time zone", "NO"],
  ],
  customer_notes: [
    ["id", "integer", "NO"], ["phone", "text", "NO"], ["customer_name_key", "text", "NO"],
    ["email", "text", "YES"], ["notes", "text", "NO"],
    ["created_at", "timestamp without time zone", "NO"], ["updated_at", "timestamp without time zone", "NO"],
  ],
  services: [
    ["id", "integer", "NO"], ["name", "text", "NO"], ["description", "text", "YES"],
    ["agenda_label", "text", "YES"], ["price", "integer", "NO"], ["duration", "integer", "NO"],
    ["is_visible", "boolean", "YES"],
  ],
  shop_availability: [
    ["id", "integer", "NO"], ["day_of_week", "integer", "NO"], ["start_time", "text", "NO"],
    ["end_time", "text", "NO"], ["is_open", "boolean", "NO"],
  ],
  verification_codes: [
    ["id", "integer", "NO"], ["phone", "text", "NO"], ["code", "text", "NO"],
    ["expires_at", "timestamp without time zone", "NO"], ["used", "boolean", "NO"],
  ],
};

const legacyBaselinePrimaryKeys: Readonly<Record<string, readonly string[]>> = {
  admins: ["id"], appointments: ["id"], audit_logs: ["id"], barber_availability: ["id"],
  barber_invites: ["id"], barber_services: ["barber_id", "service_id"], barbers: ["id"],
  blacklist: ["id"], business_expenses: ["id"], customer_notes: ["id"], services: ["id"],
  shop_availability: ["id"], verification_codes: ["id"],
};

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new DatabaseBootstrapError(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function columnSignature(column: ExpectedColumn) {
  return column.join(":");
}

async function listOrdinaryTables(client: PoolClient, schemaName: string) {
  const result = await client.query<{ table_name: string }>(`
    SELECT class.relname AS table_name
    FROM pg_class AS class
    INNER JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = $1
      AND class.relkind IN ('r', 'p')
    ORDER BY class.relname
  `, [schemaName]);
  return result.rows.map((row) => row.table_name);
}

async function validateLegacyBaseline(client: PoolClient, schemaName: string, ordinaryTables: readonly string[]) {
  const expectedTables = Object.keys(legacyBaselineColumns).sort();
  const actualApplicationTables = ordinaryTables.filter((name) => name !== "schema_migrations").sort();
  if (!sameStrings(actualApplicationTables, expectedTables)) return false;

  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
  }>(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = ANY($2::text[])
    ORDER BY table_name, ordinal_position
  `, [schemaName, expectedTables]);
  const actualColumns = new Map<string, string[]>();
  for (const row of columns.rows) {
    const entries = actualColumns.get(row.table_name) || [];
    entries.push(`${row.column_name}:${row.data_type}:${row.is_nullable}`);
    actualColumns.set(row.table_name, entries);
  }
  for (const [tableName, expected] of Object.entries(legacyBaselineColumns)) {
    if (!sameStrings(actualColumns.get(tableName) || [], expected.map(columnSignature))) return false;
  }

  const primaryKeys = await client.query<{ table_name: string; columns: string[] }>(`
    SELECT
      class.relname AS table_name,
      array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS columns
    FROM pg_constraint AS constraint_record
    INNER JOIN pg_class AS class ON class.oid = constraint_record.conrelid
    INNER JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL unnest(constraint_record.conkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
    INNER JOIN pg_attribute AS attribute
      ON attribute.attrelid = class.oid AND attribute.attnum = key_column.attnum
    WHERE namespace.nspname = $1 AND constraint_record.contype = 'p'
      AND class.relname = ANY($2::text[])
    GROUP BY class.relname, constraint_record.oid
    ORDER BY class.relname
  `, [schemaName, expectedTables]);
  const actualPrimaryKeys = new Map(primaryKeys.rows.map((row) => [row.table_name, row.columns]));
  return Object.entries(legacyBaselinePrimaryKeys).every(([tableName, expected]) =>
    sameStrings(actualPrimaryKeys.get(tableName) || [], expected));
}

async function readMigrationSources(directory: string) {
  const files = (await readdir(directory)).filter((file) => migrationNamePattern.test(file)).sort();
  if (files.length === 0) throw new DatabaseBootstrapError(`No schema migrations found in ${directory}.`);
  return Promise.all(files.map(async (file) => {
    const sql = await readFile(path.join(directory, file), "utf8");
    return { file, checksum: migrationChecksum(sql) };
  }));
}

async function ensureKnownLedger(
  client: PoolClient,
  schemaName: string,
  baselineChecksum: string,
  migrations: Awaited<ReturnType<typeof readMigrationSources>>,
) {
  const schema = quoteIdentifier(schemaName);
  const result = await client.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM ${schema}.schema_migrations ORDER BY name`,
  );
  const allowed = new Map(migrations.map((migration) => [migration.file, migration.checksum]));
  allowed.set(DATABASE_BASELINE_NAME, baselineChecksum);

  for (const row of result.rows) {
    const expected = allowed.get(row.name);
    if (!expected) throw new DatabaseBootstrapError(`Unknown schema ledger entry: ${row.name}.`);
    if (expected !== row.checksum) throw new DatabaseBootstrapError(`Applied schema artifact ${row.name} has been modified.`);
  }

  const appliedMigrationNames = result.rows
    .map((row) => row.name)
    .filter((name) => name !== DATABASE_BASELINE_NAME);
  const expectedPrefix = migrations.slice(0, appliedMigrationNames.length).map((migration) => migration.file);
  if (!sameStrings(appliedMigrationNames, expectedPrefix)) {
    throw new DatabaseBootstrapError("Schema migration ledger is not a contiguous prefix of the versioned migrations.");
  }
  return result.rows;
}

async function createMigrationLedger(client: PoolClient, schemaName: string) {
  const schema = quoteIdentifier(schemaName);
  await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamp NOT NULL DEFAULT now()
  )`);
}

async function recordBaseline(client: PoolClient, schemaName: string, checksum: string) {
  const schema = quoteIdentifier(schemaName);
  await client.query(
    `INSERT INTO ${schema}.schema_migrations (name, checksum) VALUES ($1, $2)`,
    [DATABASE_BASELINE_NAME, checksum],
  );
}

export async function runDatabaseBootstrap(
  pool: Pool,
  options: DatabaseBootstrapOptions = {},
): Promise<DatabaseBootstrapResult> {
  const schemaName = options.schemaName?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const baselineFile = options.baselineFile || path.resolve(process.cwd(), "database/baseline", DATABASE_BASELINE_NAME);
  const migrationsDirectory = options.migrationsDirectory || path.resolve(process.cwd(), "migrations");
  const baselineSql = await readFile(baselineFile, "utf8");
  const baselineChecksum = migrationChecksum(baselineSql);
  const migrations = await readMigrationSources(migrationsDirectory);

  // Validate required migration configuration before the first possible DDL.
  getMigrationLocationConfig(options.environment || process.env);

  return withSchemaMigrationLock(pool, async (client) => {
    const namespace = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schemaName]);
    if (!namespace.rowCount) throw new DatabaseBootstrapError(`Database schema ${schemaName} does not exist.`);

    const ordinaryTables = await listOrdinaryTables(client, schemaName);
    const hasLedger = ordinaryTables.includes("schema_migrations");
    let ledgerRows: Array<{ name: string; checksum: string }> = [];
    if (hasLedger) {
      ledgerRows = await ensureKnownLedger(client, schemaName, baselineChecksum, migrations);
    }

    let initialState: DatabaseBootstrapState;
    if (ordinaryTables.length === 0) {
      initialState = "empty";
    } else if (ordinaryTables.length === 1 && hasLedger && ledgerRows.length === 0) {
      // Safe recovery from an earlier db:migrate attempt that created only its
      // empty ledger before 0001 failed on the absent legacy foundation.
      initialState = "empty-ledger";
    } else if (await validateLegacyBaseline(client, schemaName, ordinaryTables)) {
      initialState = ledgerRows.some((row) => row.name !== DATABASE_BASELINE_NAME)
        ? "versioned"
        : "legacy-baseline";
    } else if (hasLedger && ledgerRows.some((row) => row.name !== DATABASE_BASELINE_NAME)) {
      const requiredTables = Object.keys(legacyBaselineColumns);
      const missing = requiredTables.filter((tableName) => !ordinaryTables.includes(tableName));
      if (missing.length > 0) {
        throw new DatabaseBootstrapError(`Versioned schema is missing legacy foundation tables: ${missing.join(", ")}.`);
      }
      initialState = "versioned";
    } else {
      throw new DatabaseBootstrapError(
        `Refusing to bootstrap unknown or mixed schema ${schemaName}; no changes were made.`,
      );
    }

    let baselineInstalled = false;
    let baselineRecorded = ledgerRows.some((row) => row.name === DATABASE_BASELINE_NAME);
    if (initialState === "empty" || initialState === "empty-ledger") {
      await client.query("BEGIN");
      try {
        await client.query(baselineSql.replaceAll("{{schema}}", schema));
        await createMigrationLedger(client, schemaName);
        await recordBaseline(client, schemaName, baselineChecksum);
        await client.query("COMMIT");
        baselineInstalled = true;
        baselineRecorded = true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } else if (initialState === "legacy-baseline" && !baselineRecorded) {
      await client.query("BEGIN");
      try {
        await createMigrationLedger(client, schemaName);
        await recordBaseline(client, schemaName, baselineChecksum);
        await client.query("COMMIT");
        baselineRecorded = true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const migrationResult = await runSchemaMigrationsWithClient(client, {
      ...options,
      schemaName,
      migrationsDirectory,
    });
    return {
      initialState,
      baselineInstalled,
      baselineRecorded,
      ...migrationResult,
    };
  });
}
