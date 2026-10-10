import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import bcrypt from "bcryptjs";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runAuthCutoverCheck } from "../server/auth-cutover-check";
import { runLegacyAuthBackfill } from "../server/auth-legacy-backfill";
import {
  authenticateCanonicalUser,
  parseAuthRuntimeMode,
  validateCanonicalAuthFoundation,
} from "../server/auth-runtime";
import { runSchemaMigrations } from "../server/migrations";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function table(schema: string, name: string) {
  return `"${schema}"."${name}"`;
}

async function createLegacyFoundation(pool: pg.Pool, schema: string) {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE ${table(schema, "locations")} (
      id serial PRIMARY KEY, name text NOT NULL, is_default boolean NOT NULL DEFAULT false
    );
    CREATE TABLE ${table(schema, "barbers")} (
      id serial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL,
      email text, password text, is_visible boolean DEFAULT true
    );
    CREATE TABLE ${table(schema, "barber_locations")} (
      barber_id integer NOT NULL REFERENCES ${table(schema, "barbers")}(id) ON DELETE CASCADE,
      location_id integer NOT NULL REFERENCES ${table(schema, "locations")}(id) ON DELETE RESTRICT,
      is_active boolean NOT NULL DEFAULT true,
      PRIMARY KEY (barber_id, location_id)
    );
    CREATE TABLE ${table(schema, "admins")} (
      id serial PRIMARY KEY, username text NOT NULL UNIQUE, email text UNIQUE, password text NOT NULL
    );
    CREATE TABLE ${table(schema, "barber_invites")} (
      id serial PRIMARY KEY, barber_id integer NOT NULL REFERENCES ${table(schema, "barbers")}(id),
      token text NOT NULL UNIQUE, expires_at timestamp NOT NULL, used_at timestamp, created_at timestamp DEFAULT now()
    );
    CREATE TABLE ${table(schema, "audit_logs")} (
      id serial PRIMARY KEY, actor_type text NOT NULL, actor_id integer, actor_name text,
      action text NOT NULL, entity_type text NOT NULL, entity_id integer, summary text NOT NULL,
      metadata text, created_at timestamp DEFAULT now()
    );
    CREATE TABLE ${table(schema, "session")} (
      sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL
    );
    CREATE TABLE ${table(schema, "blacklist")} (
      id serial PRIMARY KEY, email text, phone text, reason text NOT NULL, created_at timestamp DEFAULT now()
    );
    INSERT INTO ${table(schema, "locations")} (name, is_default) VALUES ('Principal', true);
  `);
}

async function applyCutoverMigrations(pool: pg.Pool, schema: string, migrationsDirectory: string) {
  const result = await runSchemaMigrations(pool, {
    schemaName: schema,
    migrationsDirectory,
    environment: {
      NODE_ENV: "test",
      APP_ENV: "development",
      MIGRATION_DEFAULT_LOCATION_NAME: "Fixture",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Fixture",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    },
  });
  assert.deepEqual(result.applied, [
    "0015_auth_users_foundation.sql",
    "0016_blacklist_location_scope.sql",
  ]);
}

function issueCodes(report: Awaited<ReturnType<typeof runAuthCutoverCheck>>) {
  return new Set(report.issues.map((issue) => issue.code));
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-cutover-pg-"));
const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-cutover-migrations-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-cutover-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let pool: pg.Pool | undefined;

try {
  for (const migration of ["0015_auth_users_foundation.sql", "0016_blacklist_location_scope.sql"]) {
    await copyFile(path.resolve(process.cwd(), "migrations", migration), path.join(migrationsDirectory, migration));
  }
  await embedded.initialise();
  await embedded.start();
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:auth-cutover-test@127.0.0.1:${port}/postgres`,
    max: 8,
  });
  const now = new Date("2030-01-15T12:00:00.000Z");
  const password = "Cutover-password-2026";
  const passwordHash = await bcrypt.hash(password, 4);

  const missingMigrationsSchema = "auth_cutover_missing_migrations";
  await createLegacyFoundation(pool, missingMigrationsSchema);
  const missingMigrations = await runAuthCutoverCheck(pool, {
    schemaName: missingMigrationsSchema,
    now,
    environment: {},
  });
  assert.equal(missingMigrations.status, "NOT_READY");
  assert(issueCodes(missingMigrations).has("MIGRATIONS_MISSING"));
  assert(issueCodes(missingMigrations).has("CANONICAL_FOUNDATION_MISSING"));

  const readySchema = "auth_cutover_ready";
  await createLegacyFoundation(pool, readySchema);
  await pool.query(`
    INSERT INTO ${table(readySchema, "admins")} (username, email, password)
      VALUES ('owner@example.test', 'owner@example.test', $1)
  `, [passwordHash]);
  await pool.query(`
    INSERT INTO ${table(readySchema, "session")} (sid, sess, expire)
      VALUES ('legacy-session', '{"role":"admin","adminId":1}', '2031-01-01')
  `);
  await applyCutoverMigrations(pool, readySchema, migrationsDirectory);
  await runLegacyAuthBackfill(pool, { apply: true, schemaName: readySchema, now });
  const beforeCheck = await pool.query<{ users: number; last_logins: number }>(`
    SELECT
      count(*)::integer AS users,
      count(last_login_at)::integer AS last_logins
    FROM ${table(readySchema, "users")}
  `);
  const ready = await runAuthCutoverCheck(pool, { schemaName: readySchema, now, environment: {} });
  assert.equal(ready.status, "READY");
  assert.equal(ready.checks.migrations.missing.length, 0);
  assert.equal(ready.checks.preflight.MANUAL_REVIEW, 0);
  assert.equal(ready.checks.preflight.BLOCKER, 0);
  assert.equal(ready.checks.users.activeGlobalAdministrators, 1);
  assert.equal(ready.checks.bootstrap.closed, true);
  assert(issueCodes(ready).has("ACTIVE_LEGACY_SESSIONS"));
  assert(!JSON.stringify(ready).includes(passwordHash));
  assert(!JSON.stringify(ready).includes("legacy-session"));
  const afterCheck = await pool.query<{ users: number; last_logins: number }>(`
    SELECT
      count(*)::integer AS users,
      count(last_login_at)::integer AS last_logins
    FROM ${table(readySchema, "users")}
  `);
  assert.deepEqual(afterCheck.rows[0], beforeCheck.rows[0], "cutover readiness check must not mutate users");

  await validateCanonicalAuthFoundation(pool, { schemaName: readySchema });
  const canonicalLogin = await authenticateCanonicalUser(
    pool,
    "owner@example.test",
    password,
    { schemaName: readySchema },
  );
  assert(canonicalLogin?.context.isGlobalAdministrator);
  const legacyHash = (await pool.query<{ password: string }>(`
    SELECT password FROM ${table(readySchema, "admins")} WHERE username = 'owner@example.test'
  `)).rows[0].password;
  assert(await bcrypt.compare(password, legacyHash), "legacy credentials remain valid for rollback");
  assert.equal(parseAuthRuntimeMode("canonical"), "canonical");
  assert.equal(parseAuthRuntimeMode("legacy"), "legacy");

  const manualSchema = "auth_cutover_manual";
  await createLegacyFoundation(pool, manualSchema);
  await pool.query(`INSERT INTO ${table(manualSchema, "admins")} (username, password) VALUES ('legacy-owner', $1)`, [passwordHash]);
  await applyCutoverMigrations(pool, manualSchema, migrationsDirectory);
  const manual = await runAuthCutoverCheck(pool, { schemaName: manualSchema, now, environment: {} });
  assert.equal(manual.status, "NOT_READY");
  assert(issueCodes(manual).has("LEGACY_MANUAL_REVIEW"));

  const blockerSchema = "auth_cutover_blocker";
  await createLegacyFoundation(pool, blockerSchema);
  await pool.query(`
    INSERT INTO ${table(blockerSchema, "barbers")} (name, specialty, email, password) VALUES
      ('Duplicado A', 'Serviço', 'duplicate@example.test', $1),
      ('Duplicado B', 'Serviço', 'DUPLICATE@example.test', $1)
  `, [passwordHash]);
  await applyCutoverMigrations(pool, blockerSchema, migrationsDirectory);
  const blocker = await runAuthCutoverCheck(pool, { schemaName: blockerSchema, now, environment: {} });
  assert.equal(blocker.status, "NOT_READY");
  assert(issueCodes(blocker).has("LEGACY_BLOCKERS"));

  const noAdminSchema = "auth_cutover_no_admin";
  await createLegacyFoundation(pool, noAdminSchema);
  const professionalId = (await pool.query<{ id: number }>(`
    INSERT INTO ${table(noAdminSchema, "barbers")} (name, specialty, email, password)
      VALUES ('Profissional', 'Serviço', 'professional@example.test', $1) RETURNING id
  `, [passwordHash])).rows[0].id;
  await pool.query(`INSERT INTO ${table(noAdminSchema, "barber_locations")} (barber_id, location_id) VALUES ($1, 1)`, [professionalId]);
  await applyCutoverMigrations(pool, noAdminSchema, migrationsDirectory);
  await runLegacyAuthBackfill(pool, { apply: true, schemaName: noAdminSchema, now });
  const noAdmin = await runAuthCutoverCheck(pool, { schemaName: noAdminSchema, now, environment: {} });
  assert.equal(noAdmin.status, "NOT_READY");
  assert(issueCodes(noAdmin).has("NO_ACTIVE_GLOBAL_ADMINISTRATOR"));

  const incompleteSchema = "auth_cutover_incomplete";
  await createLegacyFoundation(pool, incompleteSchema);
  await pool.query(`
    INSERT INTO ${table(incompleteSchema, "admins")} (username, email, password)
      VALUES ('incomplete@example.test', 'incomplete@example.test', $1)
  `, [passwordHash]);
  await applyCutoverMigrations(pool, incompleteSchema, migrationsDirectory);
  const incomplete = await runAuthCutoverCheck(pool, { schemaName: incompleteSchema, now, environment: {} });
  assert.equal(incomplete.status, "NOT_READY");
  assert(issueCodes(incomplete).has("LEGACY_LOGIN_NOT_LINKED"));

  const noAccessSchema = "auth_cutover_no_access";
  await createLegacyFoundation(pool, noAccessSchema);
  await pool.query(`
    INSERT INTO ${table(noAccessSchema, "admins")} (username, email, password)
      VALUES ('admin@example.test', 'admin@example.test', $1)
  `, [passwordHash]);
  await applyCutoverMigrations(pool, noAccessSchema, migrationsDirectory);
  await runLegacyAuthBackfill(pool, { apply: true, schemaName: noAccessSchema, now });
  await pool.query(`
    INSERT INTO ${table(noAccessSchema, "users")} (display_name, email, password_hash, status)
      VALUES ('Sem acesso', 'no-access@example.test', $1, 'active')
  `, [passwordHash]);
  const noAccess = await runAuthCutoverCheck(pool, { schemaName: noAccessSchema, now, environment: {} });
  assert.equal(noAccess.status, "NOT_READY");
  assert(issueCodes(noAccess).has("ACTIVE_USERS_WITHOUT_ACCESS"));

  console.log("Canonical auth cutover readiness checks passed.");
} finally {
  await pool?.end().catch(() => undefined);
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationsDirectory, { recursive: true, force: true });
}
