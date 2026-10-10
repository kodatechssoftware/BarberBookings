import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  accessPresetKeys,
  canGrantCapabilityAtLocation,
  capabilityCodes,
  type CapabilityCode,
} from "@shared/auth";
import {
  buildLegacyAuthPreflightReport,
  collectLegacyAuthSnapshot,
  quoteDatabaseIdentifier,
  type LegacyAuthPreflightReport,
} from "./auth-legacy-preflight";
import { isBootstrapTokenConfigured } from "./auth-bootstrap";

export const requiredCanonicalCutoverMigrations = [
  "0015_auth_users_foundation.sql",
  "0016_blacklist_location_scope.sql",
] as const;

export type AuthCutoverIssue = {
  severity: "BLOCKER" | "WARNING";
  code: string;
  message: string;
  recordIds?: number[];
};

export type AuthCutoverReport = {
  generatedAt: string;
  readOnly: true;
  status: "READY" | "NOT_READY";
  checks: {
    migrations: {
      required: readonly string[];
      applied: string[];
      missing: string[];
    };
    preflight: LegacyAuthPreflightReport["classificationTotals"];
    legacyLinks: {
      unlinkedAdmins: number;
      unlinkedCredentialedProfessionals: number;
      mismatchedIdentityLinks: number;
    };
    users: {
      total: number;
      active: number;
      activeWithoutAccess: number;
      activeGlobalAdministrators: number;
    };
    normalizedLogins: { collisions: number };
    professionalLinks: {
      duplicateUsers: number;
      professionalPresetWithoutProfile: number;
    };
    access: {
      scopes: number;
      emptyScopes: number;
      invalidPresets: number;
      invalidCapabilities: number;
      invalidLocationCapabilities: number;
    };
    bootstrap: {
      closed: boolean;
      tokenStillConfigured: boolean;
    };
    sessions: LegacyAuthPreflightReport["inventory"]["sessions"];
  };
  issues: AuthCutoverIssue[];
};

type ScopeRow = QueryResultRow & {
  id: number;
  user_id: number;
  location_id: number | null;
  preset_key: string | null;
  capability_codes: string[];
};

function table(schema: string, name: string) {
  return `${quoteDatabaseIdentifier(schema)}.${quoteDatabaseIdentifier(name)}`;
}

function addIssue(
  issues: AuthCutoverIssue[],
  severity: AuthCutoverIssue["severity"],
  code: string,
  message: string,
  recordIds?: number[],
) {
  issues.push({ severity, code, message, ...(recordIds?.length ? { recordIds } : {}) });
}

async function relationExists(client: PoolClient, schema: string, relation: string) {
  const result = await client.query<{ relation: string | null }>(
    "SELECT to_regclass($1)::text AS relation",
    [`${schema}.${relation}`],
  );
  return Boolean(result.rows[0]?.relation);
}

export async function runAuthCutoverCheck(
  pool: Pool,
  options: {
    schemaName?: string;
    now?: Date;
    environment?: NodeJS.ProcessEnv;
  } = {},
): Promise<AuthCutoverReport> {
  const schema = options.schemaName?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  quoteDatabaseIdentifier(schema);
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const issues: AuthCutoverIssue[] = [];
    const migrationsTablePresent = await relationExists(client, schema, "schema_migrations");
    const applied = migrationsTablePresent
      ? (await client.query<{ name: string }>(`
          SELECT name FROM ${table(schema, "schema_migrations")}
          WHERE name = ANY($1::text[]) ORDER BY name
        `, [requiredCanonicalCutoverMigrations])).rows.map((row) => row.name)
      : [];
    const missing = requiredCanonicalCutoverMigrations.filter((name) => !applied.includes(name));
    if (missing.length > 0) {
      addIssue(issues, "BLOCKER", "MIGRATIONS_MISSING", `Missing required migrations: ${missing.join(", ")}.`);
    }

    const preflight = buildLegacyAuthPreflightReport(
      await collectLegacyAuthSnapshot(client, schema, now),
    );
    if (preflight.classificationTotals.BLOCKER > 0) {
      addIssue(issues, "BLOCKER", "LEGACY_BLOCKERS", "Legacy auth preflight still contains BLOCKER cases.");
    }
    if (preflight.classificationTotals.MANUAL_REVIEW > 0) {
      addIssue(issues, "BLOCKER", "LEGACY_MANUAL_REVIEW", "Legacy auth preflight still contains MANUAL_REVIEW cases.");
    }

    const foundationRelations = ["users", "user_access_scopes", "user_access_scope_capabilities"];
    let foundationReady = true;
    // A PoolClient serializes one connection; keep catalogue reads sequential
    // instead of relying on pg's deprecated concurrent query queue.
    for (const name of foundationRelations) {
      if (!(await relationExists(client, schema, name))) foundationReady = false;
    }
    const linkageColumns = await client.query<{ linked_tables: number }>(`
      SELECT count(DISTINCT table_name)::integer AS linked_tables
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('admins', 'barbers')
        AND column_name = 'user_id'
    `, [schema]);
    if (Number(linkageColumns.rows[0]?.linked_tables ?? 0) !== 2) foundationReady = false;

    let unlinkedAdmins = 0;
    let unlinkedCredentialedProfessionals = 0;
    let mismatchedIdentityLinks = 0;
    let userTotal = 0;
    let activeUsers = 0;
    let activeWithoutAccess = 0;
    let activeGlobalAdministrators = 0;
    let loginCollisions = 0;
    let duplicateProfessionalUsers = 0;
    let professionalPresetWithoutProfile = 0;
    let scopeCount = 0;
    let emptyScopes = 0;
    let invalidPresets = 0;
    let invalidCapabilities = 0;
    let invalidLocationCapabilities = 0;

    if (!foundationReady) {
      addIssue(issues, "BLOCKER", "CANONICAL_FOUNDATION_MISSING", "Canonical auth tables are not available.");
    } else {
      const linkSummary = (await client.query<{
        unlinked_admins: number;
        unlinked_professionals: number;
        mismatched_links: number;
      }>(`
        SELECT
          (SELECT count(*)::integer FROM ${table(schema, "admins")} WHERE user_id IS NULL) AS unlinked_admins,
          (SELECT count(*)::integer FROM ${table(schema, "barbers")}
            WHERE email IS NOT NULL AND btrim(email) <> ''
              AND password IS NOT NULL AND btrim(password) <> ''
              AND user_id IS NULL) AS unlinked_professionals,
          (
            SELECT count(*)::integer FROM (
              SELECT admin.id
              FROM ${table(schema, "admins")} admin
              JOIN ${table(schema, "users")} canonical_user ON canonical_user.id = admin.user_id
              WHERE NOT (
                canonical_user.email_key IN (lower(btrim(admin.username)), lower(btrim(coalesce(admin.email, ''))))
                OR canonical_user.username_key IN (lower(btrim(admin.username)), lower(btrim(coalesce(admin.email, ''))))
              )
              UNION ALL
              SELECT professional.id
              FROM ${table(schema, "barbers")} professional
              JOIN ${table(schema, "users")} canonical_user ON canonical_user.id = professional.user_id
              WHERE professional.email IS NOT NULL AND btrim(professional.email) <> ''
                AND canonical_user.email_key <> lower(btrim(professional.email))
                AND canonical_user.username_key IS DISTINCT FROM lower(btrim(professional.email))
            ) mismatched
          ) AS mismatched_links
      `)).rows[0];
      unlinkedAdmins = Number(linkSummary.unlinked_admins);
      unlinkedCredentialedProfessionals = Number(linkSummary.unlinked_professionals);
      mismatchedIdentityLinks = Number(linkSummary.mismatched_links);
      if (unlinkedAdmins > 0 || unlinkedCredentialedProfessionals > 0) {
        addIssue(issues, "BLOCKER", "LEGACY_LOGIN_NOT_LINKED", "Legacy identities with login credentials remain unlinked.");
      }
      if (mismatchedIdentityLinks > 0) {
        addIssue(issues, "BLOCKER", "LEGACY_LINK_IDENTITY_MISMATCH", "Legacy records are linked to a different canonical login identity.");
      }

      const userSummary = (await client.query<{
        total: number;
        active: number;
        active_without_access: number;
        active_global_administrators: number;
      }>(`
        SELECT
          count(*)::integer AS total,
          count(*) FILTER (WHERE canonical_user.status = 'active')::integer AS active,
          count(*) FILTER (
            WHERE canonical_user.status = 'active'
              AND NOT EXISTS (
                SELECT 1 FROM ${table(schema, "user_access_scopes")} scope
                WHERE scope.user_id = canonical_user.id
              )
          )::integer AS active_without_access,
          count(*) FILTER (
            WHERE canonical_user.status = 'active'
              AND EXISTS (
                SELECT 1 FROM ${table(schema, "user_access_scopes")} scope
                WHERE scope.user_id = canonical_user.id
                  AND scope.location_id IS NULL
                  AND scope.preset_key = 'administrator'
              )
          )::integer AS active_global_administrators
        FROM ${table(schema, "users")} canonical_user
      `)).rows[0];
      userTotal = Number(userSummary.total);
      activeUsers = Number(userSummary.active);
      activeWithoutAccess = Number(userSummary.active_without_access);
      activeGlobalAdministrators = Number(userSummary.active_global_administrators);
      if (activeWithoutAccess > 0) {
        addIssue(issues, "BLOCKER", "ACTIVE_USERS_WITHOUT_ACCESS", "Active canonical users without any access scope exist.");
      }
      if (activeGlobalAdministrators < 1) {
        addIssue(issues, "BLOCKER", "NO_ACTIVE_GLOBAL_ADMINISTRATOR", "No active global Administrator exists.");
      }

      const collisionRows = await client.query<{ left_id: number; right_id: number }>(`
        SELECT left_user.id AS left_id, right_user.id AS right_id
        FROM ${table(schema, "users")} left_user
        JOIN ${table(schema, "users")} right_user ON left_user.id < right_user.id
        WHERE left_user.email_key = right_user.username_key
           OR left_user.username_key = right_user.email_key
      `);
      loginCollisions = collisionRows.rows.length;
      if (loginCollisions > 0) {
        addIssue(
          issues,
          "BLOCKER",
          "CANONICAL_LOGIN_COLLISION",
          "Canonical email/username keys collide across users.",
          Array.from(new Set(collisionRows.rows.flatMap((row) => [Number(row.left_id), Number(row.right_id)]))),
        );
      }

      const duplicateRows = await client.query<{ user_id: number }>(`
        SELECT user_id
        FROM ${table(schema, "barbers")}
        WHERE user_id IS NOT NULL
        GROUP BY user_id HAVING count(*) > 1
      `);
      duplicateProfessionalUsers = duplicateRows.rows.length;
      if (duplicateProfessionalUsers > 0) {
        addIssue(issues, "BLOCKER", "PROFESSIONAL_LINK_NOT_ONE_TO_ONE", "A canonical user is linked to multiple Professionals.");
      }

      const scopeRows = (await client.query<ScopeRow>(`
        SELECT
          scope.id,
          scope.user_id,
          scope.location_id,
          scope.preset_key,
          coalesce(array_agg(capability.capability_code ORDER BY capability.capability_code)
            FILTER (WHERE capability.capability_code IS NOT NULL), ARRAY[]::text[]) AS capability_codes
        FROM ${table(schema, "user_access_scopes")} scope
        LEFT JOIN ${table(schema, "user_access_scope_capabilities")} capability
          ON capability.access_scope_id = scope.id
        GROUP BY scope.id
        ORDER BY scope.id
      `)).rows;
      scopeCount = scopeRows.length;
      const presetSet = new Set<string>(accessPresetKeys);
      const capabilitySet = new Set<string>(capabilityCodes);
      for (const scope of scopeRows) {
        if (!scope.preset_key && scope.capability_codes.length === 0) emptyScopes += 1;
        if (scope.preset_key && (
          !presetSet.has(scope.preset_key)
          || (scope.preset_key === "administrator" && scope.location_id !== null)
        )) invalidPresets += 1;
        for (const code of scope.capability_codes) {
          if (!capabilitySet.has(code)) {
            invalidCapabilities += 1;
          } else if (scope.location_id !== null && !canGrantCapabilityAtLocation(code as CapabilityCode)) {
            invalidLocationCapabilities += 1;
          }
        }
      }
      if (emptyScopes > 0) addIssue(issues, "BLOCKER", "EMPTY_ACCESS_SCOPES", "Access scopes without a preset or explicit capability exist.");
      if (invalidPresets > 0) addIssue(issues, "BLOCKER", "INVALID_ACCESS_PRESETS", "Unknown access presets exist.");
      if (invalidCapabilities > 0) addIssue(issues, "BLOCKER", "INVALID_CAPABILITIES", "Unknown explicit capabilities exist.");
      if (invalidLocationCapabilities > 0) addIssue(issues, "BLOCKER", "GLOBAL_CAPABILITY_AT_LOCATION", "Installation-wide capabilities exist in location scopes.");

      const professionalPreset = await client.query<{ user_id: number }>(`
        SELECT DISTINCT scope.user_id
        FROM ${table(schema, "user_access_scopes")} scope
        WHERE scope.preset_key = 'professional'
          AND NOT EXISTS (
            SELECT 1 FROM ${table(schema, "barbers")} professional
            WHERE professional.user_id = scope.user_id
          )
      `);
      professionalPresetWithoutProfile = professionalPreset.rows.length;
      if (professionalPresetWithoutProfile > 0) {
        addIssue(issues, "BLOCKER", "PROFESSIONAL_ACCESS_WITHOUT_PROFILE", "Professional access presets exist without a linked Professional profile.");
      }
    }

    const bootstrapClosed = userTotal > 0;
    if (!bootstrapClosed) {
      addIssue(issues, "BLOCKER", "BOOTSTRAP_STILL_OPEN", "No canonical user exists; bootstrap is still open.");
    }
    const bootstrapTokenConfigured = isBootstrapTokenConfigured(options.environment);
    if (bootstrapClosed && bootstrapTokenConfigured) {
      addIssue(issues, "WARNING", "BOOTSTRAP_TOKEN_STILL_CONFIGURED", "Remove BOOTSTRAP_ADMIN_TOKEN after confirming cutover readiness.");
    }
    if (preflight.inventory.sessions.active > 0) {
      addIssue(issues, "WARNING", "ACTIVE_LEGACY_SESSIONS", "Active legacy sessions will require reauthentication at cutover.");
    }

    const report: AuthCutoverReport = {
      generatedAt: now.toISOString(),
      readOnly: true,
      status: issues.some((issue) => issue.severity === "BLOCKER") ? "NOT_READY" : "READY",
      checks: {
        migrations: { required: requiredCanonicalCutoverMigrations, applied, missing },
        preflight: preflight.classificationTotals,
        legacyLinks: { unlinkedAdmins, unlinkedCredentialedProfessionals, mismatchedIdentityLinks },
        users: { total: userTotal, active: activeUsers, activeWithoutAccess, activeGlobalAdministrators },
        normalizedLogins: { collisions: loginCollisions },
        professionalLinks: { duplicateUsers: duplicateProfessionalUsers, professionalPresetWithoutProfile },
        access: {
          scopes: scopeCount,
          emptyScopes,
          invalidPresets,
          invalidCapabilities,
          invalidLocationCapabilities,
        },
        bootstrap: { closed: bootstrapClosed, tokenStillConfigured: bootstrapTokenConfigured },
        sessions: preflight.inventory.sessions,
      },
      issues,
    };
    await client.query("ROLLBACK");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
