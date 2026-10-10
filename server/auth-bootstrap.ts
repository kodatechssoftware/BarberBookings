import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool, PoolClient } from "pg";
import { canonicalBootstrapInputSchema, type CanonicalBootstrapInput } from "@shared/auth";
import { serializeSafeAuditMetadata } from "./audit-log-security";

export class CanonicalBootstrapError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalBootstrapError";
  }
}

export type CanonicalBootstrapStatus = {
  available: boolean;
  configured: boolean;
};

export type CanonicalBootstrapResult = {
  userId: number;
  authVersion: number;
};

const BOOTSTRAP_LOCK_NAMESPACE = 915_003;
const BOOTSTRAP_LOCK_KEY = 1;
export const MIN_BOOTSTRAP_TOKEN_LENGTH = 32;

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

function configuredToken(environment: NodeJS.ProcessEnv) {
  const value = environment.BOOTSTRAP_ADMIN_TOKEN?.trim();
  return value || null;
}

function tokenDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function validateBootstrapTokenConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const token = configuredToken(environment);
  if (token && token.length < MIN_BOOTSTRAP_TOKEN_LENGTH) {
    throw new Error(`BOOTSTRAP_ADMIN_TOKEN must contain at least ${MIN_BOOTSTRAP_TOKEN_LENGTH} characters when configured.`);
  }
}

export function isBootstrapTokenConfigured(environment: NodeJS.ProcessEnv = process.env) {
  const token = configuredToken(environment);
  return Boolean(token && token.length >= MIN_BOOTSTRAP_TOKEN_LENGTH);
}

export function isValidBootstrapToken(
  provided: unknown,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const expected = configuredToken(environment);
  if (!expected || expected.length < MIN_BOOTSTRAP_TOKEN_LENGTH || typeof provided !== "string") return false;
  return timingSafeEqual(tokenDigest(provided), tokenDigest(expected));
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

export async function getCanonicalBootstrapStatus(
  pool: Pool,
  options: { schemaName?: string; environment?: NodeJS.ProcessEnv } = {},
): Promise<CanonicalBootstrapStatus> {
  const schema = resolveSchemaName(options.schemaName);
  const result = await pool.query<{ available: boolean }>(`
    SELECT NOT EXISTS (SELECT 1 FROM ${table(schema, "users")}) AS available
  `);
  return {
    available: result.rows[0]?.available === true,
    configured: isBootstrapTokenConfigured(options.environment),
  };
}

export async function bootstrapCanonicalAdministrator(
  pool: Pool,
  rawInput: unknown,
  options: {
    schemaName?: string;
    environment?: NodeJS.ProcessEnv;
    now?: Date;
    passwordHashRounds?: number;
  } = {},
): Promise<CanonicalBootstrapResult> {
  const rawToken = rawInput && typeof rawInput === "object"
    ? (rawInput as { token?: unknown }).token
    : undefined;
  if (!isValidBootstrapToken(rawToken, options.environment)) {
    throw new CanonicalBootstrapError(
      "BOOTSTRAP_DENIED",
      403,
      "Não foi possível concluir a configuração inicial.",
    );
  }

  const input: CanonicalBootstrapInput = canonicalBootstrapInputSchema.parse(rawInput);
  const schema = resolveSchemaName(options.schemaName);
  const now = options.now ?? new Date();
  const passwordHash = await bcrypt.hash(input.password, options.passwordHashRounds ?? 10);
  const email = input.email.trim().toLowerCase();

  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      BOOTSTRAP_LOCK_NAMESPACE,
      BOOTSTRAP_LOCK_KEY,
    ]);
    const existing = await client.query(`SELECT 1 FROM ${table(schema, "users")} LIMIT 1`);
    if (existing.rowCount) {
      throw new CanonicalBootstrapError(
        "BOOTSTRAP_CLOSED",
        409,
        "A configuração inicial já foi concluída.",
      );
    }

    const created = await client.query<{ id: number; auth_version: number }>(`
      INSERT INTO ${table(schema, "users")} (
        display_name, email, password_hash, status, auth_version, created_at, updated_at
      ) VALUES ($1, $2, $3, 'active', 1, $4, $4)
      RETURNING id, auth_version
    `, [input.displayName.trim(), email, passwordHash, now]);
    const identity = created.rows[0];
    if (!identity) throw new Error("Canonical bootstrap did not create a user.");

    await client.query(`
      INSERT INTO ${table(schema, "user_access_scopes")} (
        user_id, location_id, preset_key, created_at, updated_at
      ) VALUES ($1, NULL, 'administrator', $2, $2)
    `, [identity.id, now]);

    await client.query(`
      INSERT INTO ${table(schema, "audit_logs")} (
        actor_type, actor_id, actor_name, actor_user_id, actor_professional_id,
        location_id, action, entity_type, entity_id, summary, metadata, created_at
      ) VALUES ('user', $1, $2, $1, NULL, NULL, 'auth.bootstrap_completed',
        'user', $1, 'Primeiro administrador canónico criado.', $3, $4)
    `, [
      identity.id,
      input.displayName.trim(),
      serializeSafeAuditMetadata({ status: "active", preset: "administrator", professionalId: null }),
      now,
    ]);

    return { userId: Number(identity.id), authVersion: Number(identity.auth_version) };
  });
}
