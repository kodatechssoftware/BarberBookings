import bcrypt from "bcryptjs";
import type { Pool, PoolClient } from "pg";
import {
  accessPresetKeys,
  capabilityCodes,
  resolveEffectiveAccess,
  type AccessPresetKey,
  type AccessScope,
  type AuthContext,
  type CapabilityCode,
} from "@shared/auth";

export const authRuntimeModes = ["legacy", "canonical"] as const;
export type AuthRuntimeMode = (typeof authRuntimeModes)[number];

export function parseAuthRuntimeMode(value: string | undefined): AuthRuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "legacy";
  if ((authRuntimeModes as readonly string[]).includes(normalized)) {
    return normalized as AuthRuntimeMode;
  }
  throw new Error("AUTH_RUNTIME_MODE must be legacy or canonical.");
}

export const authRuntimeMode = parseAuthRuntimeMode(process.env.AUTH_RUNTIME_MODE);

type CanonicalUserRow = {
  id: number;
  display_name: string;
  username: string | null;
  email: string;
  password_hash: string | null;
  status: "invited" | "active" | "disabled";
  auth_version: number;
  last_login_at: Date | null;
};

type CanonicalScopeRow = {
  id: number | null;
  location_id: number | null;
  preset_key: string | null;
  capability_code: string | null;
};

export type CanonicalAuthContext = AuthContext & {
  username: string | null;
  status: CanonicalUserRow["status"];
  authVersion: number;
  lastLoginAt: Date | null;
  legacyAdminId: number | null;
  isGlobalAdministrator: boolean;
  hasProfessionalAccessPreset: boolean;
};

export type CanonicalSessionIdentity = {
  userId: number;
  authVersion: number;
};

export type CanonicalLoginResult = {
  identity: CanonicalSessionIdentity;
  context: CanonicalAuthContext;
};

const validPresetKeys = new Set<string>(accessPresetKeys);
const validCapabilityCodes = new Set<string>(capabilityCodes);
const dummyPasswordHash = "$2b$10$7EqJtq98hPqEX7fNZaFWoO5Nv5D5vR7mMk7NfHj7JtT8bM8rV9r9m";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function schemaName(value = process.env.DATABASE_SCHEMA) {
  return value?.trim() || "public";
}

function table(schema: string, name: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function normalizeLogin(login: string) {
  return login.trim().toLowerCase();
}

function rowsToAccessScopes(rows: CanonicalScopeRow[]): AccessScope[] {
  const grouped = new Map<number, {
    locationId: number | null;
    preset?: AccessPresetKey;
    capabilities: CapabilityCode[];
  }>();

  for (const row of rows) {
    if (row.id === null) continue;
    const existing = grouped.get(row.id) ?? {
      locationId: row.location_id,
      capabilities: [],
    };
    if (row.preset_key) {
      if (!validPresetKeys.has(row.preset_key)) {
        throw new Error(`Unknown access preset in database: ${row.preset_key}`);
      }
      existing.preset = row.preset_key as AccessPresetKey;
    }
    if (row.capability_code) {
      if (!validCapabilityCodes.has(row.capability_code)) {
        throw new Error(`Unknown capability in database: ${row.capability_code}`);
      }
      existing.capabilities.push(row.capability_code as CapabilityCode);
    }
    grouped.set(row.id, existing);
  }

  return Array.from(grouped.values()).map((scope) => scope.locationId === null
    ? { kind: "global", preset: scope.preset, capabilities: scope.capabilities }
    : { kind: "location", locationId: scope.locationId, preset: scope.preset, capabilities: scope.capabilities });
}

async function loadContextForUserRow(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  schema: string,
  user: CanonicalUserRow,
): Promise<CanonicalAuthContext> {
  const contextRows = await queryable.query<CanonicalScopeRow & {
    professional_id: number | null;
    legacy_admin_id: number | null;
  }>(`
    SELECT
      scope.id,
      scope.location_id,
      scope.preset_key,
      capability.capability_code,
      (SELECT barber.id FROM ${table(schema, "barbers")} barber WHERE barber.user_id = $1 LIMIT 1) AS professional_id,
      (SELECT admin.id FROM ${table(schema, "admins")} admin WHERE admin.user_id = $1 LIMIT 1) AS legacy_admin_id
    FROM (SELECT 1) anchor
    LEFT JOIN ${table(schema, "user_access_scopes")} scope ON scope.user_id = $1
    LEFT JOIN ${table(schema, "user_access_scope_capabilities")} capability
      ON capability.access_scope_id = scope.id
    ORDER BY scope.id, capability.capability_code
  `, [user.id]);
  const scopes = rowsToAccessScopes(contextRows.rows);
  const link = contextRows.rows[0] ?? { professional_id: null, legacy_admin_id: null };
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      isActive: user.status === "active",
    },
    username: user.username,
    status: user.status,
    authVersion: user.auth_version,
    lastLoginAt: user.last_login_at,
    professionalId: link.professional_id,
    legacyAdminId: link.legacy_admin_id,
    access: resolveEffectiveAccess(scopes),
    isGlobalAdministrator: scopes.some(
      (scope) => scope.kind === "global" && scope.preset === "administrator",
    ),
    hasProfessionalAccessPreset: scopes.some((scope) => scope.preset === "professional"),
  };
}

export async function loadCanonicalAuthContext(
  pool: Pool,
  userId: number,
  options: { schemaName?: string; requireActive?: boolean } = {},
): Promise<CanonicalAuthContext | null> {
  const schema = options.schemaName?.trim() || schemaName();
  const result = await pool.query<CanonicalUserRow>(`
    SELECT id, display_name, username, email, password_hash, status, auth_version, last_login_at
    FROM ${table(schema, "users")}
    WHERE id = $1
    LIMIT 1
  `, [userId]);
  const user = result.rows[0];
  if (!user || (options.requireActive !== false && user.status !== "active")) return null;
  return loadContextForUserRow(pool, schema, user);
}

export async function authenticateCanonicalUser(
  pool: Pool,
  login: string,
  password: string,
  options: { schemaName?: string; now?: Date } = {},
): Promise<CanonicalLoginResult | null> {
  const schema = options.schemaName?.trim() || schemaName();
  const normalizedLogin = normalizeLogin(login);
  const matches = await pool.query<CanonicalUserRow>(`
    SELECT id, display_name, username, email, password_hash, status, auth_version, last_login_at
    FROM ${table(schema, "users")}
    WHERE email_key = $1 OR username_key = $1
    ORDER BY id
    LIMIT 3
  `, [normalizedLogin]);

  // Cross-column collisions (one user's email equals another user's username)
  // are intentionally not resolved by precedence.
  const user = matches.rows.length === 1 ? matches.rows[0] : null;
  const validPassword = await bcrypt.compare(password, user?.password_hash || dummyPasswordHash);
  if (!user || user.status !== "active" || !user.password_hash || !validPassword) return null;

  const now = options.now ?? new Date();
  const updated = await pool.query<CanonicalUserRow>(`
    UPDATE ${table(schema, "users")}
    SET last_login_at = $2
    WHERE id = $1 AND status = 'active' AND auth_version = $3
    RETURNING id, display_name, username, email, password_hash, status, auth_version, last_login_at
  `, [user.id, now, user.auth_version]);
  if (updated.rows.length !== 1) return null;
  const context = await loadContextForUserRow(pool, schema, updated.rows[0]);
  return {
    identity: { userId: context.user.id, authVersion: context.authVersion },
    context,
  };
}

export async function validateCanonicalSession(
  pool: Pool,
  identity: CanonicalSessionIdentity,
  options: { schemaName?: string } = {},
) {
  if (!Number.isSafeInteger(identity.userId) || identity.userId <= 0
    || !Number.isSafeInteger(identity.authVersion) || identity.authVersion <= 0) return null;
  const context = await loadCanonicalAuthContext(pool, identity.userId, {
    schemaName: options.schemaName,
    requireActive: true,
  });
  return context?.authVersion === identity.authVersion ? context : null;
}

export async function resetCanonicalPasswordForProfessional(
  pool: Pool,
  professionalId: number,
  options: { schemaName?: string } = {},
) {
  const schema = options.schemaName?.trim() || schemaName();
  const result = await pool.query<{ id: number; auth_version: number }>(`
    UPDATE ${table(schema, "users")} canonical_user
    SET password_hash = NULL,
        status = 'invited',
        auth_version = auth_version + 1,
        updated_at = now()
    FROM ${table(schema, "barbers")} professional
    WHERE professional.id = $1
      AND professional.user_id = canonical_user.id
    RETURNING canonical_user.id, canonical_user.auth_version
  `, [professionalId]);
  return result.rows[0] ?? null;
}

export async function acceptLegacyProfessionalInviteCanonical(
  pool: Pool,
  inviteId: number,
  professionalId: number,
  passwordHash: string,
  options: { schemaName?: string; now?: Date } = {},
): Promise<CanonicalSessionIdentity | null> {
  const schema = options.schemaName?.trim() || schemaName();
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query<{ user_id: number }>(`
      UPDATE ${table(schema, "barber_invites")} invite
      SET used_at = $3
      FROM ${table(schema, "barbers")} professional
      WHERE invite.id = $1
        AND invite.barber_id = $2
        AND invite.used_at IS NULL
        AND invite.expires_at > $3
        AND professional.id = invite.barber_id
        AND professional.is_visible IS DISTINCT FROM false
        AND professional.user_id IS NOT NULL
      RETURNING professional.user_id
    `, [inviteId, professionalId, now]);
    const userId = claimed.rows[0]?.user_id;
    if (!userId) {
      await client.query("ROLLBACK");
      return null;
    }
    const updated = await client.query<{ id: number; auth_version: number }>(`
      UPDATE ${table(schema, "users")}
      SET password_hash = $2,
          status = 'active',
          auth_version = auth_version + 1,
          updated_at = $3
      WHERE id = $1
      RETURNING id, auth_version
    `, [userId, passwordHash, now]);
    if (updated.rows.length !== 1) throw new Error("Canonical user missing while accepting professional invite.");
    await client.query("COMMIT");
    return { userId: updated.rows[0].id, authVersion: updated.rows[0].auth_version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function toCanonicalMeResponse(context: CanonicalAuthContext) {
  const role = context.isGlobalAdministrator
    ? "admin"
    : context.professionalId && context.hasProfessionalAccessPreset ? "barber" : "user";
  return {
    authorized: true,
    role,
    id: context.user.id,
    userId: context.user.id,
    name: context.user.displayName,
    email: context.user.email,
    professionalId: context.professionalId,
    access: context.access,
  };
}

export function canUseLegacyAuthenticatedRoutes(context: CanonicalAuthContext) {
  return context.isGlobalAdministrator
    || (context.professionalId !== null && context.hasProfessionalAccessPreset);
}

export async function validateCanonicalAuthFoundation(
  pool: Pool,
  options: { schemaName?: string } = {},
) {
  const schema = options.schemaName?.trim() || schemaName();
  const requiredTables = [
    "users",
    "user_access_scopes",
    "user_access_scope_capabilities",
    "admins",
    "barbers",
    "barber_invites",
    "user_invites",
    "audit_logs",
    "schema_migrations",
  ];
  const result = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_name = ANY($2::text[])
  `, [schema, requiredTables]);
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Canonical auth foundation is missing tables: ${missing.join(", ")}. Apply migration 0015 first.`);
  }
  const migration = await pool.query<{ name: string }>(`
    SELECT name FROM ${table(schema, "schema_migrations")}
    WHERE name = '0015_auth_users_foundation.sql'
  `);
  if (migration.rows.length !== 1) {
    throw new Error("Canonical auth requires applied migration 0015_auth_users_foundation.sql.");
  }
  const columns = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND ((table_name = 'admins' AND column_name = 'user_id')
        OR (table_name = 'barbers' AND column_name = 'user_id')
        OR (table_name = 'audit_logs' AND column_name IN ('actor_user_id', 'actor_professional_id'))
        OR (table_name = 'users' AND column_name IN ('password_hash', 'status', 'auth_version')))
  `, [schema]);
  const columnKeys = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const requiredColumns = [
    "admins.user_id",
    "barbers.user_id",
    "audit_logs.actor_user_id",
    "audit_logs.actor_professional_id",
    "users.password_hash",
    "users.status",
    "users.auth_version",
  ];
  const missingColumns = requiredColumns.filter((column) => !columnKeys.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`Canonical auth foundation is missing columns: ${missingColumns.join(", ")}.`);
  }
  const invalid = await pool.query<{ invalid_count: string }>(`
    SELECT count(*)::text AS invalid_count
    FROM ${table(schema, "user_access_scopes")} scope
    LEFT JOIN ${table(schema, "user_access_scope_capabilities")} capability
      ON capability.access_scope_id = scope.id
    WHERE (scope.preset_key IS NOT NULL AND NOT (scope.preset_key = ANY($1::text[])))
       OR (capability.capability_code IS NOT NULL AND NOT (capability.capability_code = ANY($2::text[])))
  `, [accessPresetKeys, capabilityCodes]);
  if (Number(invalid.rows[0]?.invalid_count ?? 0) > 0) {
    throw new Error("Canonical auth foundation contains unknown presets or capabilities.");
  }
}
