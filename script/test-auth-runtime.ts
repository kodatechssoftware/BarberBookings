import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import bcrypt from "bcryptjs";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  acceptLegacyProfessionalInviteCanonical,
  authenticateCanonicalUser,
  canUseLegacyAuthenticatedRoutes,
  loadCanonicalAuthContext,
  resetCanonicalPasswordForProfessional,
  toCanonicalMeResponse,
  validateCanonicalAuthFoundation,
  validateCanonicalSession,
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
    INSERT INTO ${table(schema, "locations")} (name) VALUES ('Principal');
  `);
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-runtime-pg-"));
const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-runtime-migration-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-runtime-test",
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
    connectionString: `postgresql://postgres:auth-runtime-test@127.0.0.1:${port}/postgres`,
    max: 4,
  });

  const schema = "auth_runtime_fixture";
  await createLegacyFoundation(pool, schema);
  await assert.rejects(
    validateCanonicalAuthFoundation(pool, { schemaName: schema }),
    /missing tables|migration 0015/i,
  );
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
  await validateCanonicalAuthFoundation(pool, { schemaName: schema });

  const passwordHash = await bcrypt.hash("Valid-password-2026", 4);
  await pool.query(`
    INSERT INTO ${table(schema, "admins")} (username, email, password)
    VALUES ('legacy-only', 'legacy-only@example.test', $1)
  `, [passwordHash]);
  await pool.query(`
    INSERT INTO ${table(schema, "barbers")} (name, specialty, email, password)
    VALUES ('Legacy Professional', 'Especialidade', 'legacy-pro@example.test', $1)
  `, [passwordHash]);
  const insertUser = async (values: {
    displayName: string; email: string; username?: string; status?: string; passwordHash?: string | null;
  }) => (await pool!.query<{ id: number }>(`
    INSERT INTO ${table(schema, "users")} (display_name, email, username, status, password_hash)
    VALUES ($1, $2, $3, $4, $5) RETURNING id
  `, [values.displayName, values.email, values.username ?? null, values.status ?? "active",
    values.passwordHash === undefined ? passwordHash : values.passwordHash])).rows[0].id;
  const addScope = async (userId: number, preset: "administrator" | "professional" | null, locationId: number | null = null) =>
    (await pool!.query<{ id: number }>(`
      INSERT INTO ${table(schema, "user_access_scopes")} (user_id, location_id, preset_key)
      VALUES ($1, $2, $3) RETURNING id
    `, [userId, locationId, preset])).rows[0].id;
  const addProfessional = async (userId: number, name: string) =>
    (await pool!.query<{ id: number }>(`
      INSERT INTO ${table(schema, "barbers")} (name, specialty, email, user_id)
      VALUES ($1, 'Especialidade', $2, $3) RETURNING id
    `, [name, `${name.toLowerCase().replaceAll(" ", ".")}@example.test`, userId])).rows[0].id;

  const adminId = await insertUser({ displayName: "Admin", email: "owner@example.test", username: "Owner" });
  await addScope(adminId, "administrator");
  const professionalUserId = await insertUser({ displayName: "Professional", email: "pro@example.test" });
  const professionalId = await addProfessional(professionalUserId, "Professional");
  await addScope(professionalUserId, "professional", 1);
  const brunoId = await insertUser({ displayName: "Bruno Santos", email: "bs881366@gmail.com" });
  const brunoProfessionalId = await addProfessional(brunoId, "Bruno Santos");
  await addScope(brunoId, "administrator");
  const operationalId = await insertUser({ displayName: "Reception", email: "reception@example.test" });
  const operationalScope = await addScope(operationalId, null, 1);
  await pool.query(`
    INSERT INTO ${table(schema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
    VALUES ($1, 'catalog.view')
  `, [operationalScope]);
  await insertUser({ displayName: "Invited", email: "invited@example.test", status: "invited", passwordHash: null });
  await insertUser({ displayName: "Disabled", email: "disabled@example.test", status: "disabled" });

  const adminLogin = await authenticateCanonicalUser(pool, " OWNER ", "Valid-password-2026", { schemaName: schema });
  assert(adminLogin);
  assert.equal(adminLogin.context.isGlobalAdministrator, true);
  assert.equal(adminLogin.context.professionalId, null);
  assert(adminLogin.context.lastLoginAt instanceof Date);
  assert.equal(adminLogin.context.authVersion, 1, "last_login_at must not revoke sessions");
  assert(await validateCanonicalSession(pool, adminLogin.identity, { schemaName: schema }));
  assert.equal(await validateCanonicalSession(pool, { ...adminLogin.identity, authVersion: 2 }, { schemaName: schema }), null);

  const professionalLogin = await authenticateCanonicalUser(pool, "PRO@EXAMPLE.TEST", "Valid-password-2026", { schemaName: schema });
  assert.equal(professionalLogin?.context.professionalId, professionalId);
  assert.equal(professionalLogin?.context.isGlobalAdministrator, false);
  assert.equal(professionalLogin?.context.access.globalCapabilities.length, 0);
  assert(professionalLogin?.context.access.locationCapabilities[0].capabilities.includes("appointments.create_manual"));

  const bruno = await loadCanonicalAuthContext(pool, brunoId, { schemaName: schema });
  assert.equal(bruno?.professionalId, brunoProfessionalId);
  assert.equal(bruno?.isGlobalAdministrator, true, "one canonical user can be both administrator and professional");
  const brunoLogin = await authenticateCanonicalUser(
    pool,
    "BS881366@GMAIL.COM",
    "Valid-password-2026",
    { schemaName: schema },
  );
  assert.equal(brunoLogin?.identity.userId, brunoId);
  assert.equal(brunoLogin?.context.professionalId, brunoProfessionalId);
  assert.equal(brunoLogin?.context.isGlobalAdministrator, true);
  const operational = await loadCanonicalAuthContext(pool, operationalId, { schemaName: schema });
  assert.equal(operational?.professionalId, null);
  assert.equal(operational?.isGlobalAdministrator, false);
  assert.equal(operational?.hasProfessionalAccessPreset, false);
  assert.equal(canUseLegacyAuthenticatedRoutes(operational!), false);
  assert(operational?.access.locationCapabilities[0].capabilities.includes("catalog.view"));
  const operationalLogin = await authenticateCanonicalUser(
    pool,
    "reception@example.test",
    "Valid-password-2026",
    { schemaName: schema },
  );
  assert(operationalLogin);
  assert.equal(toCanonicalMeResponse(operationalLogin.context).role, "user");

  for (const login of ["missing@example.test", "invited@example.test", "disabled@example.test"]) {
    assert.equal(await authenticateCanonicalUser(pool, login, "Valid-password-2026", { schemaName: schema }), null);
  }
  assert.equal(await authenticateCanonicalUser(pool, "owner", "wrong-password", { schemaName: schema }), null);
  assert.equal(
    await authenticateCanonicalUser(pool, "legacy-only", "Valid-password-2026", { schemaName: schema }),
    null,
    "canonical mode must not fall back to admins",
  );
  assert.equal(
    await authenticateCanonicalUser(pool, "legacy-pro@example.test", "Valid-password-2026", { schemaName: schema }),
    null,
    "canonical mode must not fall back to barbers.password",
  );

  const collisionA = await insertUser({ displayName: "Collision A", email: "collision@example.test", username: "collision-a" });
  const collisionB = await insertUser({ displayName: "Collision B", email: "collision-b@example.test", username: "collision@example.test" });
  await addScope(collisionA, "professional", 1);
  await addScope(collisionB, "professional", 1);
  assert.equal(
    await authenticateCanonicalUser(pool, "collision@example.test", "Valid-password-2026", { schemaName: schema }),
    null,
    "ambiguous normalized identities must not authenticate",
  );

  const safeDto = toCanonicalMeResponse(bruno!);
  const serializedDto = JSON.stringify(safeDto);
  assert.equal(safeDto.role, "admin");
  assert.equal(safeDto.professionalId, brunoProfessionalId);
  assert(!serializedDto.includes("password"));
  assert(!serializedDto.includes("authVersion"));
  assert(!serializedDto.includes("legacyAdminId"));
  assert(!serializedDto.includes("hasProfessionalAccessPreset"));

  const unprivilegedProfessionalId = await insertUser({
    displayName: "Profile without access",
    email: "profile-no-access@example.test",
  });
  await addProfessional(unprivilegedProfessionalId, "Profile without access");
  const unprivilegedProfessional = await loadCanonicalAuthContext(pool, unprivilegedProfessionalId, { schemaName: schema });
  assert.equal(unprivilegedProfessional?.professionalId !== null, true);
  assert.equal(unprivilegedProfessional?.hasProfessionalAccessPreset, false);
  assert.equal(unprivilegedProfessional?.access.globalCapabilities.length, 0);
  assert.equal(unprivilegedProfessional?.access.locationCapabilities.length, 0);
  assert.equal(canUseLegacyAuthenticatedRoutes(unprivilegedProfessional!), false);
  assert.equal(toCanonicalMeResponse(unprivilegedProfessional!).role, "user");

  const beforeReset = await loadCanonicalAuthContext(pool, professionalUserId, { schemaName: schema });
  assert(beforeReset);
  const reset = await resetCanonicalPasswordForProfessional(pool, professionalId, { schemaName: schema });
  assert.equal(reset?.auth_version, beforeReset.authVersion + 1);
  assert.equal(await validateCanonicalSession(pool, {
    userId: professionalUserId,
    authVersion: beforeReset.authVersion,
  }, { schemaName: schema }), null);
  assert.equal(await authenticateCanonicalUser(pool, "pro@example.test", "Valid-password-2026", { schemaName: schema }), null);

  const inviteId = (await pool.query<{ id: number }>(`
    INSERT INTO ${table(schema, "barber_invites")} (barber_id, token, expires_at)
    VALUES ($1, 'canonical-invite', now() + interval '1 day') RETURNING id
  `, [professionalId])).rows[0].id;
  const replacementHash = await bcrypt.hash("Replacement-password-2026", 4);
  const replacementIdentity = await acceptLegacyProfessionalInviteCanonical(
    pool, inviteId, professionalId, replacementHash, { schemaName: schema },
  );
  assert(replacementIdentity);
  assert.equal(replacementIdentity.authVersion, beforeReset.authVersion + 2);
  assert(await authenticateCanonicalUser(pool, "pro@example.test", "Replacement-password-2026", { schemaName: schema }));
  assert.equal(
    await acceptLegacyProfessionalInviteCanonical(pool, inviteId, professionalId, replacementHash, { schemaName: schema }),
    null,
    "legacy invite remains single-use in canonical mode",
  );

  const legacyPasswords = await pool.query<{ password: string | null }>(`
    SELECT password FROM ${table(schema, "barbers")} WHERE id = $1
  `, [professionalId]);
  assert.equal(legacyPasswords.rows[0].password, null, "canonical password changes never write barbers.password");

  await assert.rejects(pool.query(`SELECT * FROM ${table(schema, "definitely_missing")}`));
  console.log("Canonical auth runtime PostgreSQL checks passed.");
} finally {
  await pool?.end().catch(() => undefined);
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationsDirectory, { recursive: true, force: true });
}
