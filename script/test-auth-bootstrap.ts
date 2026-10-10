import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  bootstrapCanonicalAdministrator,
  CanonicalBootstrapError,
  getCanonicalBootstrapStatus,
} from "../server/auth-bootstrap";
import { authenticateCanonicalUser, loadCanonicalAuthContext } from "../server/auth-runtime";
import { CanonicalUserManagementError, setCanonicalUserStatus } from "../server/auth-user-management";
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
    CREATE TABLE ${table(schema, "locations")} (id serial PRIMARY KEY, name text NOT NULL);
    CREATE TABLE ${table(schema, "barbers")} (
      id serial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL,
      email text, password text, is_visible boolean DEFAULT true
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
    INSERT INTO ${table(schema, "locations")} (name) VALUES ('Loja principal');
  `);
}

function expectBootstrapCode(code: string) {
  return (error: unknown) => {
    assert(error instanceof CanonicalBootstrapError);
    assert.equal(error.code, code);
    return true;
  };
}

const token = "bootstrap-test-token-with-at-least-32-characters";
const environment = { BOOTSTRAP_ADMIN_TOKEN: token };
const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-bootstrap-pg-"));
const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-bootstrap-migration-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-bootstrap-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let pool: pg.Pool | undefined;

try {
  await copyFile(
    path.resolve(process.cwd(), "migrations/0015_auth_users_foundation.sql"),
    path.join(migrationsDirectory, "0015_auth_users_foundation.sql"),
  );
  await embedded.initialise();
  await embedded.start();
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:auth-bootstrap-test@127.0.0.1:${port}/postgres`,
    max: 6,
  });

  const schema = "auth_bootstrap_fixture";
  const options = { schemaName: schema, environment, passwordHashRounds: 4 };
  await createLegacyFoundation(pool, schema);
  await runSchemaMigrations(pool, {
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

  assert.deepEqual(await getCanonicalBootstrapStatus(pool, options), { available: true, configured: true });
  await assert.rejects(bootstrapCanonicalAdministrator(pool, {
    token: "wrong",
    displayName: "Intruso",
    email: "intruder@example.test",
    password: "Intruder-password-2026",
  }, options), expectBootstrapCode("BOOTSTRAP_DENIED"));
  await assert.rejects(bootstrapCanonicalAdministrator(pool, {
    displayName: "Sem token",
    email: "missing@example.test",
    password: "Missing-password-2026",
  }, options), expectBootstrapCode("BOOTSTRAP_DENIED"));
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM ${table(schema, "users")}`)).rows[0].count, 0);

  const attempts = await Promise.allSettled([
    bootstrapCanonicalAdministrator(pool, {
      token,
      displayName: "Primeiro Admin A",
      email: "first-a@example.test",
      password: "Bootstrap-password-2026",
    }, options),
    bootstrapCanonicalAdministrator(pool, {
      token,
      displayName: "Primeiro Admin B",
      email: "first-b@example.test",
      password: "Bootstrap-password-2026",
    }, options),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const rejected = attempts.find((attempt) => attempt.status === "rejected");
  assert(rejected?.status === "rejected");
  assert(expectBootstrapCode("BOOTSTRAP_CLOSED")(rejected.reason));
  const fulfilled = attempts.find((attempt) => attempt.status === "fulfilled");
  assert(fulfilled?.status === "fulfilled");
  const identity = fulfilled.value;

  const created = await pool.query<{
    user_count: number;
    global_admin_count: number;
    professional_count: number;
    legacy_admin_count: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM ${table(schema, "users")}) AS user_count,
      (SELECT count(*)::integer FROM ${table(schema, "user_access_scopes")}
        WHERE user_id = $1 AND location_id IS NULL AND preset_key = 'administrator') AS global_admin_count,
      (SELECT count(*)::integer FROM ${table(schema, "barbers")} WHERE user_id = $1) AS professional_count,
      (SELECT count(*)::integer FROM ${table(schema, "admins")}) AS legacy_admin_count
  `, [identity.userId]);
  assert.deepEqual(created.rows[0], {
    user_count: 1,
    global_admin_count: 1,
    professional_count: 0,
    legacy_admin_count: 0,
  });

  assert.deepEqual(await getCanonicalBootstrapStatus(pool, options), { available: false, configured: true });
  await assert.rejects(bootstrapCanonicalAdministrator(pool, {
    token,
    displayName: "Segundo Admin",
    email: "second@example.test",
    password: "Second-password-2026",
  }, options), expectBootstrapCode("BOOTSTRAP_CLOSED"));

  const canonicalUser = (await pool.query<{ email: string }>(`
    SELECT email FROM ${table(schema, "users")} WHERE id = $1
  `, [identity.userId])).rows[0];
  const authenticated = await authenticateCanonicalUser(
    pool,
    canonicalUser.email,
    "Bootstrap-password-2026",
    { schemaName: schema },
  );
  assert(authenticated);
  assert.equal(authenticated.context.isGlobalAdministrator, true);
  assert.equal(authenticated.context.professionalId, null);

  const context = await loadCanonicalAuthContext(pool, identity.userId, { schemaName: schema });
  assert(context);
  await assert.rejects(
    setCanonicalUserStatus(pool, context, identity.userId, "disabled", { schemaName: schema }),
    (error: unknown) => {
      assert(error instanceof CanonicalUserManagementError);
      assert.equal(error.code, "SELF_LOCKOUT");
      return true;
    },
  );

  const audit = await pool.query<{ metadata: string | null }>(`
    SELECT metadata FROM ${table(schema, "audit_logs")}
    WHERE action = 'auth.bootstrap_completed'
  `);
  assert.equal(audit.rows.length, 1);
  const serializedAudit = JSON.stringify(audit.rows);
  assert(!serializedAudit.includes(token));
  assert(!serializedAudit.includes("Bootstrap-password-2026"));
  assert.match(serializedAudit, /administrator/);

  console.log("Auth bootstrap PostgreSQL checks passed.");
} finally {
  await pool?.end().catch(() => undefined);
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationsDirectory, { recursive: true, force: true });
}
