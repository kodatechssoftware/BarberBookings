import type { Pool, PoolClient } from "pg";

export const BEAUTY_DEMO_SEED_KEY = "beauty-demo:ana-isabel:v1";
export const BEAUTY_DEMO_CONFIRMATION = "beauty-dev";
export const BEAUTY_DEMO_PROFESSIONAL_EMAIL = "ana.isabel.demo@beauty-demo.invalid";
const BEAUTY_DEMO_MANIFEST_ACTION = "beauty_demo_seed.manifest";

const requiredMigrations = [
  "0017_service_buffers.sql",
  "0018_recurring_expense_management.sql",
] as const;

const categoryDefinitions = [
  { key: "manicure", name: "Manicure & Verniz", sortOrder: 0 },
  { key: "gel", name: "Gel & Extensões", sortOrder: 1 },
  { key: "pedicure", name: "Pedicure", sortOrder: 2 },
] as const;

const serviceDefinitions = [
  { key: "manicure", category: "manicure", name: "Manicure simples", agendaLabel: "Manicure", description: "Cuidado completo das unhas com acabamento natural.", price: 1_500, duration: 30, before: 0, after: 5 },
  { key: "verniz", category: "manicure", name: "Verniz Gel", agendaLabel: "Verniz Gel", description: "Aplicação de verniz gel com preparação cuidada da unha.", price: 2_200, duration: 60, before: 5, after: 10 },
  { key: "verniz_remocao", category: "manicure", name: "Verniz Gel + remoção", agendaLabel: "Gel + remoção", description: "Remoção segura e nova aplicação de verniz gel.", price: 2_700, duration: 75, before: 10, after: 10 },
  { key: "aplicacao_gel", category: "gel", name: "Aplicação de Gel", agendaLabel: "Aplicação Gel", description: "Aplicação completa de gel com formato personalizado.", price: 3_500, duration: 90, before: 10, after: 15 },
  { key: "manutencao_gel", category: "gel", name: "Manutenção de Gel", agendaLabel: "Manutenção Gel", description: "Manutenção, equilíbrio e acabamento de unhas de gel.", price: 3_000, duration: 75, before: 10, after: 10 },
  { key: "extensao", category: "gel", name: "Extensão de unhas", agendaLabel: "Extensão", description: "Extensão de unhas com construção e acabamento personalizado.", price: 4_000, duration: 120, before: 15, after: 15 },
  { key: "pedicure", category: "pedicure", name: "Pedicure", agendaLabel: "Pedicure", description: "Cuidado de pés e unhas com acabamento profissional.", price: 2_500, duration: 60, before: 10, after: 10 },
] as const;

const extraDefinitions = [
  { key: "francesa", name: "Francesa", pricingMode: "fixed", amountCents: 300, sortOrder: 0 },
  { key: "baby_boomer", name: "Baby Boomer", pricingMode: "fixed", amountCents: 500, sortOrder: 1 },
  { key: "nail_art_simples", name: "Nail Art simples", pricingMode: "fixed", amountCents: 200, sortOrder: 2 },
  { key: "nail_art_elaborada", name: "Nail Art elaborada", pricingMode: "fixed", amountCents: 500, sortOrder: 3 },
  { key: "decoracao_unha", name: "Decoração por unha", pricingMode: "variable", amountCents: null, sortOrder: 4 },
  { key: "reparacao", name: "Reparação de unha", pricingMode: "fixed", amountCents: 200, sortOrder: 5 },
] as const;

const customerDefinitions = [
  ["marta", "Marta Demo", "marta.demo@beauty-demo.invalid", "+351000000101"],
  ["sofia", "Sofia Exemplo", "sofia.exemplo@beauty-demo.invalid", "+351000000102"],
  ["ines", "Inês Amostra", "ines.amostra@beauty-demo.invalid", "+351000000103"],
  ["beatriz", "Beatriz Demo", "beatriz.demo@beauty-demo.invalid", "+351000000104"],
  ["carolina", "Carolina Exemplo", "carolina.exemplo@beauty-demo.invalid", "+351000000105"],
  ["leonor", "Leonor Amostra", "leonor.amostra@beauty-demo.invalid", "+351000000106"],
  ["mariana", "Mariana Demo", "mariana.demo@beauty-demo.invalid", "+351000000107"],
  ["joana", "Joana Exemplo", "joana.exemplo@beauty-demo.invalid", "+351000000108"],
  ["rita", "Rita Amostra", "rita.amostra@beauty-demo.invalid", "+351000000109"],
  ["catarina", "Catarina Demo", "catarina.demo@beauty-demo.invalid", "+351000000110"],
] as const;

type DemoStatus = "booked" | "completed" | "cancelled" | "late_cancelled" | "no_show";
type DemoPayment = "pending" | "cash" | "card";
type ExtraKey = typeof extraDefinitions[number]["key"];
type ServiceKey = typeof serviceDefinitions[number]["key"];
type CustomerKey = typeof customerDefinitions[number][0];

type AppointmentDefinition = {
  offset: number;
  time: string;
  service: ServiceKey;
  customer: CustomerKey;
  status: DemoStatus;
  payment: DemoPayment;
  extras?: Array<{ key: ExtraKey; amountCents?: number }>;
  rescheduleRevision?: number;
};

const appointmentDefinitions: readonly AppointmentDefinition[] = [
  { offset: -28, time: "10:00", service: "manicure", customer: "marta", status: "completed", payment: "cash" },
  { offset: -27, time: "14:30", service: "verniz", customer: "sofia", status: "completed", payment: "card", extras: [{ key: "francesa" }] },
  { offset: -23, time: "09:30", service: "aplicacao_gel", customer: "ines", status: "completed", payment: "card", extras: [{ key: "nail_art_elaborada" }] },
  { offset: -21, time: "15:00", service: "pedicure", customer: "beatriz", status: "completed", payment: "cash" },
  { offset: -19, time: "10:00", service: "manutencao_gel", customer: "carolina", status: "completed", payment: "card", extras: [{ key: "reparacao" }] },
  { offset: -16, time: "11:00", service: "verniz", customer: "leonor", status: "completed", payment: "cash" },
  { offset: -14, time: "14:00", service: "extensao", customer: "mariana", status: "completed", payment: "card", extras: [{ key: "baby_boomer" }] },
  { offset: -13, time: "09:30", service: "aplicacao_gel", customer: "joana", status: "completed", payment: "card", extras: [{ key: "nail_art_elaborada" }] },
  { offset: -13, time: "14:30", service: "verniz_remocao", customer: "rita", status: "completed", payment: "cash", extras: [{ key: "francesa" }] },
  { offset: -12, time: "09:30", service: "manicure", customer: "joana", status: "completed", payment: "cash", extras: [{ key: "nail_art_simples" }] },
  { offset: -10, time: "16:30", service: "extensao", customer: "catarina", status: "completed", payment: "card", extras: [{ key: "baby_boomer" }] },
  { offset: -10, time: "14:30", service: "verniz", customer: "marta", status: "completed", payment: "cash", extras: [{ key: "nail_art_elaborada" }] },
  { offset: -9, time: "10:00", service: "verniz_remocao", customer: "rita", status: "completed", payment: "card" },
  { offset: -8, time: "10:00", service: "manutencao_gel", customer: "sofia", status: "completed", payment: "card", extras: [{ key: "reparacao" }] },
  { offset: -8, time: "15:00", service: "pedicure", customer: "catarina", status: "completed", payment: "cash" },
  { offset: -7, time: "09:30", service: "manutencao_gel", customer: "marta", status: "completed", payment: "card", extras: [{ key: "francesa" }] },
  { offset: -7, time: "14:00", service: "aplicacao_gel", customer: "beatriz", status: "completed", payment: "cash", extras: [{ key: "baby_boomer" }] },
  { offset: -6, time: "09:30", service: "extensao", customer: "carolina", status: "completed", payment: "card", extras: [{ key: "nail_art_elaborada" }] },
  { offset: -6, time: "14:30", service: "manicure", customer: "sofia", status: "cancelled", payment: "pending" },
  { offset: -5, time: "09:15", service: "pedicure", customer: "leonor", status: "completed", payment: "cash", extras: [{ key: "nail_art_simples" }] },
  { offset: -5, time: "11:00", service: "verniz", customer: "ines", status: "no_show", payment: "pending" },
  { offset: -5, time: "12:15", service: "manicure", customer: "beatriz", status: "late_cancelled", payment: "pending" },
  { offset: -3, time: "14:15", service: "verniz", customer: "carolina", status: "completed", payment: "cash", extras: [{ key: "nail_art_simples" }] },
  { offset: -3, time: "15:45", service: "manicure", customer: "leonor", status: "completed", payment: "card" },
  { offset: -3, time: "17:00", service: "manutencao_gel", customer: "mariana", status: "completed", payment: "card" },
  { offset: -2, time: "09:15", service: "pedicure", customer: "joana", status: "completed", payment: "cash" },
  { offset: -2, time: "10:45", service: "verniz_remocao", customer: "rita", status: "completed", payment: "card", extras: [{ key: "francesa" }] },
  { offset: -2, time: "14:00", service: "extensao", customer: "catarina", status: "completed", payment: "card", extras: [{ key: "nail_art_elaborada" }] },
  { offset: -1, time: "09:30", service: "manicure", customer: "marta", status: "completed", payment: "cash" },
  { offset: -1, time: "10:30", service: "verniz", customer: "sofia", status: "completed", payment: "card", extras: [{ key: "baby_boomer" }] },
  { offset: -1, time: "14:30", service: "manutencao_gel", customer: "ines", status: "completed", payment: "cash", extras: [{ key: "reparacao" }] },
  { offset: 0, time: "09:30", service: "verniz", customer: "beatriz", status: "completed", payment: "card", extras: [{ key: "decoracao_unha", amountCents: 300 }] },
  { offset: 0, time: "11:15", service: "aplicacao_gel", customer: "carolina", status: "cancelled", payment: "pending" },
  { offset: 0, time: "14:30", service: "aplicacao_gel", customer: "leonor", status: "booked", payment: "pending", extras: [{ key: "nail_art_simples" }] },
  { offset: 1, time: "09:15", service: "manicure", customer: "mariana", status: "booked", payment: "pending" },
  { offset: 1, time: "10:15", service: "verniz_remocao", customer: "joana", status: "booked", payment: "pending", extras: [{ key: "francesa" }] },
  { offset: 1, time: "14:00", service: "pedicure", customer: "rita", status: "booked", payment: "pending" },
  { offset: 2, time: "09:30", service: "extensao", customer: "catarina", status: "booked", payment: "pending", extras: [{ key: "baby_boomer" }] },
  { offset: 2, time: "12:00", service: "manicure", customer: "marta", status: "booked", payment: "pending", extras: [{ key: "decoracao_unha", amountCents: 200 }] },
  { offset: 4, time: "14:30", service: "manutencao_gel", customer: "sofia", status: "booked", payment: "pending", rescheduleRevision: 1 },
  { offset: 4, time: "16:30", service: "verniz", customer: "ines", status: "booked", payment: "pending", extras: [{ key: "nail_art_simples" }] },
  { offset: 5, time: "10:00", service: "aplicacao_gel", customer: "beatriz", status: "booked", payment: "pending" },
] as const;

const weeklySchedule = [
  { dayOfWeek: 1, startTime: "14:00", endTime: "20:00" },
  ...[2, 3, 4, 5].flatMap((dayOfWeek) => [
    { dayOfWeek, startTime: "09:00", endTime: "13:00" },
    { dayOfWeek, startTime: "14:00", endTime: "20:00" },
  ]),
  { dayOfWeek: 6, startTime: "09:00", endTime: "13:00" },
  { dayOfWeek: 6, startTime: "14:00", endTime: "19:00" },
] as const;

type ScheduleEntry = { dayOfWeek: number; startTime: string; endTime: string };
type BeautyDemoManifest = {
  version: 1;
  seedKey: typeof BEAUTY_DEMO_SEED_KEY;
  referenceDate: string;
  locationId: number;
  professionalId: number;
  createdShopAvailabilityIds: number[];
  reusedShopAvailabilityIds: number[];
};

export type BeautyDemoSeedMode = "dry-run" | "apply" | "cleanup";

export type BeautyDemoSeedOptions = {
  mode: BeautyDemoSeedMode;
  referenceDate: string;
  confirmation?: string;
  schemaName?: string;
  environment?: Record<string, string | undefined>;
};

export type BeautyDemoSeedSummary = {
  mode: BeautyDemoSeedMode;
  state: "planned" | "applied" | "already-applied" | "cleaned" | "already-clean";
  referenceDate: string;
  locationId: number;
  professional: number;
  categories: number;
  services: number;
  extras: number;
  appointments: number;
  appointmentStates: Record<DemoStatus, number>;
  completedRevenueCents: number;
  projectedRevenueCents: number;
  cashCents: number;
  cardCents: number;
  completedExtrasCents: number;
  recurringSeries: number;
  recurringVersions: number;
  expenses: number;
  periodExpenseCents: number;
  notifications: number;
};

export class BeautyDemoSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeautyDemoSeedError";
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new BeautyDemoSeedError(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BeautyDemoSeedError("Reference date must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BeautyDemoSeedError("Reference date is invalid.");
  }
  if (date.getUTCDay() !== 4) {
    throw new BeautyDemoSeedError("Reference date must be a Thursday so the deterministic weekly demo remains coherent.");
  }
  return date;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthDate(dateKey: string, monthOffset: number, day: number) {
  const [year, month] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + monthOffset, day)).toISOString().slice(0, 10);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(timeZone: string) {
  const existing = formatterCache.get(timeZone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function localDateTimeToInstant(dateKey: string, timeKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeKey.split(":").map(Number);
  const targetTimestamp = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidateTimestamp = targetTimestamp;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      dateTimeFormatter(timeZone).formatToParts(new Date(candidateTimestamp)).map((part) => [part.type, part.value]),
    );
    const representedTimestamp = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) break;
    candidateTimestamp -= difference;
  }
  return new Date(candidateTimestamp);
}

function validateEnvironment(options: BeautyDemoSeedOptions) {
  const environment = options.environment ?? process.env;
  if (environment.BUSINESS_VERTICAL?.trim().toLowerCase() !== "beauty") {
    throw new BeautyDemoSeedError("Beauty demo seed requires BUSINESS_VERTICAL=beauty.");
  }
  if (environment.AUTH_RUNTIME_MODE?.trim().toLowerCase() !== "canonical") {
    throw new BeautyDemoSeedError("Beauty demo seed requires AUTH_RUNTIME_MODE=canonical.");
  }
  if (environment.APP_ENV?.trim().toLowerCase() !== "development") {
    throw new BeautyDemoSeedError("Beauty demo seed requires APP_ENV=development.");
  }
  if (environment.DEMO_MODE?.trim().toLowerCase() === "true") {
    throw new BeautyDemoSeedError("Beauty demo seed cannot run with the legacy DEMO_MODE enabled.");
  }
  if (options.mode !== "dry-run" && options.confirmation !== BEAUTY_DEMO_CONFIRMATION) {
    throw new BeautyDemoSeedError(`Apply/cleanup requires --confirm ${BEAUTY_DEMO_CONFIRMATION}.`);
  }
}

function expectedAppointmentStates(): Record<DemoStatus, number> {
  return appointmentDefinitions.reduce<Record<DemoStatus, number>>((counts, appointment) => {
    counts[appointment.status] += 1;
    return counts;
  }, { booked: 0, completed: 0, cancelled: 0, late_cancelled: 0, no_show: 0 });
}

function expectedMoney() {
  const services = new Map(serviceDefinitions.map((service) => [service.key, service]));
  const extras = new Map(extraDefinitions.map((extra) => [extra.key, extra]));
  let completedRevenueCents = 0;
  let projectedRevenueCents = 0;
  let cashCents = 0;
  let cardCents = 0;
  let completedExtrasCents = 0;
  for (const appointment of appointmentDefinitions) {
    const service = services.get(appointment.service)!;
    const extrasCents = (appointment.extras ?? []).reduce((sum, item) => (
      sum + (item.amountCents ?? extras.get(item.key)!.amountCents ?? 0)
    ), 0);
    const total = service.price + extrasCents;
    if (appointment.status === "completed") {
      completedRevenueCents += total;
      completedExtrasCents += extrasCents;
      if (appointment.payment === "cash") cashCents += total;
      if (appointment.payment === "card") cardCents += total;
    }
    if (appointment.status === "booked") projectedRevenueCents += total;
  }
  return { completedRevenueCents, projectedRevenueCents, cashCents, cardCents, completedExtrasCents };
}

function plannedSummary(mode: BeautyDemoSeedMode, state: BeautyDemoSeedSummary["state"], referenceDate: string, locationId: number): BeautyDemoSeedSummary {
  return {
    mode,
    state,
    referenceDate,
    locationId,
    professional: state === "cleaned" || state === "already-clean" ? 0 : 1,
    categories: state === "cleaned" || state === "already-clean" ? 0 : categoryDefinitions.length,
    services: state === "cleaned" || state === "already-clean" ? 0 : serviceDefinitions.length,
    extras: state === "cleaned" || state === "already-clean" ? 0 : extraDefinitions.length,
    appointments: state === "cleaned" || state === "already-clean" ? 0 : appointmentDefinitions.length,
    appointmentStates: state === "cleaned" || state === "already-clean"
      ? { booked: 0, completed: 0, cancelled: 0, late_cancelled: 0, no_show: 0 }
      : expectedAppointmentStates(),
    ...(state === "cleaned" || state === "already-clean"
      ? { completedRevenueCents: 0, projectedRevenueCents: 0, cashCents: 0, cardCents: 0, completedExtrasCents: 0 }
      : expectedMoney()),
    recurringSeries: state === "cleaned" || state === "already-clean" ? 0 : 3,
    recurringVersions: state === "cleaned" || state === "already-clean" ? 0 : 4,
    expenses: state === "cleaned" || state === "already-clean" ? 0 : 8,
    periodExpenseCents: state === "cleaned" || state === "already-clean" ? 0 : 50_950,
    notifications: 0,
  };
}

async function scalarCount(client: PoolClient, query: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(query, values);
  return Number(result.rows[0]?.count ?? 0);
}

function sortedSchedule(entries: readonly ScheduleEntry[]) {
  return [...entries].sort((left, right) => (
    left.dayOfWeek - right.dayOfWeek
    || left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
  ));
}

function scheduleMatches(entries: readonly ScheduleEntry[]) {
  const actual = sortedSchedule(entries);
  const expected = sortedSchedule(weeklySchedule);
  return actual.length === expected.length && actual.every((entry, index) => (
    entry.dayOfWeek === expected[index].dayOfWeek
    && entry.startTime === expected[index].startTime
    && entry.endTime === expected[index].endTime
  ));
}

async function resolveLocationSchedule(client: PoolClient, schema: string, locationId: number) {
  const result = await client.query<{
    id: number; day_of_week: number; start_time: string; end_time: string; is_open: boolean;
  }>(`
    SELECT id, day_of_week, start_time, end_time, is_open
    FROM ${schema}.shop_availability
    WHERE location_id = $1
    ORDER BY day_of_week, start_time, end_time, id
  `, [locationId]);
  if (result.rows.length === 0) {
    return { shouldCreate: true, reusedIds: [] as number[] };
  }
  const openRows = result.rows.filter((row) => row.is_open);
  if (!scheduleMatches(openRows.map((row) => ({
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  })))) {
    throw new BeautyDemoSeedError(
      "Existing location hours do not match the approved Beauty demo schedule; refusing to overwrite them.",
    );
  }
  return { shouldCreate: false, reusedIds: openRows.map((row) => row.id) };
}

function parseManifest(raw: string): BeautyDemoManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    throw new BeautyDemoSeedError("Beauty demo ownership manifest is invalid JSON.");
  }
  const candidate = manifest as Partial<BeautyDemoManifest>;
  if (candidate.version !== 1 || candidate.seedKey !== BEAUTY_DEMO_SEED_KEY
    || typeof candidate.referenceDate !== "string" || !Number.isInteger(candidate.locationId)
    || !Number.isInteger(candidate.professionalId)
    || !Array.isArray(candidate.createdShopAvailabilityIds)
    || !candidate.createdShopAvailabilityIds.every(Number.isInteger)
    || !Array.isArray(candidate.reusedShopAvailabilityIds)
    || !candidate.reusedShopAvailabilityIds.every(Number.isInteger)) {
    throw new BeautyDemoSeedError("Beauty demo ownership manifest has an unsupported shape.");
  }
  return candidate as BeautyDemoManifest;
}

async function findManifest(client: PoolClient, schema: string, locationId: number) {
  const result = await client.query<{ id: number; metadata: string | null }>(`
    SELECT id, metadata
    FROM ${schema}.audit_logs
    WHERE action = $1 AND entity_type = 'beauty_demo_seed' AND location_id = $2
    ORDER BY id
  `, [BEAUTY_DEMO_MANIFEST_ACTION, locationId]);
  if (result.rows.length > 1) throw new BeautyDemoSeedError("Duplicate Beauty demo ownership manifests found.");
  const row = result.rows[0];
  if (!row) return null;
  if (!row.metadata) throw new BeautyDemoSeedError("Beauty demo ownership manifest has no metadata.");
  return { id: row.id, manifest: parseManifest(row.metadata) };
}

async function assertDatabaseFoundation(client: PoolClient, schema: string) {
  const rows = await client.query<{ name: string }>(
    `SELECT name FROM ${schema}.schema_migrations WHERE name = ANY($1::text[]) ORDER BY name`,
    [[...requiredMigrations]],
  );
  const present = new Set(rows.rows.map((row) => row.name));
  for (const migration of requiredMigrations) {
    if (!present.has(migration)) throw new BeautyDemoSeedError(`Required migration is not applied: ${migration}.`);
  }

  const locations = await client.query<{ id: number; timezone: string; is_active: boolean; is_default: boolean }>(
    `SELECT id, timezone, is_active, is_default FROM ${schema}.locations ORDER BY id`,
  );
  if (locations.rows.length !== 1 || !locations.rows[0].is_active || !locations.rows[0].is_default) {
    throw new BeautyDemoSeedError("Beauty demo seed requires exactly one active default location.");
  }
  return locations.rows[0];
}

async function findSeedProfessional(client: PoolClient, schema: string) {
  const rows = await client.query<{ id: number }>(
    `SELECT id FROM ${schema}.barbers WHERE lower(btrim(email)) = lower($1)`,
    [BEAUTY_DEMO_PROFESSIONAL_EMAIL],
  );
  if ((rows.rowCount ?? rows.rows.length) > 1) throw new BeautyDemoSeedError("Duplicate Beauty demo professional identities found.");
  return rows.rows[0]?.id ?? null;
}

async function assertNoCollisions(client: PoolClient, schema: string, locationId: number) {
  const checks = [
    await scalarCount(client, `SELECT count(*) FROM ${schema}.service_categories WHERE name = ANY($1::text[])`, [categoryDefinitions.map((item) => item.name)]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.services WHERE name = ANY($1::text[])`, [serviceDefinitions.map((item) => item.name)]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.extra_definitions WHERE location_id = $1 AND name = ANY($2::text[])`, [locationId, extraDefinitions.map((item) => item.name)]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.appointments WHERE cancel_token LIKE $1`, [`${BEAUTY_DEMO_SEED_KEY}:appointment:%`]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.business_expense_recurring_series WHERE creation_key LIKE $1`, [`${BEAUTY_DEMO_SEED_KEY}:expense:%`]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.business_expenses WHERE notes = $1`, [BEAUTY_DEMO_SEED_KEY]),
    await scalarCount(client, `SELECT count(*) FROM ${schema}.audit_logs WHERE action = $1 AND entity_type = 'beauty_demo_seed' AND location_id = $2`, [BEAUTY_DEMO_MANIFEST_ACTION, locationId]),
  ];
  if (checks.some((count) => count !== 0)) {
    throw new BeautyDemoSeedError("Seed-owned names, keys or ownership metadata already exist without the seed identity; refusing a partial or ambiguous apply.");
  }
  await resolveLocationSchedule(client, schema, locationId);
}

async function protectedCounts(client: PoolClient, schema: string) {
  return {
    users: await scalarCount(client, `SELECT count(*) FROM ${schema}.users`),
    admins: await scalarCount(client, `SELECT count(*) FROM ${schema}.admins`),
    invites: await scalarCount(client, `SELECT count(*) FROM ${schema}.user_invites`),
    blacklist: await scalarCount(client, `SELECT count(*) FROM ${schema}.blacklist`),
  };
}

function sameProtectedCounts(left: Awaited<ReturnType<typeof protectedCounts>>, right: Awaited<ReturnType<typeof protectedCounts>>) {
  return Object.keys(left).every((key) => left[key as keyof typeof left] === right[key as keyof typeof right]);
}

async function validateAppliedState(client: PoolClient, schema: string, locationId: number, referenceDate: string, barberId: number) {
  const ownership = await findManifest(client, schema, locationId);
  if (!ownership || ownership.manifest.referenceDate !== referenceDate
    || ownership.manifest.locationId !== locationId
    || ownership.manifest.professionalId !== barberId) {
    throw new BeautyDemoSeedError("Beauty demo ownership manifest is missing or does not match the dataset.");
  }
  const identity = await client.query<{
    name: string; specialty: string; user_id: number | null; password: string | null; is_visible: boolean;
  }>(`SELECT name, specialty, user_id, password, is_visible FROM ${schema}.barbers WHERE id = $1`, [barberId]);
  const professional = identity.rows[0];
  if (!professional || professional.name !== "Ana Isabel" || professional.specialty !== "Nail Artist & Designer"
    || professional.user_id !== null || professional.password !== null || !professional.is_visible) {
    throw new BeautyDemoSeedError("Beauty demo professional no longer matches the seed manifest.");
  }

  const categoryCount = await scalarCount(client, `SELECT count(*) FROM ${schema}.service_categories WHERE name = ANY($1::text[])`, [categoryDefinitions.map((item) => item.name)]);
  const serviceCount = await scalarCount(client, `SELECT count(*) FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  const extraCount = await scalarCount(client, `SELECT count(*) FROM ${schema}.extra_definitions WHERE location_id = $1 AND name = ANY($2::text[])`, [locationId, extraDefinitions.map((item) => item.name)]);
  const barberAvailabilityCount = await scalarCount(client, `SELECT count(*) FROM ${schema}.barber_availability WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  const locationAssignmentCount = await scalarCount(client, `SELECT count(*) FROM ${schema}.barber_locations WHERE barber_id = $1 AND location_id = $2 AND is_active = true`, [barberId, locationId]);
  if (categoryCount !== categoryDefinitions.length || serviceCount !== serviceDefinitions.length
    || extraCount !== extraDefinitions.length || barberAvailabilityCount !== weeklySchedule.length
    || locationAssignmentCount !== 1) {
    throw new BeautyDemoSeedError("Beauty demo catalogue, assignment or schedule is incomplete.");
  }

  const shopHours = await client.query<{ id: number; day_of_week: number; start_time: string; end_time: string; is_open: boolean }>(`
    SELECT id, day_of_week, start_time, end_time, is_open
    FROM ${schema}.shop_availability
    WHERE location_id = $1
    ORDER BY day_of_week, start_time, end_time
  `, [locationId]);
  const openHours = shopHours.rows.filter((row) => row.is_open);
  if (!scheduleMatches(openHours.map((row) => ({
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  })))) throw new BeautyDemoSeedError("Location hours no longer match the Beauty demo seed manifest.");
  const manifestHourIds = [
    ...ownership.manifest.createdShopAvailabilityIds,
    ...ownership.manifest.reusedShopAvailabilityIds,
  ].sort((left, right) => left - right);
  const currentHourIds = openHours.map((row) => row.id).sort((left, right) => left - right);
  if (new Set(manifestHourIds).size !== manifestHourIds.length
    || JSON.stringify(manifestHourIds) !== JSON.stringify(currentHourIds)) {
    throw new BeautyDemoSeedError("Location-hour ownership no longer matches the Beauty demo seed manifest.");
  }

  const statusRows = await client.query<{ status: DemoStatus; count: string }>(`
    SELECT status, count(*)::text AS count
    FROM ${schema}.appointments
    WHERE barber_id = $1 AND cancel_token LIKE $2
    GROUP BY status
  `, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  const states: Record<DemoStatus, number> = { booked: 0, completed: 0, cancelled: 0, late_cancelled: 0, no_show: 0 };
  for (const row of statusRows.rows) states[row.status] = Number(row.count);
  if (JSON.stringify(states) !== JSON.stringify(expectedAppointmentStates())) {
    throw new BeautyDemoSeedError("Beauty demo appointment states no longer match the seed manifest.");
  }
  const totalForBarber = await scalarCount(client, `SELECT count(*) FROM ${schema}.appointments WHERE barber_id = $1`, [barberId]);
  if (totalForBarber !== appointmentDefinitions.length) {
    throw new BeautyDemoSeedError("The demo professional is referenced by appointments outside the seed; refusing to treat the dataset as idempotent.");
  }

  const money = await client.query<{
    completed_revenue_cents: string; projected_revenue_cents: string; cash_cents: string; card_cents: string; extras_cents: string;
  }>(`
    WITH seed_appointments AS (
      SELECT appointment.*,
        COALESCE((SELECT sum(extra.amount_cents_snapshot) FROM ${schema}.appointment_extras extra WHERE extra.appointment_id = appointment.id), 0) AS extras_cents
      FROM ${schema}.appointments appointment
      WHERE appointment.barber_id = $1 AND appointment.cancel_token LIKE $2
    )
    SELECT
      COALESCE(sum(service_price_cents_snapshot + extras_cents) FILTER (WHERE status = 'completed'), 0)::text AS completed_revenue_cents,
      COALESCE(sum(service_price_cents_snapshot + extras_cents) FILTER (WHERE status = 'booked'), 0)::text AS projected_revenue_cents,
      COALESCE(sum(service_price_cents_snapshot + extras_cents) FILTER (WHERE status = 'completed' AND payment_method = 'cash'), 0)::text AS cash_cents,
      COALESCE(sum(service_price_cents_snapshot + extras_cents) FILTER (WHERE status = 'completed' AND payment_method = 'card'), 0)::text AS card_cents,
      COALESCE(sum(extras_cents) FILTER (WHERE status = 'completed'), 0)::text AS extras_cents
    FROM seed_appointments
  `, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  const actualMoney = {
    completedRevenueCents: Number(money.rows[0].completed_revenue_cents),
    projectedRevenueCents: Number(money.rows[0].projected_revenue_cents),
    cashCents: Number(money.rows[0].cash_cents),
    cardCents: Number(money.rows[0].card_cents),
    completedExtrasCents: Number(money.rows[0].extras_cents),
  };
  if (JSON.stringify(actualMoney) !== JSON.stringify(expectedMoney())) {
    throw new BeautyDemoSeedError("Beauty demo financial totals no longer match the seed manifest.");
  }

  const recurringSeries = await scalarCount(client, `SELECT count(*) FROM ${schema}.business_expense_recurring_series WHERE location_id = $1 AND creation_key LIKE $2`, [locationId, `${BEAUTY_DEMO_SEED_KEY}:expense:%`]);
  const recurringVersions = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.business_expense_recurring_versions version
    JOIN ${schema}.business_expense_recurring_series series ON series.id = version.series_id
    WHERE series.location_id = $1 AND series.creation_key LIKE $2
  `, [locationId, `${BEAUTY_DEMO_SEED_KEY}:expense:%`]);
  const expenses = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.business_expenses expense
    LEFT JOIN ${schema}.business_expense_recurring_series series ON series.id = expense.recurring_series_id
    WHERE (expense.location_id = $1 AND expense.notes = $2)
      OR (series.location_id = $1 AND series.creation_key LIKE $3)
  `, [locationId, BEAUTY_DEMO_SEED_KEY, `${BEAUTY_DEMO_SEED_KEY}:expense:%`]);
  const periodStart = localDateTimeToInstant(monthDate(referenceDate, 0, 1), "00:00", "Europe/Lisbon");
  const periodEnd = localDateTimeToInstant(monthDate(referenceDate, 1, 1), "00:00", "Europe/Lisbon");
  const periodExpenseRows = await client.query<{ total: string }>(`
    SELECT COALESCE(sum(expense.amount_cents), 0)::text AS total
    FROM ${schema}.business_expenses expense
    LEFT JOIN ${schema}.business_expense_recurring_series series ON series.id = expense.recurring_series_id
    WHERE expense.expense_date >= $1 AND expense.expense_date < $2
      AND ((expense.location_id = $3 AND expense.notes = $4)
        OR (series.location_id = $3 AND series.creation_key LIKE $5))
  `, [periodStart, periodEnd, locationId, BEAUTY_DEMO_SEED_KEY, `${BEAUTY_DEMO_SEED_KEY}:expense:%`]);
  if (recurringSeries !== 3 || recurringVersions !== 4 || expenses !== 8 || Number(periodExpenseRows.rows[0].total) !== 50_950) {
    throw new BeautyDemoSeedError("Beauty demo recurring or one-off expenses no longer match the seed manifest.");
  }

  const notifications = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.appointment_notification_events event
    JOIN ${schema}.appointments appointment ON appointment.id = event.appointment_id
    WHERE appointment.barber_id = $1 AND appointment.cancel_token LIKE $2
  `, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  const messages = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.whatsapp_messages message
    JOIN ${schema}.appointments appointment ON appointment.id = message.appointment_id
    WHERE appointment.barber_id = $1 AND appointment.cancel_token LIKE $2
  `, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  if (notifications !== 0 || messages !== 0) {
    throw new BeautyDemoSeedError("Beauty demo appointments unexpectedly created notification/outbox data.");
  }

  return plannedSummary("apply", "applied", referenceDate, locationId);
}

async function insertDataset(client: PoolClient, schema: string, location: { id: number; timezone: string }, referenceDate: string) {
  const locationSchedule = await resolveLocationSchedule(client, schema, location.id);
  const categoryIds = new Map<string, number>();
  for (const category of categoryDefinitions) {
    const result = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.service_categories (name, sort_order, is_active)
      VALUES ($1, $2, true) RETURNING id
    `, [category.name, category.sortOrder]);
    categoryIds.set(category.key, result.rows[0].id);
  }

  const professionalResult = await client.query<{ id: number }>(`
    INSERT INTO ${schema}.barbers (name, specialty, bio, avatar, email, password, user_id, color, is_visible)
    VALUES ($1, $2, $3, NULL, $4, NULL, NULL, $5, true)
    RETURNING id
  `, [
    "Ana Isabel",
    "Nail Artist & Designer",
    "Especialista em manicure, gel e nail art personalizada, com atenção a cada detalhe.",
    BEAUTY_DEMO_PROFESSIONAL_EMAIL,
    "#C98291",
  ]);
  const barberId = professionalResult.rows[0].id;
  await client.query(`INSERT INTO ${schema}.barber_locations (barber_id, location_id, is_active) VALUES ($1, $2, true)`, [barberId, location.id]);

  const serviceIds = new Map<string, number>();
  for (const service of serviceDefinitions) {
    const result = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.services (name, description, agenda_label, price, duration, is_visible, category_id)
      VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id
    `, [service.name, service.description, service.agendaLabel, service.price, service.duration, categoryIds.get(service.category)]);
    const serviceId = result.rows[0].id;
    serviceIds.set(service.key, serviceId);
    await client.query(`
      INSERT INTO ${schema}.service_locations (
        service_id, location_id, is_active, price_override, duration_override,
        buffer_before_minutes, buffer_after_minutes
      ) VALUES ($1, $2, true, NULL, NULL, $3, $4)
    `, [serviceId, location.id, service.before, service.after]);
    await client.query(`INSERT INTO ${schema}.barber_services (barber_id, service_id, location_id) VALUES ($1, $2, $3)`, [barberId, serviceId, location.id]);
  }

  const extraIds = new Map<string, number>();
  for (const extra of extraDefinitions) {
    const result = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.extra_definitions (
        location_id, name, pricing_mode, amount_cents, financial_rule, is_active, sort_order
      ) VALUES ($1, $2, $3, $4, 'establishment', true, $5) RETURNING id
    `, [location.id, extra.name, extra.pricingMode, extra.amountCents, extra.sortOrder]);
    extraIds.set(extra.key, result.rows[0].id);
  }

  const createdShopAvailabilityIds: number[] = [];
  for (const hours of weeklySchedule) {
    if (locationSchedule.shouldCreate) {
      const insertedHours = await client.query<{ id: number }>(`
        INSERT INTO ${schema}.shop_availability (location_id, day_of_week, start_time, end_time, is_open)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id
      `, [location.id, hours.dayOfWeek, hours.startTime, hours.endTime]);
      createdShopAvailabilityIds.push(insertedHours.rows[0].id);
    }
    await client.query(`
      INSERT INTO ${schema}.barber_availability (location_id, barber_id, day_of_week, start_time, end_time, is_working)
      VALUES ($1, $2, $3, $4, $5, true)
    `, [location.id, barberId, hours.dayOfWeek, hours.startTime, hours.endTime]);
  }

  const compensationResult = await client.query<{ id: number }>(`
    INSERT INTO ${schema}.barber_compensation_rules (
      barber_id, location_id, model, commission_percent, chair_rent_cents, chair_rent_period, effective_from
    ) VALUES ($1, $2, 'none', NULL, NULL, NULL, $3) RETURNING id
  `, [barberId, location.id, localDateTimeToInstant(addDays(referenceDate, -60), "00:00", location.timezone)]);
  const compensationRuleId = compensationResult.rows[0].id;

  const services = new Map(serviceDefinitions.map((service) => [service.key, service]));
  const extras = new Map(extraDefinitions.map((extra) => [extra.key, extra]));
  const customers = new Map(customerDefinitions.map(([key, name, email, phone]) => [key, { name, email, phone }]));
  for (let index = 0; index < appointmentDefinitions.length; index += 1) {
    const appointment = appointmentDefinitions[index];
    const service = services.get(appointment.service)!;
    const customer = customers.get(appointment.customer)!;
    const dateKey = addDays(referenceDate, appointment.offset);
    const startTime = localDateTimeToInstant(dateKey, appointment.time, location.timezone);
    const cancelledAt = ["cancelled", "late_cancelled"].includes(appointment.status)
      ? new Date(startTime.getTime() - (appointment.status === "late_cancelled" ? 2 : 24) * 60 * 60 * 1_000)
      : null;
    const createdAt = new Date(Math.min(
      startTime.getTime() - 3 * 24 * 60 * 60 * 1_000,
      localDateTimeToInstant(addDays(referenceDate, -1), "12:00", location.timezone).getTime(),
    ));
    const result = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_email, customer_phone,
        duration_minutes, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
        service_name_snapshot, service_price_cents_snapshot,
        compensation_rule_id_snapshot, compensation_model_snapshot,
        commission_percent_snapshot, chair_rent_cents_snapshot, chair_rent_period_snapshot,
        manual_outside_hours, status, cancel_token, cancelled_at, payment_method,
        deposit_required, deposit_reason, reschedule_revision, notification_revision,
        whatsapp_opt_in, whatsapp_opt_in_at, series_id, series_occurrence_index, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, NULL, NULL, NULL,
        false, $15, $16, $17, $18,
        false, NULL, $19, 0,
        false, NULL, NULL, NULL, $20
      ) RETURNING id
    `, [
      location.id, barberId, serviceIds.get(appointment.service), startTime,
      customer.name, customer.email, customer.phone,
      service.duration, service.before, service.after, service.name, service.price,
      appointment.status === "completed" ? compensationRuleId : null,
      appointment.status === "completed" ? "none" : null,
      appointment.status, `${BEAUTY_DEMO_SEED_KEY}:appointment:${String(index + 1).padStart(3, "0")}`,
      cancelledAt, appointment.payment, appointment.rescheduleRevision ?? 0, createdAt,
    ]);
    const appointmentId = result.rows[0].id;
    for (let position = 0; position < (appointment.extras?.length ?? 0); position += 1) {
      const selected = appointment.extras![position];
      const definition = extras.get(selected.key)!;
      await client.query(`
        INSERT INTO ${schema}.appointment_extras (
          appointment_id, extra_definition_id, name_snapshot, amount_cents_snapshot,
          financial_rule_snapshot, position
        ) VALUES ($1, $2, $3, $4, 'establishment', $5)
      `, [appointmentId, extraIds.get(selected.key), definition.name, selected.amountCents ?? definition.amountCents, position]);
    }
  }

  const recurringDefinitions = [
    { key: "rent", date: monthDate(referenceDate, -1, 1), category: "rent", description: "Renda", amount: 30_000, monthDay: 1 },
    { key: "internet", date: monthDate(referenceDate, -1, 5), category: "internet", description: "Internet", amount: 2_500, monthDay: 5 },
    { key: "electricity", date: monthDate(referenceDate, -1, 10), category: "utilities", description: "Eletricidade", amount: 6_500, monthDay: 10 },
  ] as const;
  for (const recurring of recurringDefinitions) {
    const series = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.business_expense_recurring_series (
        location_id, creation_key, status, anchor_date, ended_on
      ) VALUES ($1, $2, 'active', $3, NULL) RETURNING id
    `, [location.id, `${BEAUTY_DEMO_SEED_KEY}:expense:${recurring.key}`, recurring.date]);
    const version = await client.query<{ id: number }>(`
      INSERT INTO ${schema}.business_expense_recurring_versions (
        series_id, effective_from, category, description, amount_cents, recurrence,
        weekday, month_day, notes
      ) VALUES ($1, $2, $3, $4, $5, 'monthly', NULL, $6, $7) RETURNING id
    `, [series.rows[0].id, recurring.date, recurring.category, recurring.description, recurring.amount, recurring.monthDay, BEAUTY_DEMO_SEED_KEY]);
    for (const scheduledDate of [recurring.date, monthDate(referenceDate, 0, recurring.monthDay)]) {
      await client.query(`
        INSERT INTO ${schema}.business_expenses (
          location_id, category, description, amount_cents, expense_date, recurrence, notes,
          recurring_series_id, recurring_version_id, scheduled_date, is_occurrence_override
        ) VALUES ($1, $2, $3, $4, $5, 'monthly', $6, $7, $8, $9, false)
      `, [
        location.id, recurring.category, recurring.description, recurring.amount,
        localDateTimeToInstant(scheduledDate, "00:00", location.timezone), BEAUTY_DEMO_SEED_KEY,
        series.rows[0].id, version.rows[0].id, scheduledDate,
      ]);
    }
    if (recurring.key === "rent") {
      const futureDate = monthDate(referenceDate, 1, 1);
      await client.query(`
        INSERT INTO ${schema}.business_expense_recurring_versions (
          series_id, effective_from, category, description, amount_cents, recurrence,
          weekday, month_day, notes
        ) VALUES ($1, $2, 'rent', 'Renda', 32500, 'monthly', NULL, 1, $3)
      `, [series.rows[0].id, futureDate, `${BEAUTY_DEMO_SEED_KEY}: alteração futura`]);
    }
  }

  const oneOffExpenses = [
    { offset: -8, category: "materials", description: "Material e produtos", amount: 8_450 },
    { offset: -6, category: "marketing", description: "Marketing", amount: 3_500 },
  ] as const;
  for (const expense of oneOffExpenses) {
    await client.query(`
      INSERT INTO ${schema}.business_expenses (
        location_id, category, description, amount_cents, expense_date, recurrence, notes,
        recurring_series_id, recurring_version_id, scheduled_date, is_occurrence_override
      ) VALUES ($1, $2, $3, $4, $5, 'once', $6, NULL, NULL, NULL, false)
    `, [location.id, expense.category, expense.description, expense.amount, localDateTimeToInstant(addDays(referenceDate, expense.offset), "12:00", location.timezone), BEAUTY_DEMO_SEED_KEY]);
  }

  const manifest: BeautyDemoManifest = {
    version: 1,
    seedKey: BEAUTY_DEMO_SEED_KEY,
    referenceDate,
    locationId: location.id,
    professionalId: barberId,
    createdShopAvailabilityIds,
    reusedShopAvailabilityIds: locationSchedule.reusedIds,
  };
  await client.query(`
    INSERT INTO ${schema}.audit_logs (
      actor_type, actor_id, actor_name, actor_user_id, actor_professional_id,
      location_id, action, entity_type, entity_id, summary, metadata
    ) VALUES ('system', NULL, 'Beauty demo seed', NULL, NULL, $1, $2,
      'beauty_demo_seed', $3, $4, $5)
  `, [
    location.id,
    BEAUTY_DEMO_MANIFEST_ACTION,
    barberId,
    `Ownership manifest for ${BEAUTY_DEMO_SEED_KEY}`,
    JSON.stringify(manifest),
  ]);

  return barberId;
}

async function assertCleanupSafe(client: PoolClient, schema: string, locationId: number, barberId: number) {
  const unsafeAppointments = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.appointments
    WHERE barber_id = $1 AND cancel_token NOT LIKE $2
  `, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  const unsafeServiceAppointments = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.appointments appointment
    WHERE appointment.service_id IN (
      SELECT service_id FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2
    ) AND appointment.barber_id <> $1
  `, [barberId, locationId]);
  const unsafeAssignments = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.barber_services assignment
    WHERE assignment.service_id IN (
      SELECT service_id FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2
    ) AND assignment.barber_id <> $1
  `, [barberId, locationId]);
  const unsafeCategoryServices = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.services service
    WHERE service.category_id IN (
      SELECT DISTINCT category_id FROM ${schema}.services
      WHERE id IN (
        SELECT service_id FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2
      ) AND category_id IS NOT NULL
    ) AND service.id NOT IN (
      SELECT service_id FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2
    )
  `, [barberId, locationId]);
  const unsafeExtras = await scalarCount(client, `
    SELECT count(*) FROM ${schema}.appointment_extras extra
    JOIN ${schema}.appointments appointment ON appointment.id = extra.appointment_id
    WHERE extra.extra_definition_id IN (
      SELECT id FROM ${schema}.extra_definitions WHERE location_id = $1 AND name = ANY($2::text[])
    ) AND appointment.barber_id <> $3
  `, [locationId, extraDefinitions.map((item) => item.name), barberId]);
  if (unsafeAppointments || unsafeServiceAppointments || unsafeAssignments || unsafeCategoryServices || unsafeExtras) {
    throw new BeautyDemoSeedError("Seed catalogue/professional has been reused by non-seed data; cleanup requires manual review.");
  }
}

async function cleanupDataset(client: PoolClient, schema: string, locationId: number, referenceDate: string, barberId: number) {
  await validateAppliedState(client, schema, locationId, referenceDate, barberId);
  await assertCleanupSafe(client, schema, locationId, barberId);
  const ownership = await findManifest(client, schema, locationId);
  if (!ownership) throw new BeautyDemoSeedError("Beauty demo ownership manifest is missing.");
  const serviceRows = await client.query<{ service_id: number }>(
    `SELECT service_id FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2 ORDER BY service_id`,
    [barberId, locationId],
  );
  const serviceIds = serviceRows.rows.map((row) => row.service_id);
  const categoryRows = await client.query<{ category_id: number }>(
    `SELECT DISTINCT category_id FROM ${schema}.services WHERE id = ANY($1::integer[]) AND category_id IS NOT NULL`,
    [serviceIds],
  );
  const categoryIds = categoryRows.rows.map((row) => row.category_id);
  const recurringRows = await client.query<{ id: number }>(
    `SELECT id FROM ${schema}.business_expense_recurring_series WHERE location_id = $1 AND creation_key LIKE $2`,
    [locationId, `${BEAUTY_DEMO_SEED_KEY}:expense:%`],
  );
  const recurringIds = recurringRows.rows.map((row) => row.id);

  await client.query(`DELETE FROM ${schema}.business_expenses WHERE notes = $1 OR recurring_series_id = ANY($2::integer[])`, [BEAUTY_DEMO_SEED_KEY, recurringIds]);
  await client.query(`DELETE FROM ${schema}.business_expense_recurring_series WHERE id = ANY($1::integer[])`, [recurringIds]);
  await client.query(`DELETE FROM ${schema}.appointments WHERE barber_id = $1 AND cancel_token LIKE $2`, [barberId, `${BEAUTY_DEMO_SEED_KEY}:appointment:%`]);
  await client.query(`DELETE FROM ${schema}.extra_definitions WHERE location_id = $1 AND name = ANY($2::text[])`, [locationId, extraDefinitions.map((item) => item.name)]);
  await client.query(`DELETE FROM ${schema}.barber_compensation_rules WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  await client.query(`DELETE FROM ${schema}.barber_services WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  await client.query(`DELETE FROM ${schema}.service_locations WHERE service_id = ANY($1::integer[]) AND location_id = $2`, [serviceIds, locationId]);
  await client.query(`DELETE FROM ${schema}.services WHERE id = ANY($1::integer[])`, [serviceIds]);
  await client.query(`DELETE FROM ${schema}.service_categories WHERE id = ANY($1::integer[])`, [categoryIds]);
  await client.query(`DELETE FROM ${schema}.barber_availability WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  if (ownership.manifest.createdShopAvailabilityIds.length > 0) {
    await client.query(`
      DELETE FROM ${schema}.shop_availability
      WHERE location_id = $1 AND id = ANY($2::integer[])
    `, [locationId, ownership.manifest.createdShopAvailabilityIds]);
  }
  await client.query(`DELETE FROM ${schema}.barber_locations WHERE barber_id = $1 AND location_id = $2`, [barberId, locationId]);
  await client.query(`DELETE FROM ${schema}.barbers WHERE id = $1`, [barberId]);
  await client.query(`DELETE FROM ${schema}.audit_logs WHERE id = $1`, [ownership.id]);
}

export async function runBeautyDemoSeed(pool: Pool, options: BeautyDemoSeedOptions): Promise<BeautyDemoSeedSummary> {
  validateEnvironment(options);
  parseDateKey(options.referenceDate);
  const schemaName = options.schemaName?.trim() || options.environment?.DATABASE_SCHEMA?.trim() || process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const client = await pool.connect();
  try {
    await client.query(options.mode === "dry-run" ? "BEGIN TRANSACTION READ ONLY" : "BEGIN");
    await client.query(options.mode === "dry-run"
      ? "SELECT pg_advisory_xact_lock_shared(424242, 18001)"
      : "SELECT pg_advisory_xact_lock(424242, 18001)");
    const location = await assertDatabaseFoundation(client, schema);
    const barberId = await findSeedProfessional(client, schema);

    if (options.mode === "dry-run") {
      if (barberId) {
        await validateAppliedState(client, schema, location.id, options.referenceDate, barberId);
        await client.query("ROLLBACK");
        return { ...plannedSummary("dry-run", "already-applied", options.referenceDate, location.id) };
      }
      await assertNoCollisions(client, schema, location.id);
      await client.query("ROLLBACK");
      return plannedSummary("dry-run", "planned", options.referenceDate, location.id);
    }

    if (options.mode === "cleanup") {
      if (!barberId) {
        await assertNoCollisions(client, schema, location.id);
        await client.query("COMMIT");
        return plannedSummary("cleanup", "already-clean", options.referenceDate, location.id);
      }
      const before = await protectedCounts(client, schema);
      await cleanupDataset(client, schema, location.id, options.referenceDate, barberId);
      const after = await protectedCounts(client, schema);
      if (!sameProtectedCounts(before, after)) throw new BeautyDemoSeedError("Cleanup attempted to alter protected identity/access data.");
      await client.query("COMMIT");
      return plannedSummary("cleanup", "cleaned", options.referenceDate, location.id);
    }

    if (barberId) {
      const summary = await validateAppliedState(client, schema, location.id, options.referenceDate, barberId);
      await client.query("COMMIT");
      return { ...summary, state: "already-applied" };
    }
    await assertNoCollisions(client, schema, location.id);
    const before = await protectedCounts(client, schema);
    const newBarberId = await insertDataset(client, schema, location, options.referenceDate);
    const summary = await validateAppliedState(client, schema, location.id, options.referenceDate, newBarberId);
    const after = await protectedCounts(client, schema);
    if (!sameProtectedCounts(before, after)) throw new BeautyDemoSeedError("Seed attempted to alter protected identity/access data.");
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    client.release();
  }
}
