import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { capabilityCodes, capabilityRegistry } from "../shared/auth";
import { runLegacyAuthPreflight } from "../server/auth-legacy-preflight";
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

async function createLegacyFoundation(pool: pg.Pool, schema: string, withRows: boolean) {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE ${table(schema, "locations")} (
      id serial PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE ${table(schema, "barbers")} (
      id serial PRIMARY KEY,
      name text NOT NULL,
      specialty text NOT NULL,
      email text,
      password text
    );
    CREATE TABLE ${table(schema, "admins")} (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      email text UNIQUE,
      password text NOT NULL
    );
    CREATE TABLE ${table(schema, "barber_invites")} (
      id serial PRIMARY KEY,
      barber_id integer NOT NULL REFERENCES ${table(schema, "barbers")}(id),
      token text NOT NULL UNIQUE,
      expires_at timestamp NOT NULL,
      used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE ${table(schema, "audit_logs")} (
      id serial PRIMARY KEY,
      actor_type text NOT NULL,
      actor_id integer,
      actor_name text,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id integer,
      summary text NOT NULL,
      metadata text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE ${table(schema, "session")} (
      sid varchar NOT NULL PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp NOT NULL
    );
  `);

  if (!withRows) return;
  await pool.query(`
    INSERT INTO ${table(schema, "locations")} (name) VALUES ('Loja legacy');
    INSERT INTO ${table(schema, "barbers")} (name, specialty, email, password)
      VALUES ('Bruno legacy', 'Corte', 'bs881366@gmail.com', '$2b$legacy-barber');
    INSERT INTO ${table(schema, "admins")} (username, email, password)
      VALUES ('bs881366@gmail.com', 'bs881366@gmail.com', '$2b$legacy-admin');
    INSERT INTO ${table(schema, "barber_invites")} (barber_id, token, expires_at)
      VALUES (1, 'legacy-token', now() + interval '1 day');
    INSERT INTO ${table(schema, "audit_logs")} (
      actor_type, actor_id, actor_name, action, entity_type, entity_id, summary
    ) VALUES ('admin', 1, 'admin', 'legacy.action', 'legacy', 1, 'Legacy audit');
    INSERT INTO ${table(schema, "session")} (sid, sess, expire)
      VALUES ('legacy-admin-session', '{"role":"admin"}', '2031-01-01 00:00:00');
  `);
}

async function rejectsSql(pool: pg.Pool, sql: string, params: unknown[] = []) {
  await assert.rejects(pool.query(sql, params));
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-pg-"));
const migrationDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-migration-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-migration-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let pool: pg.Pool | undefined;

try {
  await copyFile(
    path.resolve(process.cwd(), "migrations/0015_auth_users_foundation.sql"),
    path.join(migrationDirectory, "0015_auth_users_foundation.sql"),
  );
  await embedded.initialise();
  await embedded.start();
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:auth-migration-test@127.0.0.1:${port}/postgres`,
    max: 4,
  });
  const environment = {
    NODE_ENV: "production",
    APP_ENV: "production",
    MIGRATION_DEFAULT_LOCATION_NAME: "Fixture",
    MIGRATION_DEFAULT_LOCATION_ADDRESS: "Fixture address",
    MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
  };

  const legacySchema = "auth_legacy_fixture";
  await createLegacyFoundation(pool, legacySchema, true);
  const preMigrationPreflight = await runLegacyAuthPreflight(pool, {
    schemaName: legacySchema,
    now: new Date("2030-01-01T12:00:00.000Z"),
  });
  assert.equal(preMigrationPreflight.cases[0].classification, "MANUAL_REVIEW",
    "the read-only preflight must work before migration 0015 adds legacy user_id links");
  assert.deepEqual(preMigrationPreflight.cases[0].linkedUserIds, []);
  const legacyRun = await runSchemaMigrations(pool, {
    schemaName: legacySchema,
    environment,
    migrationsDirectory: migrationDirectory,
  });
  assert.deepEqual(legacyRun.applied, ["0015_auth_users_foundation.sql"]);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(legacySchema, "users")}`)).rows[0].count), 0,
    "P2A must not backfill users");
  assert.equal((await pool.query(`SELECT user_id, email, password FROM ${table(legacySchema, "barbers")} WHERE id = 1`)).rows[0].user_id, null);
  assert.deepEqual(
    (await pool.query(`SELECT username, email, password, user_id FROM ${table(legacySchema, "admins")} WHERE id = 1`)).rows[0],
    { username: "bs881366@gmail.com", email: "bs881366@gmail.com", password: "$2b$legacy-admin", user_id: null },
    "legacy admin credentials must remain byte-for-byte untouched",
  );
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(legacySchema, "audit_logs")}`)).rows[0].count), 1);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(legacySchema, "barber_invites")}`)).rows[0].count), 1);

  const preflight = await runLegacyAuthPreflight(pool, {
    schemaName: legacySchema,
    now: new Date("2030-01-01T12:00:00.000Z"),
  });
  assert.equal(preflight.readOnly, true);
  assert.equal(preflight.cases.length, 1);
  assert.equal(preflight.cases[0].classification, "MANUAL_REVIEW");
  assert.equal(preflight.cases[0].credentialComparison, "different");
  assert.deepEqual(preflight.cases[0].adminIds, [1]);
  assert.deepEqual(preflight.cases[0].barberIds, [1]);
  assert.deepEqual(preflight.inventory.sessions, {
    tablePresent: true,
    total: 1,
    active: 1,
    activeAdmin: 1,
    activeBarber: 0,
    activeUnknownRole: 0,
  });
  assert.equal(JSON.stringify(preflight).includes("$2b$legacy"), false,
    "the read-only report must never expose legacy password hashes");
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(legacySchema, "users")}`)).rows[0].count), 0,
    "running the preflight must not create canonical users");
  assert.equal((await pool.query(`SELECT user_id FROM ${table(legacySchema, "admins")} WHERE id = 1`)).rows[0].user_id, null,
    "running the preflight must not link legacy admins");
  assert.equal((await pool.query(`SELECT user_id FROM ${table(legacySchema, "barbers")} WHERE id = 1`)).rows[0].user_id, null,
    "running the preflight must not link legacy professionals");

  const rerun = await runSchemaMigrations(pool, {
    schemaName: legacySchema,
    environment,
    migrationsDirectory: migrationDirectory,
  });
  assert.deepEqual(rerun, { applied: [], alreadyApplied: 1 });

  const userResult = await pool.query(`
    INSERT INTO ${table(legacySchema, "users")} (
      display_name, username, email, password_hash, status
    ) VALUES ('Bruno Santos', ' Bruno.Legacy ', ' BS881366@GMAIL.COM ', '$2b$canonical', 'active')
    RETURNING id, username_key, email_key, auth_version
  `);
  const userId = Number(userResult.rows[0].id);
  assert.deepEqual(
    { usernameKey: userResult.rows[0].username_key, emailKey: userResult.rows[0].email_key, authVersion: userResult.rows[0].auth_version },
    { usernameKey: "bruno.legacy", emailKey: "bs881366@gmail.com", authVersion: 1 },
  );
  const invitedUser = await pool.query(`
    INSERT INTO ${table(legacySchema, "users")} (display_name, email, status)
    VALUES ('Convidado', 'invite@example.test', 'invited') RETURNING id
  `);
  const invitedUserId = Number(invitedUser.rows[0].id);

  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "users")} (display_name, email, status)
    VALUES ('Ativo sem password', 'missing-password@example.test', 'active')`);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "users")} (display_name, email)
    VALUES ('Duplicado', 'bs881366@GMAIL.com')`);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "users")} (display_name, username, email)
    VALUES ('Username duplicado', 'BRUNO.LEGACY', 'other@example.test')`);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "users")} (display_name, email, auth_version)
    VALUES ('Versão inválida', 'version@example.test', 0)`);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "users")} (display_name, email, status)
    VALUES ('Estado inválido', 'status@example.test', 'unknown')`);

  await pool.query(`UPDATE ${table(legacySchema, "barbers")} SET user_id = $1 WHERE id = 1`, [userId]);
  await pool.query(`UPDATE ${table(legacySchema, "admins")} SET user_id = $1 WHERE id = 1`, [userId]);
  assert.deepEqual(
    (await pool.query(`SELECT
      (SELECT user_id FROM ${table(legacySchema, "barbers")} WHERE id = 1) AS barber_user_id,
      (SELECT user_id FROM ${table(legacySchema, "admins")} WHERE id = 1) AS admin_user_id
    `)).rows[0],
    { barber_user_id: userId, admin_user_id: userId },
    "one canonical user may link both the professional profile and legacy admin",
  );
  await pool.query(`INSERT INTO ${table(legacySchema, "barbers")} (name, specialty) VALUES ('Outro', 'Corte')`);
  await rejectsSql(pool, `UPDATE ${table(legacySchema, "barbers")} SET user_id = $1 WHERE id = 2`, [userId]);
  await rejectsSql(pool, `UPDATE ${table(legacySchema, "barbers")} SET user_id = 999999 WHERE id = 2`);

  const globalScope = await pool.query(`
    INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id, preset_key)
    VALUES ($1, 'administrator') RETURNING id
  `, [userId]);
  const globalScopeId = Number(globalScope.rows[0].id);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id) VALUES ($1)`, [userId]);
  await pool.query(`INSERT INTO ${table(legacySchema, "locations")} (name) VALUES ('Loja B')`);
  const localScope = await pool.query(`
    INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id, location_id, preset_key)
    VALUES ($1, 1, 'professional') RETURNING id
  `, [userId]);
  const localScopeId = Number(localScope.rows[0].id);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id, location_id)
    VALUES ($1, 1)`, [userId]);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id, location_id, preset_key)
    VALUES ($1, 2, 'administrator')`, [userId]);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id, location_id, preset_key)
    VALUES ($1, 2, 'manager')`, [userId]);

  for (const capability of capabilityCodes) {
    await pool.query(`INSERT INTO ${table(legacySchema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
      VALUES ($1, $2)`, [globalScopeId, capability]);
  }
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(legacySchema, "user_access_scope_capabilities")}
    WHERE access_scope_id = $1`, [globalScopeId])).rows[0].count), capabilityCodes.length);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
    VALUES ($1, 'unknown.capability')`, [localScopeId]);
  await pool.query(`INSERT INTO ${table(legacySchema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
    VALUES ($1, 'catalog.view')`, [localScopeId]);

  const globalOnlyCapabilities = capabilityCodes.filter(
    (capability) => !capabilityRegistry[capability].locationGrantAllowed,
  );
  for (const capability of globalOnlyCapabilities) {
    await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
      VALUES ($1, $2)`, [localScopeId, capability]);
  }

  const movableGlobalScope = await pool.query(`
    INSERT INTO ${table(legacySchema, "user_access_scopes")} (user_id)
    VALUES ($1) RETURNING id
  `, [invitedUserId]);
  await pool.query(`INSERT INTO ${table(legacySchema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
    VALUES ($1, 'users.manage')`, [movableGlobalScope.rows[0].id]);
  await rejectsSql(pool, `UPDATE ${table(legacySchema, "user_access_scopes")} SET location_id = 2 WHERE id = $1`,
    [movableGlobalScope.rows[0].id]);

  await pool.query(`
    INSERT INTO ${table(legacySchema, "user_invites")} (
      user_id, token_digest, invited_by_user_id, expires_at
    ) VALUES ($1, 'sha256:digest-only', $2, now() + interval '1 day')
  `, [invitedUserId, userId]);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_invites")} (user_id, token_digest, expires_at)
    VALUES ($1, 'sha256:digest-only', now() + interval '1 day')`, [invitedUserId]);
  await rejectsSql(pool, `INSERT INTO ${table(legacySchema, "user_invites")} (
      user_id, token_digest, expires_at, accepted_at, revoked_at
    ) VALUES ($1, 'sha256:invalid-terminal', now() + interval '1 day', now(), now())`, [invitedUserId]);

  await pool.query(`UPDATE ${table(legacySchema, "audit_logs")}
    SET actor_user_id = $1, actor_professional_id = 1, location_id = 1 WHERE id = 1`, [userId]);
  assert.deepEqual(
    (await pool.query(`SELECT actor_user_id, actor_professional_id, location_id
      FROM ${table(legacySchema, "audit_logs")} WHERE id = 1`)).rows[0],
    { actor_user_id: userId, actor_professional_id: 1, location_id: 1 },
  );

  const freshSchema = "auth_fresh_fixture";
  await createLegacyFoundation(pool, freshSchema, false);
  const freshRun = await runSchemaMigrations(pool, {
    schemaName: freshSchema,
    environment,
    migrationsDirectory: migrationDirectory,
  });
  assert.deepEqual(freshRun.applied, ["0015_auth_users_foundation.sql"]);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(freshSchema, "users")}`)).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(freshSchema, "user_access_scopes")}`)).rows[0].count), 0);

  console.log("PASS: additive auth users migration preserved legacy data, created no users, and enforced identity, scope, capability, invite and audit constraints.");
} finally {
  if (pool) await pool.end();
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationDirectory, { recursive: true, force: true });
}
