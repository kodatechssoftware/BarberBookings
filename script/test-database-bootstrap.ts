import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  bootstrapCanonicalAdministrator,
  getCanonicalBootstrapStatus,
} from "../server/auth-bootstrap";
import {
  DATABASE_BASELINE_NAME,
  DatabaseBootstrapError,
  runDatabaseBootstrap,
} from "../server/database-bootstrap";
import { runInitialSeedPolicy } from "../server/initial-seed-policy";
import { migrationChecksum, runSchemaMigrations } from "../server/migrations";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe test identifier: ${identifier}`);
  return `"${identifier}"`;
}

function table(schema: string, name: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

async function copyMigrationsThrough(source: string, target: string, lastFile: string) {
  const files = (await readdir(source)).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort();
  for (const file of files) {
    await copyFile(path.join(source, file), path.join(target, file));
    if (file === lastFile) return;
  }
  throw new Error(`Migration ${lastFile} not found.`);
}

async function installBaseline(pool: pg.Pool, schema: string, baselineSql: string, createEmptyLedger = false) {
  await pool.query(baselineSql.replaceAll("{{schema}}", quoteIdentifier(schema)));
  if (createEmptyLedger) {
    await pool.query(`CREATE TABLE ${table(schema, "schema_migrations")} (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT now()
    )`);
  }
}

async function count(pool: pg.Pool, schema: string, name: string) {
  return Number((await pool.query(`SELECT count(*) AS count FROM ${table(schema, name)}`)).rows[0].count);
}

const sourceMigrations = path.resolve(process.cwd(), "migrations");
const baselineFile = path.resolve(process.cwd(), "database/baseline", DATABASE_BASELINE_NAME);
const baselineSql = await readFile(baselineFile, "utf8");
assert.doesNotMatch(baselineSql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i, "baseline must contain DDL only");

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-db-bootstrap-pg-"));
const through0007 = await mkdtemp(path.join(tmpdir(), "barberbookings-db-bootstrap-0007-"));
const through0016 = await mkdtemp(path.join(tmpdir(), "barberbookings-db-bootstrap-0016-"));
const modifiedMigrations = await mkdtemp(path.join(tmpdir(), "barberbookings-db-bootstrap-modified-"));
const modifiedBaselineDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-db-bootstrap-baseline-"));
await copyMigrationsThrough(sourceMigrations, through0007, "0007_appointment_service_snapshots.sql");
await copyMigrationsThrough(sourceMigrations, through0016, "0016_blacklist_location_scope.sql");
await copyMigrationsThrough(sourceMigrations, modifiedMigrations, "0017_service_buffers.sql");
const modified0017 = path.join(modifiedMigrations, "0017_service_buffers.sql");
await writeFile(modified0017, `${await readFile(modified0017, "utf8")}\n-- forbidden checksum change\n`, "utf8");
const modifiedBaselineFile = path.join(modifiedBaselineDirectory, DATABASE_BASELINE_NAME);
await writeFile(modifiedBaselineFile, `${baselineSql}\n-- forbidden checksum change\n`, "utf8");

const port = await availablePort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "database-bootstrap-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let pool: pg.Pool | undefined;
const environment = {
  NODE_ENV: "test",
  APP_ENV: "development",
  MIGRATION_DEFAULT_LOCATION_NAME: "Beauty Salon Test",
  MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
  MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
};

try {
  await postgres.initialise();
  await postgres.start();
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:database-bootstrap-test@127.0.0.1:${port}/postgres`,
    max: 8,
  });

  // 1, 2, 7: physically empty PostgreSQL schema, complete bootstrap and rerun.
  const emptySchema = "bootstrap_empty";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(emptySchema)}`);
  const emptyResult = await runDatabaseBootstrap(pool, { schemaName: emptySchema, environment });
  assert.equal(emptyResult.initialState, "empty");
  assert.equal(emptyResult.baselineInstalled, true);
  assert.equal(emptyResult.applied.length, 17);
  assert.equal(await count(pool, emptySchema, "users"), 0);
  assert.equal(await count(pool, emptySchema, "barbers"), 0);
  assert.equal(await count(pool, emptySchema, "admins"), 0);
  assert.equal(await count(pool, emptySchema, "locations"), 1);
  assert.equal(await count(pool, emptySchema, "schema_migrations"), 18);
  const rerun = await runDatabaseBootstrap(pool, { schemaName: emptySchema, environment });
  assert.equal(rerun.initialState, "versioned");
  assert.equal(rerun.baselineInstalled, false);
  assert.deepEqual(rerun.applied, []);
  assert.equal(rerun.alreadyApplied, 17);

  // Recover the exact harmless footprint left by the previously failing db:migrate.
  const emptyLedgerSchema = "bootstrap_empty_ledger";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(emptyLedgerSchema)}`);
  await pool.query(`CREATE TABLE ${table(emptyLedgerSchema, "schema_migrations")} (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamp NOT NULL DEFAULT now()
  )`);
  const emptyLedgerResult = await runDatabaseBootstrap(pool, { schemaName: emptyLedgerSchema, environment });
  assert.equal(emptyLedgerResult.initialState, "empty-ledger");
  assert.equal(emptyLedgerResult.baselineInstalled, true);
  assert.equal(emptyLedgerResult.applied.length, 17);

  // 3: an exact legacy baseline plus an empty ledger is adopted, not recreated.
  const legacyLedgerSchema = "bootstrap_legacy_ledger";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(legacyLedgerSchema)}`);
  await installBaseline(pool, legacyLedgerSchema, baselineSql, true);
  const legacyLedgerResult = await runDatabaseBootstrap(pool, { schemaName: legacyLedgerSchema, environment });
  assert.equal(legacyLedgerResult.initialState, "legacy-baseline");
  assert.equal(legacyLedgerResult.baselineInstalled, false);
  assert.equal(legacyLedgerResult.baselineRecorded, true);
  assert.equal(legacyLedgerResult.applied.length, 17);

  // 4: a versioned partial installation resumes at the next missing migration.
  const partialSchema = "bootstrap_partial";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(partialSchema)}`);
  const partialFirst = await runDatabaseBootstrap(pool, {
    schemaName: partialSchema,
    environment,
    migrationsDirectory: through0007,
  });
  assert.equal(partialFirst.applied.length, 7);
  const partialResume = await runDatabaseBootstrap(pool, { schemaName: partialSchema, environment });
  assert.equal(partialResume.initialState, "versioned");
  assert.equal(partialResume.applied.length, 10);
  assert.equal(partialResume.applied[0], "0008_appointment_extras.sql");
  assert.equal(partialResume.applied.at(-1), "0017_service_buffers.sql");

  // 5, 6: an installation through 0016 receives only 0017, then becomes a no-op.
  const through0016Schema = "bootstrap_through_0016";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(through0016Schema)}`);
  const first0016 = await runDatabaseBootstrap(pool, {
    schemaName: through0016Schema,
    environment,
    migrationsDirectory: through0016,
  });
  assert.equal(first0016.applied.length, 16);
  const apply0017 = await runDatabaseBootstrap(pool, { schemaName: through0016Schema, environment });
  assert.deepEqual(apply0017.applied, ["0017_service_buffers.sql"]);
  const after0017 = await runDatabaseBootstrap(pool, { schemaName: through0016Schema, environment });
  assert.deepEqual(after0017.applied, []);

  // 9, 10: /setup creates only one canonical Administrator; restart remains seed-free.
  const bootstrapToken = "database-bootstrap-test-token-at-least-32-characters";
  assert.deepEqual(
    await getCanonicalBootstrapStatus(pool, {
      schemaName: emptySchema,
      environment: { BOOTSTRAP_ADMIN_TOKEN: bootstrapToken },
    }),
    { available: true, configured: true },
  );
  const administrator = await bootstrapCanonicalAdministrator(pool, {
    token: bootstrapToken,
    displayName: "Beauty Administrator",
    email: "admin@beauty.example.test",
    password: "Beauty-bootstrap-password-2026",
  }, {
    schemaName: emptySchema,
    environment: { BOOTSTRAP_ADMIN_TOKEN: bootstrapToken },
    passwordHashRounds: 4,
  });
  assert.equal(await count(pool, emptySchema, "users"), 1);
  assert.equal(await count(pool, emptySchema, "barbers"), 0);
  assert.equal(await count(pool, emptySchema, "admins"), 0);
  assert.equal(Number((await pool.query(`
    SELECT count(*) AS count FROM ${table(emptySchema, "user_access_scopes")}
    WHERE user_id = $1 AND location_id IS NULL AND preset_key = 'administrator'
  `, [administrator.userId])).rows[0].count), 1);
  const restartCalls: string[] = [];
  assert.equal(await runInitialSeedPolicy({
    authRuntimeMode: "canonical",
    hasLegacyProfessionalData: false,
    hasCanonicalUsers: true,
    prepareCanonicalInstallation: async () => { restartCalls.push("canonical"); },
    runLegacySeed: async () => { restartCalls.push("legacy"); },
  }), "canonical");
  assert.deepEqual(restartCalls, ["canonical"]);
  assert.equal(await count(pool, emptySchema, "barbers"), 0);

  // 8: legacy mode still selects the existing legacy seed lifecycle.
  const legacyCalls: string[] = [];
  assert.equal(await runInitialSeedPolicy({
    authRuntimeMode: "legacy",
    hasLegacyProfessionalData: false,
    hasCanonicalUsers: false,
    prepareCanonicalInstallation: async () => { legacyCalls.push("canonical"); },
    runLegacySeed: async () => { legacyCalls.push("legacy"); },
  }), "legacy");
  assert.deepEqual(legacyCalls, ["legacy"]);

  // 11: concurrent bootstraps serialize; only one installs the baseline.
  const concurrentSchema = "bootstrap_concurrent";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(concurrentSchema)}`);
  const concurrent = await Promise.all([
    runDatabaseBootstrap(pool, { schemaName: concurrentSchema, environment }),
    runDatabaseBootstrap(pool, { schemaName: concurrentSchema, environment }),
  ]);
  assert.equal(concurrent.filter((result) => result.baselineInstalled).length, 1);
  assert.equal(concurrent.reduce((sum, result) => sum + result.applied.length, 0), 17);
  assert.equal(await count(pool, concurrentSchema, "schema_migrations"), 18);

  // 12: an unknown/mixed schema fails before creating a ledger or other table.
  const mixedSchema = "bootstrap_mixed";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(mixedSchema)}`);
  await pool.query(`CREATE TABLE ${table(mixedSchema, "barbers")} (id serial PRIMARY KEY)`);
  await assert.rejects(
    runDatabaseBootstrap(pool, { schemaName: mixedSchema, environment }),
    (error: unknown) => error instanceof DatabaseBootstrapError && /unknown or mixed/.test(error.message),
  );
  const mixedTables = (await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name
  `, [mixedSchema])).rows.map((row) => row.table_name);
  assert.deepEqual(mixedTables, ["barbers"]);

  // 13: both baseline and migration checksums are immutable and fail closed.
  const ledgerBeforeChecksumFailures = await count(pool, through0016Schema, "schema_migrations");
  await assert.rejects(
    runDatabaseBootstrap(pool, {
      schemaName: through0016Schema,
      environment,
      baselineFile: modifiedBaselineFile,
    }),
    /0000_legacy_baseline\.sql has been modified/,
  );
  await assert.rejects(
    runDatabaseBootstrap(pool, {
      schemaName: through0016Schema,
      environment,
      migrationsDirectory: modifiedMigrations,
    }),
    /0017_service_buffers\.sql has been modified/,
  );
  assert.equal(await count(pool, through0016Schema, "schema_migrations"), ledgerBeforeChecksumFailures);

  // 14: the existing db:migrate runner remains valid for an already-provisioned legacy baseline.
  const migrateRegressionSchema = "bootstrap_migrate_regression";
  await pool.query(`CREATE SCHEMA ${quoteIdentifier(migrateRegressionSchema)}`);
  await installBaseline(pool, migrateRegressionSchema, baselineSql);
  const migrateRegression = await runSchemaMigrations(pool, {
    schemaName: migrateRegressionSchema,
    environment,
  });
  assert.equal(migrateRegression.applied.length, 17);
  assert.equal(await count(pool, migrateRegressionSchema, "schema_migrations"), 17);
  assert.equal(await count(pool, migrateRegressionSchema, "users"), 0);

  const expectedBaselineChecksum = migrationChecksum(baselineSql);
  const recordedBaseline = (await pool.query<{ checksum: string }>(`
    SELECT checksum FROM ${table(concurrentSchema, "schema_migrations")} WHERE name = $1
  `, [DATABASE_BASELINE_NAME])).rows[0];
  assert.equal(recordedBaseline.checksum, expectedBaselineChecksum);

  console.log("Database bootstrap tests passed: empty/rerun/legacy/partial/0016/0017/canonical/legacy/concurrent/fail-closed/checksums/db:migrate.");
} finally {
  if (pool) await pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(through0007, { recursive: true, force: true });
  await rm(through0016, { recursive: true, force: true });
  await rm(modifiedMigrations, { recursive: true, force: true });
  await rm(modifiedBaselineDirectory, { recursive: true, force: true });
}
