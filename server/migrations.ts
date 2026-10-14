import { createHash } from "crypto";
import { readFile, readdir } from "fs/promises";
import path from "path";
import type { Pool, PoolClient } from "pg";

const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const migrationLockNamespace = 424242;
const migrationLockKey = 1201;

export function migrationChecksum(sql: string) {
  return createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export type MigrationLocationConfig = {
  name: string;
  address: string;
  timezone: string;
  mapUrl: string;
  mapEmbedUrl: string;
};

function optionalHttpUrl(name: string, value: string) {
  if (!value) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL.`); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name} must use HTTP or HTTPS.`);
}

export function getMigrationLocationConfig(
  environment: Record<string, string | undefined> = process.env,
): MigrationLocationConfig {
  const requireExplicit = environment.NODE_ENV?.trim().toLowerCase() === "production"
    && environment.APP_ENV?.trim().toLowerCase() === "production";
  const name = environment.MIGRATION_DEFAULT_LOCATION_NAME?.trim()
    || (!requireExplicit ? environment.SHOP_NAME?.trim() : "") || "";
  const address = environment.MIGRATION_DEFAULT_LOCATION_ADDRESS?.trim()
    || (!requireExplicit ? environment.SHOP_ADDRESS?.trim() : "") || "";
  const timezone = environment.MIGRATION_DEFAULT_LOCATION_TIME_ZONE?.trim()
    || (!requireExplicit ? environment.SHOP_TIME_ZONE?.trim() : "") || "Europe/Lisbon";
  const mapUrl = environment.MIGRATION_DEFAULT_LOCATION_MAP_URL?.trim()
    || (!requireExplicit ? (environment.SHOP_MAP_URL?.trim() || environment.VITE_SHOP_MAP_URL?.trim()) : "") || "";
  const mapEmbedUrl = environment.MIGRATION_DEFAULT_LOCATION_MAP_EMBED_URL?.trim()
    || (!requireExplicit ? (environment.SHOP_MAP_EMBED_URL?.trim() || environment.VITE_SHOP_MAP_EMBED_URL?.trim()) : "") || "";

  if (!name || !address) {
    throw new Error("The default location name and address must be explicitly validated before running migrations.");
  }
  try { new Intl.DateTimeFormat("pt-PT", { timeZone: timezone }).format(new Date()); }
  catch { throw new Error("MIGRATION_DEFAULT_LOCATION_TIME_ZONE is invalid."); }
  optionalHttpUrl("MIGRATION_DEFAULT_LOCATION_MAP_URL", mapUrl);
  optionalHttpUrl("MIGRATION_DEFAULT_LOCATION_MAP_EMBED_URL", mapEmbedUrl);
  return { name, address, timezone, mapUrl, mapEmbedUrl };
}

async function setMigrationContext(client: PoolClient, config: MigrationLocationConfig) {
  const settings: Array<[string, string]> = [
    ["barberbookings.default_location_name", config.name],
    ["barberbookings.default_location_address", config.address],
    ["barberbookings.default_location_timezone", config.timezone],
    ["barberbookings.default_location_map_url", config.mapUrl],
    ["barberbookings.default_location_map_embed_url", config.mapEmbedUrl],
  ];
  for (const [name, value] of settings) await client.query("SELECT set_config($1, $2, true)", [name, value]);
}

export type SchemaMigrationOptions = {
  migrationsDirectory?: string;
  schemaName?: string;
  environment?: Record<string, string | undefined>;
};

export async function withSchemaMigrationLock<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [migrationLockNamespace, migrationLockKey]);
    return await callback(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [migrationLockNamespace, migrationLockKey]).catch(() => undefined);
    client.release();
  }
}

export async function runSchemaMigrationsWithClient(
  client: PoolClient,
  options: SchemaMigrationOptions = {},
) {
  const schemaName = options.schemaName?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const directory = options.migrationsDirectory || path.resolve(process.cwd(), "migrations");
  const files = (await readdir(directory)).filter((file) => migrationNamePattern.test(file)).sort();
  if (files.length === 0) throw new Error(`No schema migrations found in ${directory}.`);
  const locationConfig = getMigrationLocationConfig(options.environment || process.env);

  const migrations = await Promise.all(files.map(async (file) => {
    const rawSql = await readFile(path.join(directory, file), "utf8");
    return { file, rawSql, checksum: migrationChecksum(rawSql) };
  }));

  await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamp NOT NULL DEFAULT now()
  )`);
  const applied = await client.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM ${schema}.schema_migrations`);
  const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));

  // Validate every recorded migration before applying any missing file. This
  // prevents a later checksum mismatch from being discovered only after an
  // earlier gap has already changed the database.
  for (const migration of migrations) {
    const previousChecksum = appliedByName.get(migration.file);
    if (previousChecksum && previousChecksum !== migration.checksum) {
      throw new Error(`Applied migration ${migration.file} has been modified.`);
    }
  }

  const executed: string[] = [];
  for (const migration of migrations) {
    if (appliedByName.has(migration.file)) continue;
    const sql = migration.rawSql.replaceAll("{{schema}}", schema);
    await client.query("BEGIN");
    try {
      await setMigrationContext(client, locationConfig);
      await client.query(sql);
      await client.query(`INSERT INTO ${schema}.schema_migrations (name, checksum) VALUES ($1, $2)`, [
        migration.file,
        migration.checksum,
      ]);
      await client.query("COMMIT");
      executed.push(migration.file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  return { applied: executed, alreadyApplied: migrations.length - executed.length };
}

export async function runSchemaMigrations(
  pool: Pool,
  options: SchemaMigrationOptions = {},
) {
  return withSchemaMigrationLock(pool, (client) => runSchemaMigrationsWithClient(client, options));
}
