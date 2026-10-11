import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  hasCapability,
  hasCapabilityAtLocation,
  resolveEffectiveAccess,
  resolvePresetCapabilities,
  type AccessScope,
  type CanonicalAccessReplaceInput,
  type CanonicalUserCreateInput,
  type CanonicalUserIdentityUpdateInput,
  type CapabilityCode,
} from "@shared/auth";
import type { CanonicalAuthContext, CanonicalSessionIdentity } from "./auth-runtime";
import { serializeSafeAuditMetadata } from "./audit-log-security";

export class CanonicalUserManagementError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalUserManagementError";
  }
}

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type ManagedUserRow = QueryResultRow & {
  id: number;
  display_name: string;
  username: string | null;
  email: string;
  status: "invited" | "active" | "disabled";
  auth_version: number;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  professional_id: number | null;
};

type ScopeRow = QueryResultRow & {
  id: number;
  user_id: number;
  location_id: number | null;
  preset_key: "administrator" | "professional" | null;
  capability_code: CapabilityCode | null;
};

type AuditActor = {
  user: {
    id: number;
    displayName: string | null;
    email: string;
  };
  professionalId: number | null;
};

export type CanonicalManagedUser = {
  id: number;
  displayName: string;
  username: string | null;
  email: string;
  status: ManagedUserRow["status"];
  authVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  professionalId: number | null;
};

export type CanonicalInviteSecret = {
  token: string;
  expiresAt: Date;
};

export type CanonicalInviteState = "valid" | "used" | "revoked" | "expired" | "invalid";

export type CanonicalInviteInspection = {
  state: CanonicalInviteState;
  expiresAt: Date | null;
};

const LAST_ADMIN_LOCK_NAMESPACE = 915_001;
const LAST_ADMIN_LOCK_KEY = 1;
const LOGIN_IDENTITY_LOCK_NAMESPACE = 915_002;

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function resolveSchemaName(value?: string) {
  return value?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
}

function table(schema: string, name: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function inviteDigest(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function managedUser(row: ManagedUserRow): CanonicalManagedUser {
  return {
    id: Number(row.id),
    displayName: row.display_name,
    username: row.username,
    email: row.email,
    status: row.status,
    authVersion: Number(row.auth_version),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    professionalId: row.professional_id === null ? null : Number(row.professional_id),
  };
}

async function transaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function lockLastAdministratorInvariant(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    LAST_ADMIN_LOCK_NAMESPACE,
    LAST_ADMIN_LOCK_KEY,
  ]);
}

async function lockLoginIdentity(client: PoolClient, normalizedLogin: string) {
  await client.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [
    LOGIN_IDENTITY_LOCK_NAMESPACE,
    normalizedLogin,
  ]);
}

async function assertGlobalAdministratorRemains(client: PoolClient, schema: string) {
  const result = await client.query<{ count: string }>(`
    SELECT count(DISTINCT canonical_user.id)::text AS count
    FROM ${table(schema, "users")} canonical_user
    INNER JOIN ${table(schema, "user_access_scopes")} scope
      ON scope.user_id = canonical_user.id
    WHERE canonical_user.status = 'active'
      AND scope.location_id IS NULL
      AND scope.preset_key = 'administrator'
  `);
  if (Number(result.rows[0]?.count ?? 0) < 1) {
    throw new CanonicalUserManagementError(
      "LAST_GLOBAL_ADMINISTRATOR",
      409,
      "A instalação tem de manter pelo menos um administrador global ativo.",
    );
  }
}

async function writeAudit(
  client: PoolClient,
  schema: string,
  actor: AuditActor,
  input: {
    action: string;
    targetUserId: number;
    summary: string;
    locationId?: number | null;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(`
    INSERT INTO ${table(schema, "audit_logs")} (
      actor_type,
      actor_id,
      actor_name,
      actor_user_id,
      actor_professional_id,
      location_id,
      action,
      entity_type,
      entity_id,
      summary,
      metadata
    ) VALUES ('user', $1, $2, $1, $3, $4, $5, 'user', $6, $7, $8)
  `, [
    actor.user.id,
    actor.user.displayName || actor.user.email,
    actor.professionalId,
    input.locationId ?? null,
    input.action,
    input.targetUserId,
    input.summary,
    serializeSafeAuditMetadata(input.metadata),
  ]);
}

async function getUserRow(queryable: Queryable, schema: string, userId: number, forUpdate = false) {
  const result = await queryable.query<ManagedUserRow>(`
    SELECT
      canonical_user.id,
      canonical_user.display_name,
      canonical_user.username,
      canonical_user.email,
      canonical_user.status,
      canonical_user.auth_version,
      canonical_user.last_login_at,
      canonical_user.created_at,
      canonical_user.updated_at,
      professional.id AS professional_id
    FROM ${table(schema, "users")} canonical_user
    LEFT JOIN ${table(schema, "barbers")} professional
      ON professional.user_id = canonical_user.id
    WHERE canonical_user.id = $1
    ${forUpdate ? "FOR UPDATE OF canonical_user" : ""}
  `, [userId]);
  return result.rows[0] ?? null;
}

async function requireUserRow(queryable: Queryable, schema: string, userId: number, forUpdate = false) {
  const row = await getUserRow(queryable, schema, userId, forUpdate);
  if (!row) throw new CanonicalUserManagementError("USER_NOT_FOUND", 404, "Utilizador não encontrado.");
  return row;
}

async function assertEmailAvailable(queryable: Queryable, schema: string, email: string, excludeUserId?: number) {
  const result = await queryable.query<{ id: number }>(`
    SELECT id
    FROM ${table(schema, "users")}
    WHERE (email_key = $1 OR username_key = $1)
      AND ($2::integer IS NULL OR id <> $2)
    LIMIT 1
  `, [normalizeEmail(email), excludeUserId ?? null]);
  if (result.rows.length > 0) {
    throw new CanonicalUserManagementError("DUPLICATE_LOGIN", 409, "Já existe um utilizador com este email/login.");
  }
}

async function loadScopeRows(queryable: Queryable, schema: string, userId: number) {
  return (await queryable.query<ScopeRow>(`
    SELECT
      scope.id,
      scope.user_id,
      scope.location_id,
      scope.preset_key,
      capability.capability_code
    FROM ${table(schema, "user_access_scopes")} scope
    LEFT JOIN ${table(schema, "user_access_scope_capabilities")} capability
      ON capability.access_scope_id = scope.id
    WHERE scope.user_id = $1
    ORDER BY scope.location_id NULLS FIRST, scope.id, capability.capability_code
  `, [userId])).rows;
}

function scopeRowsToScopes(rows: ScopeRow[]): AccessScope[] {
  const grouped = new Map<number, AccessScope>();
  for (const row of rows) {
    const current = grouped.get(row.id) ?? (row.location_id === null
      ? { kind: "global", ...(row.preset_key ? { preset: row.preset_key } : {}), capabilities: [] }
      : { kind: "location", locationId: Number(row.location_id), ...(row.preset_key ? { preset: row.preset_key } : {}), capabilities: [] });
    if (row.capability_code) {
      (current.capabilities as CapabilityCode[]).push(row.capability_code);
    }
    grouped.set(row.id, current);
  }
  return Array.from(grouped.values());
}

async function assertLocationsExist(queryable: Queryable, schema: string, scopes: readonly AccessScope[]) {
  const ids = Array.from(new Set(scopes.flatMap((scope) => scope.kind === "location" ? [scope.locationId] : [])));
  if (ids.length === 0) return;
  const result = await queryable.query<{ id: number }>(`
    SELECT id FROM ${table(schema, "locations")} WHERE id = ANY($1::integer[])
  `, [ids]);
  if (result.rows.length !== ids.length) {
    throw new CanonicalUserManagementError("LOCATION_NOT_FOUND", 400, "Uma das localizações indicadas não existe.");
  }
}

function effectiveScopeCapabilities(scope: AccessScope) {
  return new Set<CapabilityCode>([
    ...(scope.preset ? resolvePresetCapabilities(scope.preset) : []),
    ...(scope.capabilities ?? []),
  ]);
}

function assertGrantCeiling(actor: CanonicalAuthContext, scopes: readonly AccessScope[]) {
  for (const scope of scopes) {
    const effective = effectiveScopeCapabilities(scope);
    if (scope.kind === "global") {
      if (!hasCapability(actor.access, "access.manage")) {
        throw new CanonicalUserManagementError("ACCESS_FORBIDDEN", 403, "Não pode gerir acesso global.");
      }
      if (scope.preset === "administrator" && !actor.isGlobalAdministrator) {
        throw new CanonicalUserManagementError("GRANT_CEILING", 403, "Não pode atribuir o preset Administrator.");
      }
      for (const capability of Array.from(effective)) {
        if (!hasCapability(actor.access, capability)) {
          throw new CanonicalUserManagementError("GRANT_CEILING", 403, "Não pode conceder acesso superior ao seu.");
        }
      }
      continue;
    }

    if (!hasCapabilityAtLocation(actor.access, "access.manage", scope.locationId)) {
      throw new CanonicalUserManagementError("ACCESS_FORBIDDEN", 403, "Não pode gerir acesso nesta localização.");
    }
    for (const capability of Array.from(effective)) {
      if (!hasCapabilityAtLocation(actor.access, capability, scope.locationId)) {
        throw new CanonicalUserManagementError("GRANT_CEILING", 403, "Não pode conceder acesso superior ao seu.");
      }
    }
  }
}

async function insertScopes(
  client: PoolClient,
  schema: string,
  userId: number,
  scopes: readonly AccessScope[],
) {
  for (const scope of scopes) {
    const inserted = await client.query<{ id: number }>(`
      INSERT INTO ${table(schema, "user_access_scopes")} (user_id, location_id, preset_key)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [userId, scope.kind === "location" ? scope.locationId : null, scope.preset ?? null]);
    const scopeId = inserted.rows[0].id;
    for (const capability of scope.capabilities ?? []) {
      await client.query(`
        INSERT INTO ${table(schema, "user_access_scope_capabilities")} (access_scope_id, capability_code)
        VALUES ($1, $2)
      `, [scopeId, capability]);
    }
  }
}

async function createInvite(
  client: PoolClient,
  schema: string,
  userId: number,
  invitedByUserId: number,
  expiresInHours: number,
  now: Date,
): Promise<CanonicalInviteSecret> {
  const token = randomBytes(32).toString("base64url");
  const digest = inviteDigest(token);
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1_000);
  await client.query(`
    UPDATE ${table(schema, "user_invites")}
    SET revoked_at = GREATEST($2, created_at)
    WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
  `, [userId, now]);
  await client.query(`
    INSERT INTO ${table(schema, "user_invites")} (
      user_id, token_digest, invited_by_user_id, expires_at
    ) VALUES ($1, $2, $3, $4)
  `, [userId, digest, invitedByUserId, expiresAt]);
  return { token, expiresAt };
}

function safeScopeMetadata(scopes: readonly AccessScope[]) {
  return scopes.map((scope) => ({
    kind: scope.kind,
    ...(scope.kind === "location" ? { locationId: scope.locationId } : {}),
    preset: scope.preset ?? null,
    capabilities: [...(scope.capabilities ?? [])],
  }));
}

export async function listCanonicalUsers(
  pool: Pool,
  options: { schemaName?: string } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const result = await pool.query<ManagedUserRow>(`
    SELECT
      canonical_user.id,
      canonical_user.display_name,
      canonical_user.username,
      canonical_user.email,
      canonical_user.status,
      canonical_user.auth_version,
      canonical_user.last_login_at,
      canonical_user.created_at,
      canonical_user.updated_at,
      professional.id AS professional_id
    FROM ${table(schema, "users")} canonical_user
    LEFT JOIN ${table(schema, "barbers")} professional ON professional.user_id = canonical_user.id
    ORDER BY canonical_user.display_name, canonical_user.id
  `);
  return result.rows.map(managedUser);
}

export async function getCanonicalUser(
  pool: Pool,
  userId: number,
  options: { schemaName?: string } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const row = await requireUserRow(pool, schema, userId);
  return {
    ...managedUser(row),
    access: scopeRowsToScopes(await loadScopeRows(pool, schema, userId)),
  };
}

export async function createCanonicalInvitedUser(
  pool: Pool,
  actor: CanonicalAuthContext,
  input: CanonicalUserCreateInput,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  assertGrantCeiling(actor, input.access);
  return transaction(pool, async (client) => {
    await lockLoginIdentity(client, normalizeEmail(input.email));
    await assertEmailAvailable(client, schema, input.email);
    await assertLocationsExist(client, schema, input.access);
    const inserted = await client.query<{ id: number }>(`
      INSERT INTO ${table(schema, "users")} (
        display_name, email, password_hash, status, auth_version, created_at, updated_at
      ) VALUES ($1, $2, NULL, 'invited', 1, $3, $3)
      RETURNING id
    `, [input.displayName, normalizeEmail(input.email), now]);
    const userId = inserted.rows[0].id;
    if (input.professionalId) {
      await linkProfessionalInsideTransaction(client, schema, userId, input.professionalId);
    }
    await insertScopes(client, schema, userId, input.access);
    const invite = await createInvite(
      client,
      schema,
      userId,
      actor.user.id,
      input.inviteExpiresInHours ?? 72,
      now,
    );
    await writeAudit(client, schema, actor, {
      action: "user.created",
      targetUserId: userId,
      summary: `Utilizador convidado: ${input.displayName}`,
      metadata: {
        status: "invited",
        professionalId: input.professionalId ?? null,
        access: safeScopeMetadata(input.access),
        inviteExpiresAt: invite.expiresAt,
      },
    });
    return {
      user: await getCanonicalUserWithClient(client, schema, userId),
      invite,
    };
  });
}

export async function createOrReplaceCanonicalProfessionalInvite(
  pool: Pool,
  actor: CanonicalAuthContext,
  professionalId: number,
  locationId: number,
  expiresInHours = 72,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  const access: AccessScope[] = [{
    kind: "location",
    locationId,
    preset: "professional",
    capabilities: [],
  }];
  assertGrantCeiling(actor, access);

  return transaction(pool, async (client) => {
    await assertLocationsExist(client, schema, access);
    const professionalResult = await client.query<{
      id: number;
      name: string;
      email: string | null;
      is_visible: boolean | null;
      user_id: number | null;
    }>(`
      SELECT id, name, email, is_visible, user_id
      FROM ${table(schema, "barbers")}
      WHERE id = $1
      FOR UPDATE
    `, [professionalId]);
    const professional = professionalResult.rows[0];
    if (!professional || professional.is_visible === false) {
      throw new CanonicalUserManagementError("PROFESSIONAL_NOT_FOUND", 404, "Profissional não encontrado.");
    }
    if (!professional.email?.trim()) {
      throw new CanonicalUserManagementError(
        "PROFESSIONAL_EMAIL_REQUIRED",
        400,
        "Adicione um email ao profissional antes de criar o convite.",
      );
    }
    const locationAssignment = await client.query(`
      SELECT 1
      FROM ${table(schema, "barber_locations")}
      WHERE barber_id = $1 AND location_id = $2 AND is_active = true
      FOR KEY SHARE
    `, [professionalId, locationId]);
    if (locationAssignment.rows.length !== 1) {
      throw new CanonicalUserManagementError(
        "PROFESSIONAL_LOCATION_REQUIRED",
        409,
        "Este profissional não está ativo na localização selecionada.",
      );
    }

    let userId = professional.user_id === null ? null : Number(professional.user_id);
    let createdUser = false;
    if (userId === null) {
      const email = normalizeEmail(professional.email);
      await lockLoginIdentity(client, email);
      await assertEmailAvailable(client, schema, email);
      const inserted = await client.query<{ id: number }>(`
        INSERT INTO ${table(schema, "users")} (
          display_name, email, password_hash, status, auth_version, created_at, updated_at
        ) VALUES ($1, $2, NULL, 'invited', 1, $3, $3)
        RETURNING id
      `, [professional.name, email, now]);
      userId = Number(inserted.rows[0].id);
      await linkProfessionalInsideTransaction(client, schema, userId, professionalId);
      await insertScopes(client, schema, userId, access);
      createdUser = true;
      await writeAudit(client, schema, actor, {
        action: "user.created",
        targetUserId: userId,
        locationId,
        summary: `Utilizador convidado para o profissional: ${professional.name}`,
        metadata: {
          status: "invited",
          professionalId,
          access: safeScopeMetadata(access),
        },
      });
    } else {
      const user = await requireUserRow(client, schema, userId, true);
      if (user.professional_id !== professionalId) {
        throw new CanonicalUserManagementError(
          "PROFESSIONAL_LINK_CONFLICT",
          409,
          "A identidade canónica está associada a outro profissional.",
        );
      }
      if (user.status === "active") {
        throw new CanonicalUserManagementError(
          "USER_ALREADY_ACTIVE",
          409,
          "Este profissional já tem acesso ativo.",
        );
      }
      if (user.status === "disabled") {
        throw new CanonicalUserManagementError(
          "USER_DISABLED",
          409,
          "Reative o utilizador antes de criar um novo convite.",
        );
      }
      const existingScopes = scopeRowsToScopes(await loadScopeRows(client, schema, userId));
      if (existingScopes.length === 0) {
        throw new CanonicalUserManagementError(
          "ACCESS_REQUIRED",
          409,
          "Atribua acesso ao utilizador antes de criar um novo convite.",
        );
      }
    }

    const invite = await createInvite(client, schema, userId, actor.user.id, expiresInHours, now);
    await writeAudit(client, schema, actor, {
      action: createdUser ? "user.invite_created" : "user.invite_replaced",
      targetUserId: userId,
      locationId,
      summary: createdUser
        ? "Convite canónico criado para o profissional."
        : "Convite canónico substituído para o profissional.",
      metadata: { professionalId, expiresAt: invite.expiresAt },
    });
    return {
      user: await getCanonicalUserWithClient(client, schema, userId),
      invite,
      createdUser,
    };
  });
}
async function getCanonicalUserWithClient(client: PoolClient, schema: string, userId: number) {
  const row = await requireUserRow(client, schema, userId);
  return {
    ...managedUser(row),
    access: scopeRowsToScopes(await loadScopeRows(client, schema, userId)),
  };
}

export async function updateCanonicalUserIdentity(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  input: CanonicalUserIdentityUpdateInput,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    const current = await requireUserRow(client, schema, userId, true);
    const normalizedEmail = input.email ? normalizeEmail(input.email) : current.email;
    const emailChanged = normalizedEmail !== normalizeEmail(current.email);
    if (emailChanged) {
      await lockLoginIdentity(client, normalizedEmail);
      await assertEmailAvailable(client, schema, normalizedEmail, userId);
    }
    await client.query(`
      UPDATE ${table(schema, "users")}
      SET display_name = $2,
          email = $3,
          auth_version = auth_version + $4,
          updated_at = $5
      WHERE id = $1
    `, [
      userId,
      input.displayName ?? current.display_name,
      normalizedEmail,
      emailChanged ? 1 : 0,
      now,
    ]);
    await writeAudit(client, schema, actor, {
      action: "user.identity_updated",
      targetUserId: userId,
      summary: `Identidade do utilizador atualizada: ${input.displayName ?? current.display_name}`,
      metadata: { fields: Object.keys(input), sessionsRevoked: emailChanged },
    });
    return managedUser(await requireUserRow(client, schema, userId));
  });
}

export async function setCanonicalUserStatus(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  status: "active" | "disabled",
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    await lockLastAdministratorInvariant(client);
    const current = await requireUserRow(client, schema, userId, true);
    if (current.status === "invited") {
      throw new CanonicalUserManagementError(
        "INVITE_REQUIRED",
        409,
        "O utilizador convidado deve ser gerido através do respetivo convite.",
      );
    }
    if (userId === actor.user.id && status === "disabled") {
      throw new CanonicalUserManagementError(
        "SELF_LOCKOUT",
        409,
        "Não pode desativar o seu próprio utilizador.",
      );
    }
    if (status === "active") {
      const password = await client.query<{ password_hash: string | null }>(`
        SELECT password_hash FROM ${table(schema, "users")} WHERE id = $1
      `, [userId]);
      if (!password.rows[0]?.password_hash) {
        throw new CanonicalUserManagementError("PASSWORD_REQUIRED", 409, "O utilizador não tem palavra-passe definida.");
      }
    }
    if (current.status !== status) {
      await client.query(`
        UPDATE ${table(schema, "users")}
        SET status = $2, auth_version = auth_version + 1, updated_at = $3
        WHERE id = $1
      `, [userId, status, now]);
    }
    await assertGlobalAdministratorRemains(client, schema);
    await writeAudit(client, schema, actor, {
      action: status === "active" ? "user.activated" : "user.disabled",
      targetUserId: userId,
      summary: status === "active" ? "Utilizador reativado." : "Utilizador desativado.",
      metadata: { previousStatus: current.status, status },
    });
    return managedUser(await requireUserRow(client, schema, userId));
  });
}

async function linkProfessionalInsideTransaction(
  client: PoolClient,
  schema: string,
  userId: number,
  professionalId: number,
) {
  const target = await client.query<{ id: number; user_id: number | null }>(`
    SELECT id, user_id FROM ${table(schema, "barbers")} WHERE id = $1 FOR UPDATE
  `, [professionalId]);
  const professional = target.rows[0];
  if (!professional) {
    throw new CanonicalUserManagementError("PROFESSIONAL_NOT_FOUND", 404, "Profissional não encontrado.");
  }
  if (professional.user_id !== null && Number(professional.user_id) !== userId) {
    throw new CanonicalUserManagementError("PROFESSIONAL_ALREADY_LINKED", 409, "O profissional já está associado a outro utilizador.");
  }
  const existing = await client.query<{ id: number }>(`
    SELECT id FROM ${table(schema, "barbers")} WHERE user_id = $1 AND id <> $2 FOR UPDATE
  `, [userId, professionalId]);
  if (existing.rows.length > 0) {
    throw new CanonicalUserManagementError("USER_ALREADY_LINKED", 409, "O utilizador já está associado a outro profissional.");
  }
  await client.query(`UPDATE ${table(schema, "barbers")} SET user_id = $2 WHERE id = $1`, [professionalId, userId]);
}

export async function setCanonicalProfessionalLink(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  professionalId: number | null,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    const current = await requireUserRow(client, schema, userId, true);
    if (professionalId === null) {
      await client.query(`UPDATE ${table(schema, "barbers")} SET user_id = NULL WHERE user_id = $1`, [userId]);
    } else {
      await linkProfessionalInsideTransaction(client, schema, userId, professionalId);
    }
    const changed = current.professional_id !== professionalId;
    if (changed) {
      await client.query(`
        UPDATE ${table(schema, "users")}
        SET auth_version = auth_version + 1, updated_at = $2
        WHERE id = $1
      `, [userId, now]);
    }
    await writeAudit(client, schema, actor, {
      action: professionalId === null ? "user.professional_unlinked" : "user.professional_linked",
      targetUserId: userId,
      summary: professionalId === null ? "Perfil profissional desassociado." : "Perfil profissional associado.",
      metadata: { previousProfessionalId: current.professional_id, professionalId },
    });
    return managedUser(await requireUserRow(client, schema, userId));
  });
}

export async function getCanonicalUserAccess(
  pool: Pool,
  userId: number,
  options: { schemaName?: string; locationId?: number } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  await requireUserRow(pool, schema, userId);
  const scopes = scopeRowsToScopes(await loadScopeRows(pool, schema, userId));
  return options.locationId === undefined
    ? scopes
    : scopes.filter((scope) => scope.kind === "location" && scope.locationId === options.locationId);
}

export async function replaceCanonicalUserAccess(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  input: CanonicalAccessReplaceInput,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  if (input.mode === "replace_all" && !hasCapability(actor.access, "access.manage")) {
    throw new CanonicalUserManagementError("ACCESS_FORBIDDEN", 403, "Não pode substituir o acesso global.");
  }
  if (input.mode === "replace_location" && !hasCapabilityAtLocation(
    actor.access,
    "access.manage",
    input.locationId!,
  )) {
    throw new CanonicalUserManagementError("ACCESS_FORBIDDEN", 403, "Não pode gerir acesso nesta localização.");
  }
  assertGrantCeiling(actor, input.scopes);

  return transaction(pool, async (client) => {
    await lockLastAdministratorInvariant(client);
    await requireUserRow(client, schema, userId, true);
    await assertLocationsExist(client, schema, input.scopes);
    if (input.mode === "replace_all") {
      await client.query(`DELETE FROM ${table(schema, "user_access_scopes")} WHERE user_id = $1`, [userId]);
    } else {
      await client.query(`
        DELETE FROM ${table(schema, "user_access_scopes")}
        WHERE user_id = $1 AND location_id = $2
      `, [userId, input.locationId]);
    }
    await insertScopes(client, schema, userId, input.scopes);
    if (userId === actor.user.id) {
      const resultingAccess = resolveEffectiveAccess(scopeRowsToScopes(
        await loadScopeRows(client, schema, userId),
      ));
      const retainsAccessManagement = input.mode === "replace_all"
        ? hasCapability(resultingAccess, "access.manage")
        : hasCapabilityAtLocation(resultingAccess, "access.manage", input.locationId!);
      if (!retainsAccessManagement) {
        throw new CanonicalUserManagementError(
          "SELF_LOCKOUT",
          409,
          "Não pode remover o seu próprio acesso à gestão de permissões.",
        );
      }
    }
    await client.query(`
      UPDATE ${table(schema, "users")}
      SET auth_version = auth_version + 1, updated_at = $2
      WHERE id = $1
    `, [userId, now]);
    await assertGlobalAdministratorRemains(client, schema);
    await writeAudit(client, schema, actor, {
      action: "user.access_updated",
      targetUserId: userId,
      locationId: input.mode === "replace_location" ? input.locationId : null,
      summary: "Acesso do utilizador atualizado.",
      metadata: { mode: input.mode, access: safeScopeMetadata(input.scopes) },
    });
    return getCanonicalUserWithClient(client, schema, userId);
  });
}

export async function replaceCanonicalUserInvite(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  expiresInHours = 72,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    const user = await requireUserRow(client, schema, userId, true);
    if (user.status !== "invited") {
      throw new CanonicalUserManagementError("USER_NOT_INVITED", 409, "Apenas utilizadores convidados podem receber este convite.");
    }
    const invite = await createInvite(client, schema, userId, actor.user.id, expiresInHours, now);
    await writeAudit(client, schema, actor, {
      action: "user.invite_replaced",
      targetUserId: userId,
      summary: "Convite canónico substituído.",
      metadata: { expiresAt: invite.expiresAt },
    });
    return invite;
  });
}

export async function revokeCanonicalUserInvites(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    await requireUserRow(client, schema, userId, true);
    const revoked = await client.query(`
      UPDATE ${table(schema, "user_invites")}
      SET revoked_at = GREATEST($2, created_at)
      WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `, [userId, now]);
    await writeAudit(client, schema, actor, {
      action: "user.invites_revoked",
      targetUserId: userId,
      summary: "Convites canónicos revogados.",
      metadata: { count: revoked.rowCount ?? 0 },
    });
    return revoked.rowCount ?? 0;
  });
}

type CanonicalInviteRow = {
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};

function canonicalInviteState(invite: CanonicalInviteRow | undefined, now: Date): CanonicalInviteState {
  if (!invite) return "invalid";
  if (invite.accepted_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at <= now) return "expired";
  return "valid";
}

function throwCanonicalInviteState(state: Exclude<CanonicalInviteState, "valid">): never {
  if (state === "used") {
    throw new CanonicalUserManagementError("INVITE_USED", 409, "Este convite já foi utilizado.");
  }
  if (state === "revoked") {
    throw new CanonicalUserManagementError("INVITE_REVOKED", 410, "Este convite foi revogado ou substituído.");
  }
  if (state === "expired") {
    throw new CanonicalUserManagementError("INVITE_EXPIRED", 410, "Este convite expirou.");
  }
  throw new CanonicalUserManagementError("INVITE_INVALID", 400, "Convite inválido.");
}

export async function inspectCanonicalUserInvite(
  pool: Pool,
  token: string,
  options: { schemaName?: string; now?: Date } = {},
): Promise<CanonicalInviteInspection> {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  const digest = inviteDigest(token);
  const result = await pool.query<CanonicalInviteRow>(`
    SELECT expires_at, accepted_at, revoked_at
    FROM ${table(schema, "user_invites")}
    WHERE token_digest = $1
  `, [digest]);
  const invite = result.rows[0];
  return {
    state: canonicalInviteState(invite, now),
    expiresAt: invite?.expires_at ?? null,
  };
}

export async function acceptCanonicalUserInvite(
  pool: Pool,
  token: string,
  password: string,
  options: { schemaName?: string; now?: Date } = {},
): Promise<CanonicalSessionIdentity> {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  const passwordHash = await bcrypt.hash(password, 10);
  const digest = inviteDigest(token);
  return transaction(pool, async (client) => {
    const claimed = await client.query<{
      id: number;
      user_id: number;
      display_name: string;
      email: string;
      professional_id: number | null;
      status: "invited" | "active" | "disabled";
      expires_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(`
      SELECT invite.id, invite.user_id, canonical_user.display_name, canonical_user.email,
        canonical_user.status,
        professional.id AS professional_id,
        invite.expires_at, invite.accepted_at, invite.revoked_at
      FROM ${table(schema, "user_invites")} invite
      INNER JOIN ${table(schema, "users")} canonical_user ON canonical_user.id = invite.user_id
      LEFT JOIN ${table(schema, "barbers")} professional ON professional.user_id = canonical_user.id
      WHERE invite.token_digest = $1
      FOR UPDATE OF invite, canonical_user
    `, [digest]);
    const invite = claimed.rows[0];
    const state = canonicalInviteState(invite, now);
    if (state !== "valid") throwCanonicalInviteState(state);
    if (invite.status !== "invited") {
      throw new CanonicalUserManagementError(
        "USER_NOT_INVITED",
        409,
        "Este utilizador já não está a aguardar ativação.",
      );
    }
    const updated = await client.query<{ id: number; auth_version: number }>(`
      UPDATE ${table(schema, "users")}
      SET password_hash = $2,
          status = 'active',
          auth_version = auth_version + 1,
          updated_at = $3
      WHERE id = $1 AND status = 'invited'
      RETURNING id, auth_version
    `, [invite.user_id, passwordHash, now]);
    if (updated.rows.length !== 1) {
      throw new CanonicalUserManagementError("USER_NOT_INVITED", 409, "Este utilizador já não está a aguardar ativação.");
    }
    await client.query(`UPDATE ${table(schema, "user_invites")} SET accepted_at = $2 WHERE id = $1`, [invite.id, now]);
    await client.query(`
      UPDATE ${table(schema, "user_invites")}
      SET revoked_at = GREATEST($2, created_at)
      WHERE user_id = $1 AND id <> $3 AND accepted_at IS NULL AND revoked_at IS NULL
    `, [invite.user_id, now, invite.id]);
    await writeAudit(client, schema, {
      user: { id: invite.user_id, displayName: invite.display_name, email: invite.email },
      professionalId: invite.professional_id === null ? null : Number(invite.professional_id),
    }, {
      action: "user.invite_accepted",
      targetUserId: invite.user_id,
      summary: "Convite canónico aceite e utilizador ativado.",
    });
    return { userId: updated.rows[0].id, authVersion: updated.rows[0].auth_version };
  });
}

export async function revokeCanonicalUserSessions(
  pool: Pool,
  actor: CanonicalAuthContext,
  userId: number,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  return transaction(pool, async (client) => {
    await requireUserRow(client, schema, userId, true);
    const result = await client.query<{ auth_version: number }>(`
      UPDATE ${table(schema, "users")}
      SET auth_version = auth_version + 1, updated_at = $2
      WHERE id = $1
      RETURNING auth_version
    `, [userId, now]);
    await writeAudit(client, schema, actor, {
      action: "user.sessions_revoked",
      targetUserId: userId,
      summary: "Todas as sessões do utilizador foram revogadas.",
    });
    return Number(result.rows[0].auth_version);
  });
}

export async function changeCanonicalPassword(
  pool: Pool,
  actor: CanonicalAuthContext,
  currentPassword: string,
  newPassword: string,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  const newPasswordHash = await bcrypt.hash(newPassword, 10);
  return transaction(pool, async (client) => {
    const current = await client.query<{ password_hash: string | null }>(`
      SELECT password_hash FROM ${table(schema, "users")} WHERE id = $1 FOR UPDATE
    `, [actor.user.id]);
    const passwordHash = current.rows[0]?.password_hash;
    if (!passwordHash || !await bcrypt.compare(currentPassword, passwordHash)) {
      throw new CanonicalUserManagementError("PASSWORD_INVALID", 400, "Palavra-passe atual incorreta.");
    }
    const updated = await client.query<{ auth_version: number }>(`
      UPDATE ${table(schema, "users")}
      SET password_hash = $2, auth_version = auth_version + 1, updated_at = $3
      WHERE id = $1 AND status = 'active'
      RETURNING auth_version
    `, [actor.user.id, newPasswordHash, now]);
    if (updated.rows.length !== 1) {
      throw new CanonicalUserManagementError("USER_NOT_ACTIVE", 409, "O utilizador não está ativo.");
    }
    await writeAudit(client, schema, actor, {
      action: "user.password_changed",
      targetUserId: actor.user.id,
      summary: "Palavra-passe canónica alterada; sessões anteriores revogadas.",
    });
    return Number(updated.rows[0].auth_version);
  });
}
