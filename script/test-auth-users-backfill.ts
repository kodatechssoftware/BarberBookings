import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  legacyAuthBackfillLock,
  LegacyAuthBackfillFoundationError,
  LegacyAuthBackfillLockedError,
  parseLegacyAuthBackfillArgs,
  runLegacyAuthBackfill,
} from "../server/auth-legacy-backfill";
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
    CREATE TABLE ${table(schema, "barber_locations")} (
      barber_id integer NOT NULL REFERENCES ${table(schema, "barbers")}(id) ON DELETE CASCADE,
      location_id integer NOT NULL REFERENCES ${table(schema, "locations")}(id) ON DELETE RESTRICT,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (barber_id, location_id)
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
    INSERT INTO ${table(schema, "locations")} (name) VALUES ('Loja A'), ('Loja B');
  `);
}

async function applyFoundationMigration(
  pool: pg.Pool,
  schemaName: string,
  migrationsDirectory: string,
) {
  const result = await runSchemaMigrations(pool, {
    schemaName,
    migrationsDirectory,
    environment: {
      NODE_ENV: "test",
      APP_ENV: "development",
      MIGRATION_DEFAULT_LOCATION_NAME: "Fixture",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Fixture address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    },
  });
  assert.deepEqual(result.applied, ["0015_auth_users_foundation.sql"]);
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-backfill-pg-"));
const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-backfill-migration-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-backfill-test",
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
    connectionString: `postgresql://postgres:auth-backfill-test@127.0.0.1:${port}/postgres`,
    max: 4,
  });

  assert.deepEqual(parseLegacyAuthBackfillArgs([]), { apply: false });
  assert.deepEqual(parseLegacyAuthBackfillArgs(["--dry-run"]), { apply: false });
  assert.deepEqual(parseLegacyAuthBackfillArgs(["--apply"]), { apply: true });
  assert.throws(() => parseLegacyAuthBackfillArgs(["--apply", "--dry-run"]));
  assert.throws(() => parseLegacyAuthBackfillArgs(["--unknown"]));

  const mainSchema = "auth_backfill_fixture";
  await createLegacyFoundation(pool, mainSchema);
  await pool.query(`
    INSERT INTO ${table(mainSchema, "admins")} (username, email, password) VALUES
      ('owner', 'owner@example.test', '$2b$owner'),
      ('BRUNO@EXAMPLE.TEST', 'bruno@example.test', '$2b$bruno'),
      ('legacy@example.test', NULL, '$2b$legacy'),
      ('no-email-admin', NULL, '$2b$no-email'),
      ('different@example.test', 'different@example.test', '$2b$admin-different');

    INSERT INTO ${table(mainSchema, "barbers")} (name, specialty, email, password) VALUES
      ('Ana', 'Corte', 'ANA@example.test', '$2b$ana'),
      ('Bruno', 'Corte', ' bruno@example.test ', '$2b$bruno'),
      ('Convidado', 'Corte', 'invited@example.test', NULL),
      ('Hash diferente', 'Corte', 'different@example.test', '$2b$professional-different'),
      ('Duplicado A', 'Corte', 'duplicate@example.test', '$2b$duplicate-a'),
      ('Duplicado B', 'Corte', 'DUPLICATE@example.test', '$2b$duplicate-b'),
      ('Perfil sem acesso', 'Corte', NULL, NULL);

    INSERT INTO ${table(mainSchema, "barber_locations")} (barber_id, location_id)
    SELECT id, 1 FROM ${table(mainSchema, "barbers")};
    INSERT INTO ${table(mainSchema, "barber_invites")} (barber_id, token, expires_at)
      VALUES (3, 'plaintext-legacy-invite-must-not-be-reported', '2031-01-01');
    INSERT INTO ${table(mainSchema, "session")} (sid, sess, expire)
      VALUES ('legacy-session-must-not-be-reported', '{"role":"barber"}', '2031-01-01');
  `);
  await assert.rejects(
    runLegacyAuthBackfill(pool, { schemaName: mainSchema, now: new Date("2030-01-01T12:00:00.000Z") }),
    (error: unknown) => error instanceof LegacyAuthBackfillFoundationError,
    "backfill must fail clearly until migration 0015 is applied",
  );
  await applyFoundationMigration(pool, mainSchema, migrationsDirectory);

  const now = new Date("2030-01-01T12:00:00.000Z");
  const dryRun = await runLegacyAuthBackfill(pool, { schemaName: mainSchema, now });
  assert.equal(dryRun.mode, "dry-run");
  assert.deepEqual(dryRun.summary, {
    SAFE_AUTO: 5,
    MANUAL_REVIEW: 3,
    BLOCKER: 1,
    CREATED: 0,
    REUSED_USERS: 0,
    LINKED_ADMINS: 0,
    LINKED_PROFESSIONALS: 0,
    ACCESS_SCOPES_CREATED: 0,
    ACCESS_SCOPES_UPDATED: 0,
    WOULD_CREATE: 4,
    WOULD_LINK_ADMINS: 3,
    WOULD_LINK_PROFESSIONALS: 2,
    WOULD_CREATE_ACCESS_SCOPES: 4,
    WOULD_UPDATE_ACCESS_SCOPES: 0,
    UNCHANGED: 0,
    SKIPPED: 5,
    FAILED: 0,
  });
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(mainSchema, "users")}`)).rows[0].count), 0,
    "dry-run must not create users");
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(mainSchema, "user_access_scopes")}`)).rows[0].count), 0,
    "dry-run must not create access scopes");
  const dryRunJson = JSON.stringify(dryRun);
  for (const secret of ["$2b$owner", "$2b$bruno", "plaintext-legacy-invite", "legacy-session-must-not-be-reported"]) {
    assert.equal(dryRunJson.includes(secret), false, `report must not contain ${secret}`);
  }

  const applied = await runLegacyAuthBackfill(pool, { apply: true, schemaName: mainSchema, now });
  assert.equal(applied.mode, "apply");
  assert.deepEqual({
    created: applied.summary.CREATED,
    linkedAdmins: applied.summary.LINKED_ADMINS,
    linkedProfessionals: applied.summary.LINKED_PROFESSIONALS,
    scopes: applied.summary.ACCESS_SCOPES_CREATED,
    skipped: applied.summary.SKIPPED,
    failed: applied.summary.FAILED,
  }, { created: 4, linkedAdmins: 3, linkedProfessionals: 2, scopes: 4, skipped: 5, failed: 0 });
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(mainSchema, "user_invites")}`)).rows[0].count), 0,
    "backfill must not create invitations");
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(mainSchema, "barber_invites")}`)).rows[0].count), 1,
    "backfill must leave the legacy invite flow untouched");

  const canonicalUsers = (await pool.query(`
    SELECT id, display_name, username, email, password_hash, status, auth_version
    FROM ${table(mainSchema, "users")}
    ORDER BY email_key
  `)).rows;
  assert.equal(canonicalUsers.length, 4);
  assert.ok(canonicalUsers.every((user) => user.status === "active" && user.auth_version === 1));
  assert.equal(canonicalUsers.find((user) => user.email.trim().toLowerCase() === "bruno@example.test")?.password_hash, "$2b$bruno");
  assert.equal(canonicalUsers.find((user) => user.email.trim().toLowerCase() === "legacy@example.test")?.username, "legacy@example.test");

  const brunoLinks = (await pool.query(`
    SELECT
      (SELECT user_id FROM ${table(mainSchema, "admins")} WHERE lower(btrim(username)) = 'bruno@example.test') AS admin_user_id,
      (SELECT user_id FROM ${table(mainSchema, "barbers")} WHERE lower(btrim(email)) = 'bruno@example.test') AS professional_user_id
  `)).rows[0];
  assert.equal(brunoLinks.admin_user_id, brunoLinks.professional_user_id);
  assert.ok(brunoLinks.admin_user_id !== null);
  assert.deepEqual((await pool.query(`
    SELECT preset_key, location_id
    FROM ${table(mainSchema, "user_access_scopes")}
    WHERE user_id = $1
  `, [brunoLinks.admin_user_id])).rows, [{ preset_key: "administrator", location_id: null }],
  "Admin + Professional uses one global administrator scope without a redundant professional scope");

  const anaScope = (await pool.query(`
    SELECT scope.preset_key, scope.location_id
    FROM ${table(mainSchema, "barbers")} professional
    JOIN ${table(mainSchema, "user_access_scopes")} scope ON scope.user_id = professional.user_id
    WHERE lower(professional.email) = 'ana@example.test'
  `)).rows;
  assert.deepEqual(anaScope, [{ preset_key: "professional", location_id: 1 }],
    "professional-only legacy access must become an explicit local scope");

  const untouchedAmbiguous = await pool.query(`
    SELECT
      (SELECT count(*)::integer
       FROM ${table(mainSchema, "admins")}
       WHERE lower(btrim(coalesce(email, username))) IN (
         'different@example.test', 'no-email-admin'
       ) AND user_id IS NOT NULL) AS linked_admins,
      (SELECT count(*)::integer
       FROM ${table(mainSchema, "barbers")}
       WHERE lower(btrim(coalesce(email, ''))) IN (
         'different@example.test', 'invited@example.test', 'duplicate@example.test'
       ) AND user_id IS NOT NULL) AS linked_professionals
  `);
  assert.equal(untouchedAmbiguous.rows[0].linked_admins, 0);
  assert.equal(untouchedAmbiguous.rows[0].linked_professionals, 0);

  const hashesBeforeRerun = (await pool.query(`
    SELECT id, password_hash, auth_version FROM ${table(mainSchema, "users")} ORDER BY id
  `)).rows;
  const rerun = await runLegacyAuthBackfill(pool, { apply: true, schemaName: mainSchema, now });
  assert.equal(rerun.summary.CREATED, 0);
  assert.equal(rerun.summary.LINKED_ADMINS, 0);
  assert.equal(rerun.summary.LINKED_PROFESSIONALS, 0);
  assert.equal(rerun.summary.ACCESS_SCOPES_CREATED, 0);
  assert.equal(rerun.summary.UNCHANGED, 4);
  assert.deepEqual((await pool.query(`
    SELECT id, password_hash, auth_version FROM ${table(mainSchema, "users")} ORDER BY id
  `)).rows, hashesBeforeRerun, "rerun must not change hashes or auth_version");

  const partialSchema = "auth_backfill_partial_fixture";
  await createLegacyFoundation(pool, partialSchema);
  await pool.query(`
    INSERT INTO ${table(partialSchema, "admins")} (username, email, password)
      VALUES ('partial@example.test', 'partial@example.test', '$2b$partial');
    INSERT INTO ${table(partialSchema, "barbers")} (name, specialty, email, password)
      VALUES ('Parcial', 'Corte', 'partial@example.test', '$2b$partial');
    INSERT INTO ${table(partialSchema, "barber_locations")} (barber_id, location_id) VALUES (1, 1);
  `);
  await applyFoundationMigration(pool, partialSchema, migrationsDirectory);
  const partialUser = await pool.query<{ id: number }>(`
    INSERT INTO ${table(partialSchema, "users")} (
      display_name, username, email, password_hash, status
    ) VALUES ('Parcial', 'partial@example.test', 'partial@example.test', '$2b$partial', 'active')
    RETURNING id
  `);
  const partialUserId = partialUser.rows[0].id;
  await pool.query(`UPDATE ${table(partialSchema, "admins")} SET user_id = $1 WHERE id = 1`, [partialUserId]);
  await pool.query(`INSERT INTO ${table(partialSchema, "user_access_scopes")} (user_id, preset_key)
    VALUES ($1, 'administrator')`, [partialUserId]);
  const partialResult = await runLegacyAuthBackfill(pool, { apply: true, schemaName: partialSchema, now });
  assert.equal(partialResult.summary.CREATED, 0);
  assert.equal(partialResult.summary.REUSED_USERS, 1);
  assert.equal(partialResult.summary.LINKED_ADMINS, 0);
  assert.equal(partialResult.summary.LINKED_PROFESSIONALS, 1);
  assert.equal(partialResult.summary.ACCESS_SCOPES_CREATED, 0);
  assert.equal((await pool.query(`SELECT user_id FROM ${table(partialSchema, "barbers")} WHERE id = 1`)).rows[0].user_id, partialUserId);

  const atomicSchema = "auth_backfill_atomic_fixture";
  await createLegacyFoundation(pool, atomicSchema);
  await pool.query(`
    INSERT INTO ${table(atomicSchema, "barbers")} (name, specialty, email, password) VALUES
      ('Falha', 'Corte', 'fail@example.test', '$2b$fail'),
      ('Continua', 'Corte', 'good@example.test', '$2b$good');
    INSERT INTO ${table(atomicSchema, "barber_locations")} (barber_id, location_id) VALUES (1, 1), (2, 1);
  `);
  await applyFoundationMigration(pool, atomicSchema, migrationsDirectory);
  await pool.query(`
    CREATE FUNCTION "${atomicSchema}".reject_fail_scope()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM "${atomicSchema}".users
        WHERE id = NEW.user_id AND email_key = 'fail@example.test'
      ) THEN
        RAISE EXCEPTION 'fixture rejects this scope' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER reject_fail_scope
      BEFORE INSERT ON ${table(atomicSchema, "user_access_scopes")}
      FOR EACH ROW EXECUTE FUNCTION "${atomicSchema}".reject_fail_scope();
  `);
  const atomicResult = await runLegacyAuthBackfill(pool, { apply: true, schemaName: atomicSchema, now });
  assert.equal(atomicResult.summary.FAILED, 1);
  assert.equal(atomicResult.summary.CREATED, 1);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table(atomicSchema, "users")}
    WHERE email_key = 'fail@example.test'`)).rows[0].count), 0,
  "a scope failure must roll back the entire failed identity");
  assert.equal((await pool.query(`SELECT user_id FROM ${table(atomicSchema, "barbers")} WHERE id = 1`)).rows[0].user_id, null);
  assert.ok((await pool.query(`SELECT user_id FROM ${table(atomicSchema, "barbers")} WHERE id = 2`)).rows[0].user_id !== null,
    "a later independent identity must still complete");

  const lockClient = await pool.connect();
  try {
    const acquired = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [legacyAuthBackfillLock.namespace, legacyAuthBackfillLock.key],
    );
    assert.equal(acquired.rows[0].locked, true);
    await assert.rejects(
      runLegacyAuthBackfill(pool, { schemaName: mainSchema, now }),
      (error: unknown) => error instanceof LegacyAuthBackfillLockedError,
      "a second backfill must fail immediately while the advisory lock is held",
    );
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [
      legacyAuthBackfillLock.namespace,
      legacyAuthBackfillLock.key,
    ]);
    lockClient.release();
  }

  console.log("PASS: controlled legacy auth backfill is dry-run by default, applies only SAFE_AUTO identities, is idempotent, atomic per identity and protected by a PostgreSQL advisory lock.");
} finally {
  if (pool) await pool.end();
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationsDirectory, { recursive: true, force: true });
}
