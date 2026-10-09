import type { Pool, PoolClient } from "pg";

export const legacyAuthPreflightClassifications = [
  "SAFE_AUTO",
  "MANUAL_REVIEW",
  "BLOCKER",
] as const;

export type LegacyAuthPreflightClassification =
  (typeof legacyAuthPreflightClassifications)[number];

export type LegacyAdminCredential = {
  id: number;
  username: string;
  email: string | null;
  passwordHash: string;
  userId?: number | null;
};

export type LegacyBarberCredential = {
  id: number;
  name: string;
  email: string | null;
  passwordHash: string | null;
  userId?: number | null;
};

export type LegacyBarberInvite = {
  id: number;
  barberId: number;
  expiresAt: Date;
  usedAt: Date | null;
};

export type LegacySessionInventory = {
  tablePresent: boolean;
  total: number;
  active: number;
  activeAdmin: number;
  activeBarber: number;
  activeUnknownRole: number;
};

export type LegacyIdentityCase = {
  key: string;
  displayName: string;
  classification: LegacyAuthPreflightClassification;
  normalizedIdentifiers: string[];
  adminIds: number[];
  barberIds: number[];
  linkedUserIds: number[];
  credentialComparison: "none" | "single" | "literal_equal" | "different";
  reasons: string[];
  proposedAction: string;
};

type Collision = {
  identifier: string;
  adminIds: number[];
  barberIds: number[];
};

export type LegacyAuthPreflightReport = {
  generatedAt: string;
  readOnly: true;
  inventory: {
    admins: {
      total: number;
      withoutEmail: number;
      usernameNotEmail: number;
    };
    barbers: {
      total: number;
      withEmailAndPassword: number;
      withEmailWithoutPassword: number;
      withPasswordWithoutEmail: number;
      withoutCredential: number;
    };
    invites: {
      total: number;
      pending: number;
      expired: number;
      accepted: number;
    };
    sessions: LegacySessionInventory;
  };
  collisions: {
    duplicateAdminUsernames: Collision[];
    duplicateAdminEmails: Collision[];
    duplicateBarberEmails: Collision[];
    adminUsernameVsAdminEmail: Collision[];
    adminUsernameVsBarberEmail: Collision[];
    adminEmailVsBarberEmail: Collision[];
  };
  credentialMatches: {
    literalEqual: number;
    different: number;
    note: string;
  };
  classificationTotals: Record<LegacyAuthPreflightClassification, number>;
  cases: LegacyIdentityCase[];
};

export function normalizeIdentity(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() || "";
  return normalized || null;
}

export function isUsableEmail(value: string | null) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export function nonempty(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function groupedCollisions(
  entries: Array<{ identifier: string | null; adminId?: number; barberId?: number }>,
  predicate: (adminIds: number[], barberIds: number[]) => boolean,
) {
  const grouped = new Map<string, { admins: Set<number>; barbers: Set<number> }>();
  for (const entry of entries) {
    if (!entry.identifier) continue;
    const group = grouped.get(entry.identifier) ?? { admins: new Set(), barbers: new Set() };
    if (entry.adminId !== undefined) group.admins.add(entry.adminId);
    if (entry.barberId !== undefined) group.barbers.add(entry.barberId);
    grouped.set(entry.identifier, group);
  }

  return Array.from(grouped.entries())
    .map(([identifier, group]) => ({
      identifier,
      adminIds: Array.from(group.admins).sort((a, b) => a - b),
      barberIds: Array.from(group.barbers).sort((a, b) => a - b),
    }))
    .filter((entry) => predicate(entry.adminIds, entry.barberIds))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
}

class DisjointSet {
  private readonly parents = new Map<string, string>();

  add(value: string) {
    if (!this.parents.has(value)) this.parents.set(value, value);
  }

  find(value: string): string {
    const parent = this.parents.get(value);
    if (!parent) throw new Error(`Unknown legacy identity node: ${value}`);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }

  union(left: string, right: string) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents.set(rightRoot, leftRoot);
  }
}

function classifyComponent(
  admins: LegacyAdminCredential[],
  barbers: LegacyBarberCredential[],
  identifiers: string[],
): LegacyIdentityCase {
  const blockerReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (admins.length > 1) blockerReasons.push("multiple_admin_records_share_an_identity");
  if (barbers.length > 1) blockerReasons.push("multiple_professional_records_share_an_identity");

  const linkedUserIds = Array.from(new Set(
    [...admins, ...barbers]
      .map((record) => record.userId)
      .filter((userId): userId is number => typeof userId === "number"),
  )).sort((a, b) => a - b);
  if (linkedUserIds.length > 1) blockerReasons.push("legacy_identity_links_multiple_canonical_users");

  const adminsWithoutPassword = admins.filter((admin) => !nonempty(admin.passwordHash));
  if (adminsWithoutPassword.length > 0) blockerReasons.push("admin_has_no_usable_password_hash");

  const barbersWithPasswordWithoutEmail = barbers.filter(
    (barber) => nonempty(barber.passwordHash) && !isUsableEmail(normalizeIdentity(barber.email)),
  );
  if (barbersWithPasswordWithoutEmail.length > 0) {
    blockerReasons.push("professional_has_password_without_usable_email");
  }

  const canonicalEmails = new Set<string>();
  for (const admin of admins) {
    const email = normalizeIdentity(admin.email);
    const username = normalizeIdentity(admin.username);
    if (email && isUsableEmail(email)) canonicalEmails.add(email);
    if (username && isUsableEmail(username)) canonicalEmails.add(username);
    if (email && !isUsableEmail(email)) reviewReasons.push("admin_email_is_invalid");
    if (!email && !isUsableEmail(username)) reviewReasons.push("admin_requires_canonical_email");
  }
  for (const barber of barbers) {
    const email = normalizeIdentity(barber.email);
    if (email && isUsableEmail(email)) canonicalEmails.add(email);
    if (email && !isUsableEmail(email)) reviewReasons.push("professional_email_is_invalid");
    if (email && !nonempty(barber.passwordHash)) reviewReasons.push("professional_email_has_no_password");
  }
  if (canonicalEmails.size > 1 && admins.length > 0 && barbers.length > 0) {
    reviewReasons.push("linked_legacy_records_have_multiple_candidate_emails");
  }

  const hashes = [
    ...admins.map((admin) => admin.passwordHash).filter(nonempty),
    ...barbers.map((barber) => barber.passwordHash).filter(nonempty),
  ] as string[];
  const distinctHashes = new Set(hashes);
  const credentialComparison = hashes.length === 0
    ? "none"
    : hashes.length === 1
      ? "single"
      : distinctHashes.size === 1
        ? "literal_equal"
        : "different";
  if (credentialComparison === "different" && admins.length > 0 && barbers.length > 0) {
    reviewReasons.push("shared_identity_has_different_literal_hashes");
  }

  const professionalOnlyWithoutCredential = admins.length === 0
    && barbers.length === 1
    && !normalizeIdentity(barbers[0].email)
    && !nonempty(barbers[0].passwordHash);

  const classification: LegacyAuthPreflightClassification = blockerReasons.length > 0
    ? "BLOCKER"
    : reviewReasons.length > 0
      ? "MANUAL_REVIEW"
      : "SAFE_AUTO";
  const reasons = Array.from(new Set([...blockerReasons, ...reviewReasons]));
  if (reasons.length === 0) {
    reasons.push(professionalOnlyWithoutCredential
      ? "professional_profile_without_login_can_remain_unlinked"
      : admins.length > 0 && barbers.length > 0
        ? "legacy_records_have_one_unambiguous_identity"
        : "single_unambiguous_legacy_identity");
  }

  const key = identifiers[0]
    ?? (admins[0] ? `admin:${admins[0].id}` : `barber:${barbers[0].id}`);

  return {
    key,
    displayName: barbers[0]?.name.trim() || admins[0]?.username.trim() || key,
    classification,
    normalizedIdentifiers: identifiers,
    adminIds: admins.map((admin) => admin.id).sort((a, b) => a - b),
    barberIds: barbers.map((barber) => barber.id).sort((a, b) => a - b),
    linkedUserIds,
    credentialComparison,
    reasons,
    proposedAction: classification === "BLOCKER"
      ? "Stop before backfill and resolve the contradictory legacy data."
      : classification === "MANUAL_REVIEW"
        ? "Review identity and credential choice; do not merge automatically."
        : professionalOnlyWithoutCredential
          ? "Keep the professional profile without creating a User."
          : "Eligible for a controlled P2B backfill after explicit approval.",
  };
}

export function buildLegacyAuthPreflightReport(input: {
  admins: LegacyAdminCredential[];
  barbers: LegacyBarberCredential[];
  invites: LegacyBarberInvite[];
  sessions?: LegacySessionInventory;
  now?: Date;
}): LegacyAuthPreflightReport {
  const now = input.now ?? new Date();
  const nodes = new Map<string, { admin?: LegacyAdminCredential; barber?: LegacyBarberCredential }>();
  const nodeIdentifiers = new Map<string, string[]>();
  const identifierNodes = new Map<string, string[]>();
  const disjointSet = new DisjointSet();

  const registerNode = (
    node: string,
    value: { admin?: LegacyAdminCredential; barber?: LegacyBarberCredential },
    identifiers: Array<string | null>,
  ) => {
    disjointSet.add(node);
    nodes.set(node, value);
    const normalized = Array.from(new Set(identifiers.filter((item): item is string => Boolean(item))));
    nodeIdentifiers.set(node, normalized);
    for (const identifier of normalized) {
      const matchingNodes = identifierNodes.get(identifier) ?? [];
      for (const matchingNode of matchingNodes) disjointSet.union(node, matchingNode);
      matchingNodes.push(node);
      identifierNodes.set(identifier, matchingNodes);
    }
  };

  for (const admin of input.admins) {
    registerNode(`admin:${admin.id}`, { admin }, [
      normalizeIdentity(admin.username),
      normalizeIdentity(admin.email),
    ]);
  }
  for (const barber of input.barbers) {
    registerNode(`barber:${barber.id}`, { barber }, [normalizeIdentity(barber.email)]);
  }

  const components = new Map<string, string[]>();
  for (const node of Array.from(nodes.keys())) {
    const root = disjointSet.find(node);
    const component = components.get(root) ?? [];
    component.push(node);
    components.set(root, component);
  }

  const cases = Array.from(components.values()).map((componentNodes) => {
    const admins = componentNodes.flatMap((node) => nodes.get(node)?.admin ? [nodes.get(node)!.admin!] : []);
    const barbers = componentNodes.flatMap((node) => nodes.get(node)?.barber ? [nodes.get(node)!.barber!] : []);
    const identifiers = Array.from(new Set(componentNodes.flatMap((node) => nodeIdentifiers.get(node) ?? []))).sort();
    return classifyComponent(admins, barbers, identifiers);
  }).sort((a, b) => a.key.localeCompare(b.key));

  const adminUsernameEntries = input.admins.map((admin) => ({
    identifier: normalizeIdentity(admin.username), adminId: admin.id,
  }));
  const adminEmailEntries = input.admins.map((admin) => ({
    identifier: normalizeIdentity(admin.email), adminId: admin.id,
  }));
  const barberEmailEntries = input.barbers.map((barber) => ({
    identifier: normalizeIdentity(barber.email), barberId: barber.id,
  }));

  const classificationTotals = Object.fromEntries(
    legacyAuthPreflightClassifications.map((classification) => [
      classification,
      cases.filter((entry) => entry.classification === classification).length,
    ]),
  ) as Record<LegacyAuthPreflightClassification, number>;

  return {
    generatedAt: now.toISOString(),
    readOnly: true,
    inventory: {
      admins: {
        total: input.admins.length,
        withoutEmail: input.admins.filter((admin) => !normalizeIdentity(admin.email)).length,
        usernameNotEmail: input.admins.filter((admin) => !isUsableEmail(normalizeIdentity(admin.username))).length,
      },
      barbers: {
        total: input.barbers.length,
        withEmailAndPassword: input.barbers.filter((barber) => normalizeIdentity(barber.email) && nonempty(barber.passwordHash)).length,
        withEmailWithoutPassword: input.barbers.filter((barber) => normalizeIdentity(barber.email) && !nonempty(barber.passwordHash)).length,
        withPasswordWithoutEmail: input.barbers.filter((barber) => !normalizeIdentity(barber.email) && nonempty(barber.passwordHash)).length,
        withoutCredential: input.barbers.filter((barber) => !normalizeIdentity(barber.email) && !nonempty(barber.passwordHash)).length,
      },
      invites: {
        total: input.invites.length,
        pending: input.invites.filter((invite) => !invite.usedAt && invite.expiresAt > now).length,
        expired: input.invites.filter((invite) => !invite.usedAt && invite.expiresAt <= now).length,
        accepted: input.invites.filter((invite) => Boolean(invite.usedAt)).length,
      },
      sessions: input.sessions ?? {
        tablePresent: false,
        total: 0,
        active: 0,
        activeAdmin: 0,
        activeBarber: 0,
        activeUnknownRole: 0,
      },
    },
    collisions: {
      duplicateAdminUsernames: groupedCollisions(adminUsernameEntries, (admins) => admins.length > 1),
      duplicateAdminEmails: groupedCollisions(adminEmailEntries, (admins) => admins.length > 1),
      duplicateBarberEmails: groupedCollisions(barberEmailEntries, (_admins, barbers) => barbers.length > 1),
      adminUsernameVsAdminEmail: groupedCollisions(
        [...adminUsernameEntries, ...adminEmailEntries],
        (admins) => admins.length > 1,
      ),
      adminUsernameVsBarberEmail: groupedCollisions(
        [...adminUsernameEntries, ...barberEmailEntries],
        (admins, barbers) => admins.length > 0 && barbers.length > 0,
      ),
      adminEmailVsBarberEmail: groupedCollisions(
        [...adminEmailEntries, ...barberEmailEntries],
        (admins, barbers) => admins.length > 0 && barbers.length > 0,
      ),
    },
    credentialMatches: {
      literalEqual: cases.filter((entry) => entry.credentialComparison === "literal_equal").length,
      different: cases.filter((entry) => entry.credentialComparison === "different").length,
      note: "Different bcrypt strings are ambiguous because salts differ; no password equivalence is inferred.",
    },
    classificationTotals,
    cases,
  };
}

export function quoteDatabaseIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function collectSessionInventory(
  client: PoolClient,
  schemaName: string,
): Promise<LegacySessionInventory> {
  const qualifiedName = `${schemaName}.session`;
  const exists = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass($1)::text AS table_name",
    [qualifiedName],
  );
  if (!exists.rows[0]?.table_name) {
    return { tablePresent: false, total: 0, active: 0, activeAdmin: 0, activeBarber: 0, activeUnknownRole: 0 };
  }

  const table = `${quoteDatabaseIdentifier(schemaName)}.${quoteDatabaseIdentifier("session")}`;
  const result = await client.query<{
    total: string;
    active: string;
    active_admin: string;
    active_barber: string;
    active_unknown_role: string;
  }>(`
    SELECT
      count(*)::text AS total,
      count(*) FILTER (WHERE expire > now())::text AS active,
      count(*) FILTER (WHERE expire > now() AND sess->>'role' = 'admin')::text AS active_admin,
      count(*) FILTER (WHERE expire > now() AND sess->>'role' = 'barber')::text AS active_barber,
      count(*) FILTER (WHERE expire > now() AND coalesce(sess->>'role', '') NOT IN ('admin', 'barber'))::text AS active_unknown_role
    FROM ${table}
  `);
  const row = result.rows[0];
  return {
    tablePresent: true,
    total: Number(row.total),
    active: Number(row.active),
    activeAdmin: Number(row.active_admin),
    activeBarber: Number(row.active_barber),
    activeUnknownRole: Number(row.active_unknown_role),
  };
}

export async function collectLegacyAuthSnapshot(
  client: PoolClient,
  schemaName: string,
  now: Date,
) {
  const schema = quoteDatabaseIdentifier(schemaName);
  const linkageColumns = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name IN ('admins', 'barbers')
      AND column_name = 'user_id'
  `, [schemaName]);
  const tablesWithUserId = new Set(linkageColumns.rows.map((row) => row.table_name));
  const adminUserIdExpression = tablesWithUserId.has("admins") ? "user_id" : "NULL::integer";
  const barberUserIdExpression = tablesWithUserId.has("barbers") ? "user_id" : "NULL::integer";
  // A PoolClient serializes work on one connection. Keep these reads
  // explicitly sequential so the snapshot stays consistent without relying
  // on the deprecated concurrent client.query() queueing behaviour in pg.
  const adminsResult = await client.query<LegacyAdminCredential>(`
      SELECT id, username, email, password AS "passwordHash", ${adminUserIdExpression} AS "userId"
      FROM ${schema}.admins
      ORDER BY id
  `);
  const barbersResult = await client.query<LegacyBarberCredential>(`
      SELECT id, name, email, password AS "passwordHash", ${barberUserIdExpression} AS "userId"
      FROM ${schema}.barbers
      ORDER BY id
  `);
  const invitesResult = await client.query<LegacyBarberInvite>(`
      SELECT id, barber_id AS "barberId", expires_at AS "expiresAt", used_at AS "usedAt"
      FROM ${schema}.barber_invites
      ORDER BY id
  `);
  const sessions = await collectSessionInventory(client, schemaName);

  return {
    admins: adminsResult.rows,
    barbers: barbersResult.rows,
    invites: invitesResult.rows,
    sessions,
    now,
  };
}

export async function runLegacyAuthPreflight(
  pool: Pool,
  options: { schemaName?: string; now?: Date } = {},
) {
  const schemaName = options.schemaName?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  quoteDatabaseIdentifier(schemaName);
  const now = options.now ?? new Date();
  const client = await pool.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = await collectLegacyAuthSnapshot(client, schemaName, now);

    const report = buildLegacyAuthPreflightReport(snapshot);
    await client.query("ROLLBACK");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
