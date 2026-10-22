import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import bcrypt from "bcryptjs";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  acceptCanonicalUserInvite,
  CanonicalUserManagementError,
  changeCanonicalPassword,
  createOrReplaceCanonicalProfessionalInvite,
  createCanonicalInvitedUser,
  getCanonicalUser,
  getCanonicalUserAccess,
  inspectCanonicalUserInvite,
  listCanonicalUsers,
  replaceCanonicalUserAccess,
  replaceCanonicalUserInvite,
  revokeCanonicalUserInvites,
  revokeCanonicalUserSessions,
  setCanonicalProfessionalLink,
  setCanonicalUserStatus,
  updateCanonicalUserIdentity,
} from "../server/auth-user-management";
import {
  loadCanonicalAuthContext,
  validateCanonicalSession,
  type CanonicalAuthContext,
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
    CREATE TABLE ${table(schema, "barber_locations")} (
      barber_id integer NOT NULL REFERENCES ${table(schema, "barbers")}(id),
      location_id integer NOT NULL REFERENCES ${table(schema, "locations")}(id),
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
    INSERT INTO ${table(schema, "locations")} (name) VALUES ('Loja A'), ('Loja B');
  `);
}

function expectManagementCode(code: string) {
  return (error: unknown) => {
    assert(error instanceof CanonicalUserManagementError);
    assert.equal(error.code, code);
    return true;
  };
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-management-pg-"));
const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-auth-management-migration-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "auth-management-test",
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
    connectionString: `postgresql://postgres:auth-management-test@127.0.0.1:${port}/postgres`,
    max: 6,
  });

  const schema = "auth_management_fixture";
  const options = { schemaName: schema };
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

  const legacyHash = await bcrypt.hash("Legacy-password-2026", 4);
  await pool.query(`
    INSERT INTO ${table(schema, "admins")} (username, email, password)
    VALUES ('legacy-admin', 'legacy-admin@example.test', $1)
  `, [legacyHash]);
  const professionalIds = (await pool.query<{ id: number }>(`
    INSERT INTO ${table(schema, "barbers")} (name, specialty, email, password) VALUES
      ('Profissional Um', 'Especialidade', 'pro1@example.test', $1),
      ('Bruno Santos', 'Especialidade', 'bs881366@gmail.com', $1),
      ('Profissional Livre', 'Especialidade', 'free@example.test', NULL),
      ('Outro Profissional Livre', 'Especialidade', 'other-free@example.test', NULL),
      ('Profissional para Convite Canónico', 'Especialidade', 'canonical-invite@example.test', NULL),
      ('Profissional para Convite Concorrente', 'Especialidade', 'canonical-concurrent@example.test', NULL)
    RETURNING id
  `, [legacyHash])).rows.map((row) => Number(row.id));
  await pool.query(`
    INSERT INTO ${table(schema, "barber_locations")} (barber_id, location_id)
    SELECT id, 1 FROM ${table(schema, "barbers")}
  `);

  const rootPassword = "Root-password-2026";
  const rootHash = await bcrypt.hash(rootPassword, 4);
  const rootId = (await pool.query<{ id: number }>(`
    INSERT INTO ${table(schema, "users")} (display_name, email, password_hash, status)
    VALUES ('Root Administrator', 'root@example.test', $1, 'active') RETURNING id
  `, [rootHash])).rows[0].id;
  await pool.query(`
    INSERT INTO ${table(schema, "user_access_scopes")} (user_id, location_id, preset_key)
    VALUES ($1, NULL, 'administrator')
  `, [rootId]);
  const root = await loadCanonicalAuthContext(pool, rootId, options);
  assert(root?.isGlobalAdministrator);

  const create = (actor: CanonicalAuthContext, input: Parameters<typeof createCanonicalInvitedUser>[2]) =>
    createCanonicalInvitedUser(pool!, actor, input, options);
  const accept = (token: string, password: string, now?: Date) =>
    acceptCanonicalUserInvite(pool!, token, password, { ...options, ...(now ? { now } : {}) });

  const administrator = await create(root, {
    displayName: "Admin sem profissional",
    email: "admin-only@example.test",
    access: [{ kind: "global", preset: "administrator", capabilities: [] }],
  });
  assert.equal(administrator.user.status, "invited");
  assert.equal(administrator.user.professionalId, null);
  const administratorIdentity = await accept(administrator.invite.token, "Admin-password-2026");
  const administratorContext = await loadCanonicalAuthContext(pool, administrator.user.id, options);
  assert(administratorContext?.isGlobalAdministrator);
  assert.equal(administratorContext.professionalId, null);
  await assert.rejects(
    accept(administrator.invite.token, "Admin-password-2026"),
    expectManagementCode("INVITE_USED"),
  );
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM ${table(schema, "admins")}`)).rows[0].count, 1);

  const clockSkewed = await create(root, {
    displayName: "Convite com relógio divergente",
    email: "clock-skew@example.test",
    access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
  });
  const clockSkewCreatedAt = (await pool.query<{ created_at: Date }>(`
    SELECT created_at FROM ${table(schema, "user_invites")} WHERE user_id = $1
  `, [clockSkewed.user.id])).rows[0].created_at;
  await new Promise((resolve) => setTimeout(resolve, 25));
  await accept(
    clockSkewed.invite.token,
    "Clock-skew-password-2026",
    new Date(clockSkewCreatedAt.getTime() - 60_000),
  );
  const clockSkewAccepted = (await pool.query<{ created_at: Date; accepted_at: Date; updated_at: Date }>(`
    SELECT invite.created_at, invite.accepted_at, canonical_user.updated_at
    FROM ${table(schema, "user_invites")} invite
    INNER JOIN ${table(schema, "users")} canonical_user ON canonical_user.id = invite.user_id
    WHERE invite.user_id = $1
  `, [clockSkewed.user.id])).rows[0];
  assert(clockSkewAccepted.accepted_at.getTime() >= clockSkewAccepted.created_at.getTime());
  assert.equal(clockSkewAccepted.updated_at.getTime(), clockSkewAccepted.accepted_at.getTime());
  await assert.rejects(
    accept(clockSkewed.invite.token, "Clock-skew-password-2026"),
    expectManagementCode("INVITE_USED"),
  );

  await assert.rejects(create(root, {
    displayName: "Duplicado",
    email: "ADMIN-ONLY@EXAMPLE.TEST",
    access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
  }), expectManagementCode("DUPLICATE_LOGIN"));

  const concurrentIdentityCreation = await Promise.allSettled([
    create(root, {
      displayName: "Concorrente A",
      email: "concurrent@example.test",
      access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
    }),
    create(root, {
      displayName: "Concorrente B",
      email: " CONCURRENT@example.test ",
      access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
    }),
  ]);
  assert.equal(concurrentIdentityCreation.filter((result) => result.status === "fulfilled").length, 1);
  const duplicateCreation = concurrentIdentityCreation.find((result) => result.status === "rejected");
  assert(duplicateCreation?.status === "rejected");
  assert(expectManagementCode("DUPLICATE_LOGIN")(duplicateCreation.reason));

  const invitedOnly = await create(root, {
    displayName: "Convite expirado",
    email: "expired@example.test",
    access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
    inviteExpiresInHours: 1,
  });
  await assert.rejects(
    accept(invitedOnly.invite.token, "Expired-password-2026", new Date(invitedOnly.invite.expiresAt.getTime() + 1)),
    expectManagementCode("INVITE_EXPIRED"),
  );
  await assert.rejects(
    setCanonicalUserStatus(pool, root, invitedOnly.user.id, "active", options),
    expectManagementCode("INVITE_REQUIRED"),
  );
  await assert.rejects(
    setCanonicalUserStatus(pool, root, invitedOnly.user.id, "disabled", options),
    expectManagementCode("INVITE_REQUIRED"),
  );

  const revokedInviteUser = await create(root, {
    displayName: "Convite revogado",
    email: "revoked@example.test",
    access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
  });
  assert.equal(await revokeCanonicalUserInvites(pool, root, revokedInviteUser.user.id, options), 1);
  await assert.rejects(
    accept(revokedInviteUser.invite.token, "Revoked-password-2026"),
    expectManagementCode("INVITE_REVOKED"),
  );
  const replacement = await replaceCanonicalUserInvite(pool, root, revokedInviteUser.user.id, 24, options);
  const replacementAgain = await replaceCanonicalUserInvite(pool, root, revokedInviteUser.user.id, 24, options);
  await assert.rejects(accept(replacement.token, "Replacement-password-2026"), expectManagementCode("INVITE_REVOKED"));
  await accept(replacementAgain.token, "Replacement-password-2026");

  const professionalInvite = await createOrReplaceCanonicalProfessionalInvite(
    pool,
    root,
    professionalIds[4],
    1,
    24,
    options,
  );
  assert.equal(professionalInvite.createdUser, true);
  assert.equal(professionalInvite.user.status, "invited");
  assert.equal(professionalInvite.user.professionalId, professionalIds[4]);
  assert.deepEqual(professionalInvite.user.access, [{
    kind: "location",
    locationId: 1,
    preset: "professional",
    capabilities: [],
  }]);
  await assert.rejects(
    createOrReplaceCanonicalProfessionalInvite(pool, root, professionalIds[4], 2, 24, options),
    expectManagementCode("PROFESSIONAL_LOCATION_REQUIRED"),
  );
  assert.deepEqual(await inspectCanonicalUserInvite(pool, professionalInvite.invite.token, options), {
    state: "valid",
    expiresAt: professionalInvite.invite.expiresAt,
  });
  const replacementProfessionalInvite = await createOrReplaceCanonicalProfessionalInvite(
    pool,
    root,
    professionalIds[4],
    1,
    24,
    options,
  );
  assert.equal(replacementProfessionalInvite.createdUser, false);
  assert.equal(replacementProfessionalInvite.user.id, professionalInvite.user.id);
  assert.equal((await inspectCanonicalUserInvite(pool, professionalInvite.invite.token, options)).state, "revoked");
  assert.equal((await inspectCanonicalUserInvite(pool, replacementProfessionalInvite.invite.token, options)).state, "valid");
  const professionalInviteIdentity = await accept(
    replacementProfessionalInvite.invite.token,
    "Canonical-professional-password-2026",
  );
  assert.equal(professionalInviteIdentity.userId, professionalInvite.user.id);
  assert.equal((await inspectCanonicalUserInvite(pool, replacementProfessionalInvite.invite.token, options)).state, "used");
  await assert.rejects(
    accept(replacementProfessionalInvite.invite.token, "Canonical-professional-password-2026"),
    expectManagementCode("INVITE_USED"),
  );
  await assert.rejects(
    createOrReplaceCanonicalProfessionalInvite(pool, root, professionalIds[4], 1, 24, options),
    expectManagementCode("USER_ALREADY_ACTIVE"),
  );
  const canonicalProfessionalRows = await pool.query<{
    user_count: number;
    professional_links: number;
    scope_count: number;
    legacy_invite_count: number;
    password_configured: boolean;
    status: string;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM ${table(schema, "users")} WHERE email_key = 'canonical-invite@example.test') AS user_count,
      (SELECT count(*)::integer FROM ${table(schema, "barbers")} WHERE id = $1 AND user_id = $2) AS professional_links,
      (SELECT count(*)::integer FROM ${table(schema, "user_access_scopes")}
        WHERE user_id = $2 AND location_id = 1 AND preset_key = 'professional') AS scope_count,
      (SELECT count(*)::integer FROM ${table(schema, "barber_invites")} WHERE barber_id = $1) AS legacy_invite_count,
      (SELECT password_hash IS NOT NULL AND btrim(password_hash) <> '' FROM ${table(schema, "users")} WHERE id = $2) AS password_configured,
      (SELECT status FROM ${table(schema, "users")} WHERE id = $2) AS status
  `, [professionalIds[4], professionalInvite.user.id]);
  assert.deepEqual(canonicalProfessionalRows.rows[0], {
    user_count: 1,
    professional_links: 1,
    scope_count: 1,
    legacy_invite_count: 0,
    password_configured: true,
    status: "active",
  });

  const concurrentProfessionalInvites = await Promise.all([
    createOrReplaceCanonicalProfessionalInvite(pool, root, professionalIds[5], 1, 24, options),
    createOrReplaceCanonicalProfessionalInvite(pool, root, professionalIds[5], 1, 24, options),
  ]);
  assert.equal(concurrentProfessionalInvites[0].user.id, concurrentProfessionalInvites[1].user.id);
  const concurrentProfessionalRows = await pool.query<{
    user_count: number;
    professional_links: number;
    active_invite_count: number;
    legacy_invite_count: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM ${table(schema, "users")} WHERE email_key = 'canonical-concurrent@example.test') AS user_count,
      (SELECT count(*)::integer FROM ${table(schema, "barbers")} WHERE id = $1 AND user_id = $2) AS professional_links,
      (SELECT count(*)::integer FROM ${table(schema, "user_invites")}
        WHERE user_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL) AS active_invite_count,
      (SELECT count(*)::integer FROM ${table(schema, "barber_invites")} WHERE barber_id = $1) AS legacy_invite_count
  `, [professionalIds[5], concurrentProfessionalInvites[0].user.id]);
  assert.deepEqual(concurrentProfessionalRows.rows[0], {
    user_count: 1,
    professional_links: 1,
    active_invite_count: 1,
    legacy_invite_count: 0,
  });

  const professional = await create(root, {
    displayName: "Profissional Um",
    email: "professional-user@example.test",
    professionalId: professionalIds[0],
    access: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
  });
  const professionalIdentity = await accept(professional.invite.token, "Professional-password-2026");
  const professionalContext = await loadCanonicalAuthContext(pool, professional.user.id, options);
  assert.equal(professionalContext?.professionalId, professionalIds[0]);
  assert.equal(professionalContext?.hasProfessionalAccessPreset, true);
  assert(professionalContext?.access.locationCapabilities[0].capabilities.includes("appointments.create_manual"));
  assert(!professionalContext?.access.locationCapabilities[0].capabilities.includes("team.manage_global"));
  assert(!professionalContext?.access.locationCapabilities[0].capabilities.includes("extras.manage"));

  const identityOnly = await create(root, {
    displayName: "Identidade associada sem acesso",
    email: "identity-only@example.test",
    access: [{ kind: "location", locationId: 1, capabilities: ["catalog.view"] }],
  });
  await replaceCanonicalUserAccess(pool, root, identityOnly.user.id, { mode: "replace_all", scopes: [] }, options);
  await setCanonicalProfessionalLink(pool, root, identityOnly.user.id, professionalIds[2], options);
  const identityOnlyContext = await loadCanonicalAuthContext(pool, identityOnly.user.id, { ...options, requireActive: false });
  assert.equal(identityOnlyContext?.professionalId, professionalIds[2]);
  assert.equal(identityOnlyContext?.access.globalCapabilities.length, 0);
  assert.equal(identityOnlyContext?.access.locationCapabilities.length, 0);
  await setCanonicalProfessionalLink(pool, root, identityOnly.user.id, null, options);
  assert.equal((await loadCanonicalAuthContext(pool, identityOnly.user.id, {
    ...options,
    requireActive: false,
  }))?.professionalId, null);
  await setCanonicalProfessionalLink(pool, root, identityOnly.user.id, professionalIds[2], options);
  await assert.rejects(
    setCanonicalProfessionalLink(pool, root, administrator.user.id, professionalIds[2], options),
    expectManagementCode("PROFESSIONAL_ALREADY_LINKED"),
  );
  await assert.rejects(
    setCanonicalProfessionalLink(pool, root, identityOnly.user.id, professionalIds[3], options),
    expectManagementCode("USER_ALREADY_LINKED"),
  );

  const bruno = await create(root, {
    displayName: "Bruno Santos",
    email: "bs881366@gmail.com",
    professionalId: professionalIds[1],
    access: [{ kind: "global", preset: "administrator", capabilities: [] }],
  });
  await accept(bruno.invite.token, "Bruno-password-2026");
  let brunoContext = await loadCanonicalAuthContext(pool, bruno.user.id, options);
  assert.equal(brunoContext?.professionalId, professionalIds[1]);
  assert.equal(brunoContext?.isGlobalAdministrator, true);
  const brunoIdentityCount = await pool.query<{ user_count: number; professional_count: number }>(`
    SELECT
      (SELECT count(*)::integer FROM ${table(schema, "users")} WHERE email_key = 'bs881366@gmail.com') AS user_count,
      (SELECT count(*)::integer FROM ${table(schema, "barbers")} WHERE user_id = $1) AS professional_count
  `, [bruno.user.id]);
  assert.deepEqual(brunoIdentityCount.rows[0], { user_count: 1, professional_count: 1 });
  await replaceCanonicalUserAccess(pool, root, bruno.user.id, {
    mode: "replace_all",
    scopes: [{ kind: "location", locationId: 1, preset: "professional", capabilities: [] }],
  }, options);
  brunoContext = await loadCanonicalAuthContext(pool, bruno.user.id, options);
  assert.equal(brunoContext?.professionalId, professionalIds[1]);
  assert.equal(brunoContext?.isGlobalAdministrator, false);
  assert.equal(brunoContext?.hasProfessionalAccessPreset, true);
  assert.equal(brunoContext?.access.globalCapabilities.includes("users.manage"), false);
  assert(brunoContext?.access.locationCapabilities[0].capabilities.includes("appointments.create_manual"));

  const custom = await create(root, {
    displayName: "Acesso custom",
    email: "custom@example.test",
    access: [
      { kind: "location", locationId: 1, capabilities: ["catalog.view"] },
      { kind: "location", locationId: 2, capabilities: ["appointments.create_manual"] },
    ],
  });
  await accept(custom.invite.token, "Custom-password-2026");
  const customAccess = await getCanonicalUserAccess(pool, custom.user.id, options);
  assert.equal(customAccess.length, 2);
  assert.equal((await getCanonicalUser(pool, custom.user.id, options)).professionalId, null);
  assert((await listCanonicalUsers(pool, options)).some((user) => user.id === custom.user.id));

  const localManager = await create(root, {
    displayName: "Gestor de acesso local",
    email: "local-access@example.test",
    access: [{
      kind: "location",
      locationId: 1,
      capabilities: ["access.manage", "catalog.view"],
    }],
  });
  await accept(localManager.invite.token, "Local-access-password-2026");
  const localManagerContext = await loadCanonicalAuthContext(pool, localManager.user.id, options);
  assert(localManagerContext);
  await assert.rejects(replaceCanonicalUserAccess(pool, localManagerContext, custom.user.id, {
    mode: "replace_location",
    locationId: 2,
    scopes: [{ kind: "location", locationId: 2, capabilities: ["appointments.create_manual"] }],
  }, options), expectManagementCode("ACCESS_FORBIDDEN"));
  await assert.rejects(replaceCanonicalUserAccess(pool, localManagerContext, custom.user.id, {
    mode: "replace_location",
    locationId: 1,
    scopes: [{ kind: "location", locationId: 1, capabilities: ["finance.view_team"] }],
  }, options), expectManagementCode("GRANT_CEILING"));
  await assert.rejects(replaceCanonicalUserAccess(pool, professionalContext!, custom.user.id, {
    mode: "replace_location",
    locationId: 1,
    scopes: [{ kind: "location", locationId: 1, capabilities: ["catalog.view"] }],
  }, options), expectManagementCode("ACCESS_FORBIDDEN"));
  await replaceCanonicalUserAccess(pool, localManagerContext, custom.user.id, {
    mode: "replace_location",
    locationId: 1,
    scopes: [{ kind: "location", locationId: 1, capabilities: ["catalog.view"] }],
  }, options);
  const locationScopedResult = await getCanonicalUserAccess(pool, custom.user.id, {
    ...options,
    locationId: 2,
  });
  assert.equal(locationScopedResult.length, 1);
  assert.deepEqual(locationScopedResult[0].capabilities, ["appointments.create_manual"]);

  const customBeforeDisable = await loadCanonicalAuthContext(pool, custom.user.id, options);
  assert(customBeforeDisable);
  await setCanonicalUserStatus(pool, root, custom.user.id, "disabled", options);
  assert.equal(await validateCanonicalSession(pool, {
    userId: custom.user.id,
    authVersion: customBeforeDisable.authVersion,
  }, options), null);
  await setCanonicalUserStatus(pool, root, custom.user.id, "active", options);
  const customReactivated = await loadCanonicalAuthContext(pool, custom.user.id, options);
  assert(customReactivated);
  assert.equal(customReactivated.access.locationCapabilities.length, 2);

  const noRestore = await create(root, {
    displayName: "Reativação sem restauração",
    email: "no-restore@example.test",
    access: [{ kind: "location", locationId: 1, capabilities: ["catalog.view"] }],
  });
  await accept(noRestore.invite.token, "No-restore-password-2026");
  await replaceCanonicalUserAccess(pool, root, noRestore.user.id, {
    mode: "replace_all",
    scopes: [],
  }, options);
  await setCanonicalUserStatus(pool, root, noRestore.user.id, "disabled", options);
  await setCanonicalUserStatus(pool, root, noRestore.user.id, "active", options);
  const noRestoreContext = await loadCanonicalAuthContext(pool, noRestore.user.id, options);
  assert.equal(noRestoreContext?.access.globalCapabilities.length, 0);
  assert.equal(noRestoreContext?.access.locationCapabilities.length, 0);

  await updateCanonicalUserIdentity(pool, root, custom.user.id, {
    displayName: "Acesso custom atualizado",
    email: "custom-updated@example.test",
  }, options);
  assert.equal(await validateCanonicalSession(pool, {
    userId: custom.user.id,
    authVersion: customReactivated.authVersion,
  }, options), null);
  await assert.rejects(updateCanonicalUserIdentity(pool, root, custom.user.id, {
    email: "ADMIN-ONLY@example.test",
  }, options), expectManagementCode("DUPLICATE_LOGIN"));

  const beforeRevoke = await loadCanonicalAuthContext(pool, custom.user.id, options);
  assert(beforeRevoke);
  await revokeCanonicalUserSessions(pool, root, custom.user.id, options);
  assert.equal(await validateCanonicalSession(pool, {
    userId: custom.user.id,
    authVersion: beforeRevoke.authVersion,
  }, options), null);

  const passwordContext = await loadCanonicalAuthContext(pool, custom.user.id, options);
  assert(passwordContext);
  await changeCanonicalPassword(
    pool,
    passwordContext,
    "Custom-password-2026",
    "Custom-new-password-2026",
    options,
  );
  assert.equal(await validateCanonicalSession(pool, {
    userId: custom.user.id,
    authVersion: passwordContext.authVersion,
  }, options), null);
  await assert.rejects(
    changeCanonicalPassword(pool, passwordContext, "wrong", "Another-password-2026", options),
    expectManagementCode("PASSWORD_INVALID"),
  );

  await assert.rejects(
    setCanonicalUserStatus(pool, root, root.user.id, "disabled", options),
    expectManagementCode("SELF_LOCKOUT"),
  );
  await assert.rejects(replaceCanonicalUserAccess(pool, root, root.user.id, {
    mode: "replace_all",
    scopes: [],
  }, options), expectManagementCode("SELF_LOCKOUT"));

  const accessOperator = await create(root, {
    displayName: "Operador de identidades",
    email: "identity-manager@example.test",
    access: [{ kind: "global", capabilities: ["users.manage", "access.manage"] }],
  });
  await accept(accessOperator.invite.token, "Identity-manager-password-2026");
  const accessOperatorContext = await loadCanonicalAuthContext(pool, accessOperator.user.id, options);
  assert(accessOperatorContext);
  await assert.rejects(create(accessOperatorContext, {
    displayName: "Escalada bloqueada",
    email: "escalation@example.test",
    access: [{ kind: "global", preset: "administrator", capabilities: [] }],
  }), expectManagementCode("GRANT_CEILING"));

  await replaceCanonicalUserAccess(pool, root, administrator.user.id, {
    mode: "replace_all",
    scopes: [],
  }, options);
  await assert.rejects(
    setCanonicalUserStatus(pool, accessOperatorContext, root.user.id, "disabled", options),
    expectManagementCode("LAST_GLOBAL_ADMINISTRATOR"),
  );
  await assert.rejects(replaceCanonicalUserAccess(pool, accessOperatorContext, root.user.id, {
    mode: "replace_all",
    scopes: [],
  }, options), expectManagementCode("LAST_GLOBAL_ADMINISTRATOR"));

  await replaceCanonicalUserAccess(pool, root, administrator.user.id, {
    mode: "replace_all",
    scopes: [{ kind: "global", preset: "administrator", capabilities: [] }],
  }, options);
  const concurrent = await Promise.allSettled([
    setCanonicalUserStatus(pool, accessOperatorContext, root.user.id, "disabled", options),
    setCanonicalUserStatus(pool, accessOperatorContext, administrator.user.id, "disabled", options),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const activeAdministrators = await pool.query<{ id: number }>(`
    SELECT canonical_user.id
    FROM ${table(schema, "users")} canonical_user
    JOIN ${table(schema, "user_access_scopes")} scope ON scope.user_id = canonical_user.id
    WHERE canonical_user.status = 'active'
      AND scope.location_id IS NULL
      AND scope.preset_key = 'administrator'
  `);
  assert.equal(activeAdministrators.rows.length, 1);
  const disabledAdministratorId = root.user.id === activeAdministrators.rows[0].id
    ? administrator.user.id
    : root.user.id;
  await setCanonicalUserStatus(pool, accessOperatorContext, disabledAdministratorId, "active", options);

  const legacyRows = await pool.query<{ admin_password: string; professional_password: string | null }>(`
    SELECT admin.password AS admin_password, professional.password AS professional_password
    FROM ${table(schema, "admins")} admin
    CROSS JOIN ${table(schema, "barbers")} professional
    WHERE admin.username = 'legacy-admin' AND professional.id = $1
  `, [professionalIds[0]]);
  assert.equal(legacyRows.rows[0].admin_password, legacyHash);
  assert.equal(legacyRows.rows[0].professional_password, legacyHash);

  const audits = await pool.query<{
    actor_user_id: number | null;
    entity_id: number | null;
    metadata: string | null;
    summary: string;
  }>(`
    SELECT actor_user_id, entity_id, metadata, summary
    FROM ${table(schema, "audit_logs")}
    WHERE entity_type = 'user'
  `);
  assert(audits.rows.length > 10);
  assert(audits.rows.every((row) => row.actor_user_id !== null && row.entity_id !== null));
  const serializedAudits = JSON.stringify(audits.rows);
  for (const secret of [
    rootHash,
    legacyHash,
    administrator.invite.token,
    replacementAgain.token,
    "Custom-new-password-2026",
  ]) assert(!serializedAudits.includes(secret));

  assert(await validateCanonicalSession(pool, administratorIdentity, options) === null,
    "access/status mutations must invalidate the former administrator session");
  assert(await validateCanonicalSession(pool, professionalIdentity, options));
  console.log("Canonical user and access management PostgreSQL checks passed.");
} finally {
  await pool?.end().catch(() => undefined);
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(migrationsDirectory, { recursive: true, force: true });
}
