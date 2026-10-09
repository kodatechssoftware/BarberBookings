import type { Pool, PoolClient } from "pg";
import {
  buildLegacyAuthPreflightReport,
  collectLegacyAuthSnapshot,
  isUsableEmail,
  nonempty,
  normalizeIdentity,
  quoteDatabaseIdentifier,
  type LegacyAdminCredential,
  type LegacyBarberCredential,
  type LegacyIdentityCase,
} from "./auth-legacy-preflight";

const BACKFILL_LOCK_NAMESPACE = 1111638594;
const BACKFILL_LOCK_KEY = 1096111174;

export class LegacyAuthBackfillLockedError extends Error {
  constructor() {
    super("Another legacy auth backfill is already running.");
    this.name = "LegacyAuthBackfillLockedError";
  }
}

export class LegacyAuthBackfillFoundationError extends Error {
  constructor() {
    super("Auth foundation migration 0015 must be applied before running the legacy backfill.");
    this.name = "LegacyAuthBackfillFoundationError";
  }
}

class LegacyAuthBackfillCaseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LegacyAuthBackfillCaseError";
  }
}

type BackfillMode = "dry-run" | "apply";

type CanonicalIdentity = {
  displayName: string;
  email: string;
  username: string | null;
  usernameKey: string | null;
  passwordHash: string;
  admin: LegacyAdminCredential | null;
  professional: LegacyBarberCredential | null;
};

type CanonicalUserRow = {
  id: number;
  username_key: string | null;
  email_key: string;
  password_hash: string | null;
  status: string;
};

type BackfillDelta = {
  usersCreated: number;
  usersReused: number;
  adminsLinked: number;
  professionalsLinked: number;
  accessScopesCreated: number;
  accessScopesUpdated: number;
};

export type LegacyAuthBackfillCaseResult = {
  key: string;
  displayName: string;
  classification: LegacyIdentityCase["classification"];
  adminIds: number[];
  professionalIds: number[];
  normalizedIdentifiers: string[];
  status: "planned" | "applied" | "unchanged" | "skipped" | "failed";
  code: string;
};

export type LegacyAuthBackfillReport = {
  generatedAt: string;
  mode: BackfillMode;
  atomicity: "one_transaction_per_identity";
  lock: "postgres_session_advisory_lock";
  stateMapping: {
    active: string;
    invited: string;
    disabled: string;
  };
  summary: {
    SAFE_AUTO: number;
    MANUAL_REVIEW: number;
    BLOCKER: number;
    CREATED: number;
    REUSED_USERS: number;
    LINKED_ADMINS: number;
    LINKED_PROFESSIONALS: number;
    ACCESS_SCOPES_CREATED: number;
    ACCESS_SCOPES_UPDATED: number;
    WOULD_CREATE: number;
    WOULD_LINK_ADMINS: number;
    WOULD_LINK_PROFESSIONALS: number;
    WOULD_CREATE_ACCESS_SCOPES: number;
    WOULD_UPDATE_ACCESS_SCOPES: number;
    UNCHANGED: number;
    SKIPPED: number;
    FAILED: number;
  };
  review: LegacyIdentityCase[];
  cases: LegacyAuthBackfillCaseResult[];
};

function sameIds(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveCanonicalIdentity(
  authCase: LegacyIdentityCase,
  snapshot: Awaited<ReturnType<typeof collectLegacyAuthSnapshot>>,
): CanonicalIdentity | null {
  const admins = snapshot.admins.filter((admin) => authCase.adminIds.includes(admin.id));
  const professionals = snapshot.barbers.filter((professional) => authCase.barberIds.includes(professional.id));
  if (admins.length > 1 || professionals.length > 1) {
    throw new LegacyAuthBackfillCaseError("AMBIGUOUS_LEGACY_COMPONENT");
  }

  const admin = admins[0] ?? null;
  const professional = professionals[0] ?? null;
  const passwordHash = admin?.passwordHash || professional?.passwordHash || null;
  if (!nonempty(passwordHash)) return null;

  const adminEmail = normalizeIdentity(admin?.email);
  const professionalEmail = normalizeIdentity(professional?.email);
  const adminUsernameAsEmail = normalizeIdentity(admin?.username);
  const email = adminEmail && isUsableEmail(adminEmail)
    ? adminEmail
    : professionalEmail && isUsableEmail(professionalEmail)
      ? professionalEmail
      : adminUsernameAsEmail && isUsableEmail(adminUsernameAsEmail)
        ? adminUsernameAsEmail
        : null;
  if (!email) throw new LegacyAuthBackfillCaseError("NO_CANONICAL_EMAIL");

  const username = admin?.username.trim() || null;
  return {
    displayName: professional?.name.trim() || username || email,
    email,
    username,
    usernameKey: normalizeIdentity(username),
    passwordHash: passwordHash!,
    admin,
    professional,
  };
}

async function findCompatibleCanonicalUser(
  client: PoolClient,
  schema: string,
  identity: CanonicalIdentity,
  linkedUserIds: number[],
) {
  const candidates = await client.query<CanonicalUserRow>(`
    SELECT id, username_key, email_key, password_hash, status
    FROM ${schema}.users
    WHERE id = ANY($1::integer[])
       OR email_key = $2
       OR username_key = $2
       OR ($3::text IS NOT NULL AND (email_key = $3 OR username_key = $3))
    ORDER BY id
  `, [linkedUserIds, identity.email, identity.usernameKey]);

  if (candidates.rows.length > 1) {
    throw new LegacyAuthBackfillCaseError("MULTIPLE_CANONICAL_USER_CANDIDATES");
  }
  const user = candidates.rows[0];
  if (!user) return null;
  if (linkedUserIds.length === 1 && user.id !== linkedUserIds[0]) {
    throw new LegacyAuthBackfillCaseError("LINKED_USER_DOES_NOT_MATCH_CANONICAL_IDENTITY");
  }
  if (user.email_key !== identity.email || user.username_key !== identity.usernameKey) {
    throw new LegacyAuthBackfillCaseError("CANONICAL_LOGIN_KEYS_DO_NOT_MATCH");
  }
  if (user.password_hash !== identity.passwordHash) {
    throw new LegacyAuthBackfillCaseError("CANONICAL_PASSWORD_HASH_DOES_NOT_MATCH");
  }
  if (user.status !== "active") {
    throw new LegacyAuthBackfillCaseError("CANONICAL_USER_IS_NOT_ACTIVE");
  }
  return user;
}

async function linkLegacyRecord(
  client: PoolClient,
  schema: string,
  tableName: "admins" | "barbers",
  legacyId: number,
  currentUserId: number | null | undefined,
  userId: number | null,
  apply: boolean,
) {
  if (currentUserId !== null && currentUserId !== undefined) {
    if (userId !== null && currentUserId !== userId) {
      throw new LegacyAuthBackfillCaseError("LEGACY_RECORD_LINKED_TO_DIFFERENT_USER");
    }
    return 0;
  }
  if (!apply) return 1;
  if (userId === null) throw new LegacyAuthBackfillCaseError("MISSING_CANONICAL_USER_ID");

  const updated = await client.query(`
    UPDATE ${schema}.${quoteDatabaseIdentifier(tableName)}
    SET user_id = $1
    WHERE id = $2 AND user_id IS NULL
  `, [userId, legacyId]);
  if (updated.rowCount !== 1) throw new LegacyAuthBackfillCaseError("LEGACY_LINK_UPDATE_FAILED");
  return 1;
}

async function ensureAdministratorScope(
  client: PoolClient,
  schema: string,
  userId: number | null,
  apply: boolean,
): Promise<Pick<BackfillDelta, "accessScopesCreated" | "accessScopesUpdated">> {
  if (userId === null) return { accessScopesCreated: 1, accessScopesUpdated: 0 };
  const existing = await client.query<{ id: number; preset_key: string | null }>(`
    SELECT id, preset_key
    FROM ${schema}.user_access_scopes
    WHERE user_id = $1 AND location_id IS NULL
  `, [userId]);
  if (existing.rows.length === 0) {
    if (apply) {
      await client.query(`
        INSERT INTO ${schema}.user_access_scopes (user_id, preset_key)
        VALUES ($1, 'administrator')
      `, [userId]);
    }
    return { accessScopesCreated: 1, accessScopesUpdated: 0 };
  }
  if (existing.rows[0].preset_key === "administrator") {
    return { accessScopesCreated: 0, accessScopesUpdated: 0 };
  }
  if (apply) {
    await client.query(`
      UPDATE ${schema}.user_access_scopes
      SET preset_key = 'administrator', updated_at = now()
      WHERE id = $1
    `, [existing.rows[0].id]);
  }
  return { accessScopesCreated: 0, accessScopesUpdated: 1 };
}

async function ensureProfessionalScopes(
  client: PoolClient,
  schema: string,
  professionalId: number,
  userId: number | null,
  apply: boolean,
): Promise<Pick<BackfillDelta, "accessScopesCreated" | "accessScopesUpdated">> {
  const locations = await client.query<{ location_id: number }>(`
    SELECT location_id
    FROM ${schema}.barber_locations
    WHERE barber_id = $1 AND is_active = true
    ORDER BY location_id
  `, [professionalId]);
  if (locations.rows.length === 0) {
    throw new LegacyAuthBackfillCaseError("PROFESSIONAL_HAS_NO_ACTIVE_LOCATION");
  }

  let accessScopesCreated = 0;
  let accessScopesUpdated = 0;
  for (const { location_id: locationId } of locations.rows) {
    if (userId === null) {
      accessScopesCreated += 1;
      continue;
    }
    const existing = await client.query<{ id: number; preset_key: string | null }>(`
      SELECT id, preset_key
      FROM ${schema}.user_access_scopes
      WHERE user_id = $1 AND location_id = $2
    `, [userId, locationId]);
    if (existing.rows.length === 0) {
      if (apply) {
        await client.query(`
          INSERT INTO ${schema}.user_access_scopes (user_id, location_id, preset_key)
          VALUES ($1, $2, 'professional')
        `, [userId, locationId]);
      }
      accessScopesCreated += 1;
      continue;
    }
    if (existing.rows[0].preset_key === "professional") continue;
    if (existing.rows[0].preset_key !== null) {
      throw new LegacyAuthBackfillCaseError("INCOMPATIBLE_EXISTING_LOCATION_SCOPE");
    }
    if (apply) {
      await client.query(`
        UPDATE ${schema}.user_access_scopes
        SET preset_key = 'professional', updated_at = now()
        WHERE id = $1
      `, [existing.rows[0].id]);
    }
    accessScopesUpdated += 1;
  }
  return { accessScopesCreated, accessScopesUpdated };
}

async function processSafeIdentity(
  client: PoolClient,
  schemaName: string,
  originalCase: LegacyIdentityCase,
  now: Date,
  apply: boolean,
): Promise<{ delta: BackfillDelta; code: string }> {
  const schema = quoteDatabaseIdentifier(schemaName);
  await client.query(apply
    ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
    : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const snapshot = await collectLegacyAuthSnapshot(client, schemaName, now);
    const currentReport = buildLegacyAuthPreflightReport(snapshot);
    const currentCase = currentReport.cases.find((candidate) =>
      sameIds(candidate.adminIds, originalCase.adminIds)
      && sameIds(candidate.barberIds, originalCase.barberIds));
    if (!currentCase || currentCase.classification !== "SAFE_AUTO") {
      throw new LegacyAuthBackfillCaseError("SOURCE_CHANGED_SINCE_PREFLIGHT");
    }

    const identity = resolveCanonicalIdentity(currentCase, snapshot);
    if (!identity) {
      await client.query("ROLLBACK");
      return {
        code: "PROFESSIONAL_PROFILE_WITHOUT_LOGIN",
        delta: {
          usersCreated: 0,
          usersReused: 0,
          adminsLinked: 0,
          professionalsLinked: 0,
          accessScopesCreated: 0,
          accessScopesUpdated: 0,
        },
      };
    }

    const linkedUserIds = currentCase.linkedUserIds;
    if (linkedUserIds.length > 1) {
      throw new LegacyAuthBackfillCaseError("MULTIPLE_LINKED_CANONICAL_USERS");
    }
    const existingUser = await findCompatibleCanonicalUser(client, schema, identity, linkedUserIds);
    let userId = existingUser?.id ?? null;
    const usersCreated = existingUser ? 0 : 1;
    const usersReused = existingUser ? 1 : 0;

    if (!existingUser && apply) {
      const inserted = await client.query<{ id: number }>(`
        INSERT INTO ${schema}.users (
          display_name, username, email, password_hash, status
        ) VALUES ($1, $2, $3, $4, 'active')
        RETURNING id
      `, [identity.displayName, identity.username, identity.email, identity.passwordHash]);
      userId = inserted.rows[0].id;
    }

    const adminsLinked = identity.admin
      ? await linkLegacyRecord(client, schema, "admins", identity.admin.id, identity.admin.userId, userId, apply)
      : 0;
    const professionalsLinked = identity.professional
      ? await linkLegacyRecord(client, schema, "barbers", identity.professional.id, identity.professional.userId, userId, apply)
      : 0;

    const access = identity.admin
      ? await ensureAdministratorScope(client, schema, userId, apply)
      : identity.professional
        ? await ensureProfessionalScopes(client, schema, identity.professional.id, userId, apply)
        : { accessScopesCreated: 0, accessScopesUpdated: 0 };

    if (apply) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    return {
      code: existingUser ? "CANONICAL_USER_REUSED" : "CANONICAL_USER_CREATED",
      delta: {
        usersCreated,
        usersReused,
        adminsLinked,
        professionalsLinked,
        ...access,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function safeFailureCode(error: unknown) {
  if (error instanceof LegacyAuthBackfillCaseError) return error.code;
  const pgCode = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return pgCode ? `POSTGRES_${pgCode}` : "IDENTITY_TRANSACTION_FAILED";
}

export function parseLegacyAuthBackfillArgs(args: string[]) {
  const supported = new Set(["--apply", "--dry-run"]);
  const unknown = args.filter((argument) => !supported.has(argument));
  if (unknown.length > 0) throw new Error(`Unknown auth backfill argument: ${unknown.join(", ")}`);
  if (args.includes("--apply") && args.includes("--dry-run")) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }
  return { apply: args.includes("--apply") };
}

export async function runLegacyAuthBackfill(
  pool: Pool,
  options: { apply?: boolean; schemaName?: string; now?: Date } = {},
): Promise<LegacyAuthBackfillReport> {
  const apply = options.apply === true;
  const mode: BackfillMode = apply ? "apply" : "dry-run";
  const schemaName = options.schemaName?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  quoteDatabaseIdentifier(schemaName);
  const now = options.now ?? new Date();
  const client = await pool.connect();
  let lockAcquired = false;
  let preflightTransactionOpen = false;

  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [BACKFILL_LOCK_NAMESPACE, BACKFILL_LOCK_KEY],
    );
    lockAcquired = lock.rows[0]?.locked === true;
    if (!lockAcquired) throw new LegacyAuthBackfillLockedError();

    const foundation = await client.query<{ users_table: string | null; linked_tables: string }>(`
      SELECT
        to_regclass($1)::text AS users_table,
        count(DISTINCT table_name)::text AS linked_tables
      FROM information_schema.columns
      WHERE table_schema = $2
        AND table_name IN ('admins', 'barbers')
        AND column_name = 'user_id'
    `, [`${schemaName}.users`, schemaName]);
    if (!foundation.rows[0]?.users_table || Number(foundation.rows[0].linked_tables) !== 2) {
      throw new LegacyAuthBackfillFoundationError();
    }

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    preflightTransactionOpen = true;
    const snapshot = await collectLegacyAuthSnapshot(client, schemaName, now);
    const preflight = buildLegacyAuthPreflightReport(snapshot);
    await client.query("ROLLBACK");
    preflightTransactionOpen = false;

    const summary: LegacyAuthBackfillReport["summary"] = {
      ...preflight.classificationTotals,
      CREATED: 0,
      REUSED_USERS: 0,
      LINKED_ADMINS: 0,
      LINKED_PROFESSIONALS: 0,
      ACCESS_SCOPES_CREATED: 0,
      ACCESS_SCOPES_UPDATED: 0,
      WOULD_CREATE: 0,
      WOULD_LINK_ADMINS: 0,
      WOULD_LINK_PROFESSIONALS: 0,
      WOULD_CREATE_ACCESS_SCOPES: 0,
      WOULD_UPDATE_ACCESS_SCOPES: 0,
      UNCHANGED: 0,
      SKIPPED: 0,
      FAILED: 0,
    };
    const cases: LegacyAuthBackfillCaseResult[] = [];

    for (const authCase of preflight.cases) {
      const base = {
        key: authCase.key,
        displayName: authCase.displayName,
        classification: authCase.classification,
        adminIds: authCase.adminIds,
        professionalIds: authCase.barberIds,
        normalizedIdentifiers: authCase.normalizedIdentifiers,
      };
      if (authCase.classification !== "SAFE_AUTO") {
        summary.SKIPPED += 1;
        cases.push({ ...base, status: "skipped", code: authCase.classification });
        continue;
      }

      try {
        const result = await processSafeIdentity(client, schemaName, authCase, now, apply);
        if (result.code === "PROFESSIONAL_PROFILE_WITHOUT_LOGIN") {
          summary.SKIPPED += 1;
          cases.push({ ...base, status: "skipped", code: result.code });
          continue;
        }
        const mutations = result.delta.usersCreated
          + result.delta.adminsLinked
          + result.delta.professionalsLinked
          + result.delta.accessScopesCreated
          + result.delta.accessScopesUpdated;
        if (apply) {
          summary.CREATED += result.delta.usersCreated;
          summary.REUSED_USERS += result.delta.usersReused;
          summary.LINKED_ADMINS += result.delta.adminsLinked;
          summary.LINKED_PROFESSIONALS += result.delta.professionalsLinked;
          summary.ACCESS_SCOPES_CREATED += result.delta.accessScopesCreated;
          summary.ACCESS_SCOPES_UPDATED += result.delta.accessScopesUpdated;
          if (mutations === 0) summary.UNCHANGED += 1;
          cases.push({ ...base, status: mutations === 0 ? "unchanged" : "applied", code: result.code });
        } else {
          summary.WOULD_CREATE += result.delta.usersCreated;
          summary.WOULD_LINK_ADMINS += result.delta.adminsLinked;
          summary.WOULD_LINK_PROFESSIONALS += result.delta.professionalsLinked;
          summary.WOULD_CREATE_ACCESS_SCOPES += result.delta.accessScopesCreated;
          summary.WOULD_UPDATE_ACCESS_SCOPES += result.delta.accessScopesUpdated;
          if (mutations === 0) summary.UNCHANGED += 1;
          cases.push({ ...base, status: mutations === 0 ? "unchanged" : "planned", code: result.code });
        }
      } catch (error) {
        summary.FAILED += 1;
        cases.push({ ...base, status: "failed", code: safeFailureCode(error) });
      }
    }

    return {
      generatedAt: now.toISOString(),
      mode,
      atomicity: "one_transaction_per_identity",
      lock: "postgres_session_advisory_lock",
      stateMapping: {
        active: "Created only for an unambiguous legacy identity with a usable existing password hash.",
        invited: "Not inferred automatically; email-without-password remains MANUAL_REVIEW.",
        disabled: "Not inferred because legacy tables have no reliable disabled-login state.",
      },
      summary,
      review: preflight.cases.filter((authCase) => authCase.classification !== "SAFE_AUTO"),
      cases,
    };
  } finally {
    if (preflightTransactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [BACKFILL_LOCK_NAMESPACE, BACKFILL_LOCK_KEY])
        .catch(() => undefined);
    }
    client.release();
  }
}

export const legacyAuthBackfillLock = Object.freeze({
  namespace: BACKFILL_LOCK_NAMESPACE,
  key: BACKFILL_LOCK_KEY,
});
