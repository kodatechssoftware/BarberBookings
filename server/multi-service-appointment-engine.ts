import type { Pool, PoolClient } from "pg";
import { pool as applicationPool } from "./db";
import { parseBeautyV2MasterSwitch } from "@shared/business/v2-features";
import type { BeautyV2FeatureName } from "@shared/business/v2-features";
import {
  assertParallelServiceCompatibility,
  assignParallelExecutionStages,
  assertMultiServicePlanFitsWorkingPeriods,
  MIN_MULTI_SERVICE_SEGMENTS,
  MultiServiceAppointmentValidationError,
  planAppointmentServices,
  planSequentialAppointmentServices,
  serviceCompatibilityKey,
  type MultiServiceAppointmentPlan,
  type MultiServiceSegmentTerms,
  type MultiServiceWorkingPeriod,
} from "@shared/multi-service-appointments";
import {
  calendarDateTimeToInstant,
  getCalendarDateBounds,
  getCalendarDateTimeParts,
} from "./calendar-timezone";
import type { AppointmentRequestExecutionMode } from "@shared/appointment-requests";
import { serializeSafeAuditMetadata } from "./audit-log-security";

export type MultiServiceSelection = {
  serviceId: number;
  barberId: number;
};

export type CreateMultiServiceAppointmentInput = {
  locationId: number;
  startTime: Date | string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  whatsappOptIn?: boolean;
  cancelToken: string;
  manualOutsideHours?: boolean;
  services: MultiServiceSelection[];
};

export type ValidateMultiServiceAppointmentAvailabilityInput = Pick<
  CreateMultiServiceAppointmentInput,
  "locationId" | "startTime" | "manualOutsideHours" | "services"
> & {
  excludeAppointmentId?: number;
};

export type MultiServiceRescheduleActor = {
  actorType: "client" | "admin" | "barber" | "system";
  actorId?: number | null;
  actorName?: string | null;
  actorUserId?: number | null;
  actorProfessionalId?: number | null;
};

export type RescheduleMultiServiceAppointmentInput = {
  appointmentId: number;
  locationId: number;
  expectedRevision: number;
  startTime: Date | string;
  requireFutureCurrentStart?: boolean;
  reminderAvailableAt?: Date | null;
  actor?: MultiServiceRescheduleActor;
};

export type MultiServiceReschedulePreview = {
  date: string;
  timeZone: string;
  starts: string[];
  durationMinutes: number;
  totalPriceCents: number;
  segments: Array<{
    position: number;
    executionStage: number;
    serviceId: number;
    barberId: number;
    startOffsetMinutes: number;
    durationMinutes: number;
    serviceName: string;
    priceCents: number;
  }>;
};

export type RescheduledMultiServiceAppointment = {
  appointmentId: number;
  previousStartTime: Date;
  startTime: Date;
  rescheduleRevision: number;
  notificationRevision: number;
  notificationEventId: number | null;
  reused: boolean;
  segments: StoredMultiServiceSegment[];
};

export type StoredMultiServiceSegment = {
  id: number;
  appointmentId: number;
  position: number;
  executionStage: number;
  serviceId: number;
  barberId: number;
  startTime: Date;
  durationMinutes: number;
  bufferBeforeMinutesSnapshot: number;
  bufferAfterMinutesSnapshot: number;
  serviceNameSnapshot: string;
  servicePriceCentsSnapshot: number;
};

export type CreatedMultiServiceAppointment = {
  appointment: {
    id: number;
    locationId: number;
    barberId: number;
    serviceId: number;
    startTime: Date;
    durationMinutes: number;
    serviceNameSnapshot: string;
    servicePriceCentsSnapshot: number;
    status: string;
  };
  segments: StoredMultiServiceSegment[];
  plan: MultiServiceAppointmentPlan;
};

function mapStoredSegment(row: {
  id: number;
  appointment_id: number;
  position: number;
  execution_stage: number | null;
  service_id: number;
  barber_id: number;
  start_time: Date;
  duration_minutes: number;
  buffer_before_minutes_snapshot: number;
  buffer_after_minutes_snapshot: number;
  service_name_snapshot: string;
  service_price_cents_snapshot: number;
}): StoredMultiServiceSegment {
  return {
    id: Number(row.id),
    appointmentId: Number(row.appointment_id),
    position: Number(row.position),
    executionStage: Number(row.execution_stage ?? row.position),
    serviceId: Number(row.service_id),
    barberId: Number(row.barber_id),
    startTime: new Date(row.start_time),
    durationMinutes: Number(row.duration_minutes),
    bufferBeforeMinutesSnapshot: Number(row.buffer_before_minutes_snapshot),
    bufferAfterMinutesSnapshot: Number(row.buffer_after_minutes_snapshot),
    serviceNameSnapshot: row.service_name_snapshot,
    servicePriceCentsSnapshot: Number(row.service_price_cents_snapshot),
  };
}

export class MultiServiceFeatureDisabledError extends Error {
  status = 404;
  code = "MULTI_SERVICE_APPOINTMENTS_DISABLED";

  constructor() {
    super("As marcações com vários serviços não estão ativas nesta instalação.");
    this.name = "MultiServiceFeatureDisabledError";
  }
}

export class MultiServiceScopeError extends Error {
  status = 409;
  code = "MULTI_SERVICE_SCOPE_INVALID";

  constructor(message = "Um serviço ou profissional deixou de estar disponível nesta localização.") {
    super(message);
    this.name = "MultiServiceScopeError";
  }
}

export class MultiServiceConflictError extends Error {
  status = 409;
  code = "MULTI_SERVICE_APPOINTMENT_CONFLICT";

  constructor() {
    super("Um dos profissionais já tem uma marcação neste período.");
    this.name = "MultiServiceConflictError";
  }
}

export class MultiServiceRescheduleError extends Error {
  constructor(
    public code:
      | "MULTI_SERVICE_RESCHEDULE_NOT_FOUND"
      | "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE"
      | "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT"
      | "MULTI_SERVICE_RESCHEDULE_TOKEN_EXPIRED",
    message: string,
    public status = 409,
  ) {
    super(message);
    this.name = "MultiServiceRescheduleError";
  }
}

export type MultiServiceEngineOptions = {
  masterEnabled?: boolean;
  businessVertical?: string;
  requiredFeatures?: readonly BeautyV2FeatureName[];
  minimumSegments?: number;
  termsSnapshot?: readonly MultiServiceSegmentTerms[];
  afterSegmentsInserted?: (client: PoolClient, appointmentId: number) => Promise<void>;
  afterSegmentsRescheduled?: (client: PoolClient, appointmentId: number) => Promise<void>;
  appointmentNotificationsEnabled?: boolean;
  now?: () => Date;
};

const defaultWorkingPeriods = (weekday: number): MultiServiceWorkingPeriod[] => {
  if (weekday === 1) return [{ start: 14 * 60, end: 20 * 60 }];
  if (weekday >= 2 && weekday <= 5) {
    return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 20 * 60 }];
  }
  if (weekday === 6) {
    return [{ start: 9 * 60, end: 13 * 60 }, { start: 14 * 60, end: 19 * 60 }];
  }
  return [];
};

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function utcTimestamp(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function lockDayKey(date: Date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

function parseMinute(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function rowsToPeriods(rows: Array<{ start_time: string; end_time: string }>) {
  return rows.flatMap((row): MultiServiceWorkingPeriod[] => {
    const start = parseMinute(row.start_time);
    const end = parseMinute(row.end_time);
    return start !== null && end !== null && end > start ? [{ start, end }] : [];
  });
}

function intersectPeriods(primary: readonly MultiServiceWorkingPeriod[], override: readonly MultiServiceWorkingPeriod[]) {
  const result: MultiServiceWorkingPeriod[] = [];
  for (const left of primary) {
    for (const right of override) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  }
  return result;
}

function databaseCode(error: unknown) {
  let current = error;
  const visited = new Set<object>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

export async function assertBeautyV2FeaturesEnabledWithClient(
  client: PoolClient,
  locationId: number,
  options: MultiServiceEngineOptions,
  table: (name: string) => string,
) {
  const masterEnabled = options.masterEnabled
    ?? parseBeautyV2MasterSwitch(process.env.BEAUTY_V2_FEATURES_ENABLED);
  const vertical = (options.businessVertical ?? process.env.BUSINESS_VERTICAL ?? "barber").trim().toLowerCase();
  if (!masterEnabled || vertical !== "beauty") throw new MultiServiceFeatureDisabledError();

  const requiredFeatures = options.requiredFeatures ?? ["multiServiceAppointments"];
  const settings = await client.query<{ feature_name: BeautyV2FeatureName; location_id: number | null; enabled: boolean }>(`
    SELECT feature_name, location_id, enabled
    FROM ${table("business_feature_settings")}
    WHERE feature_name = ANY($2::text[])
      AND (location_id IS NULL OR location_id = $1)
    ORDER BY feature_name, location_id NULLS FIRST
    FOR SHARE
  `, [locationId, requiredFeatures]);
  const effective = new Map<BeautyV2FeatureName, boolean>(
    requiredFeatures.map((feature) => [feature, false]),
  );
  for (const setting of settings.rows) effective.set(setting.feature_name, Boolean(setting.enabled));
  if (requiredFeatures.some((feature) => !effective.get(feature))) throw new MultiServiceFeatureDisabledError();
}

export async function isBeautyV2FeatureEnabledWithClient(
  client: PoolClient,
  locationId: number,
  featureName: BeautyV2FeatureName,
  options: MultiServiceEngineOptions,
  table: (name: string) => string,
) {
  const masterEnabled = options.masterEnabled
    ?? parseBeautyV2MasterSwitch(process.env.BEAUTY_V2_FEATURES_ENABLED);
  const vertical = (options.businessVertical ?? process.env.BUSINESS_VERTICAL ?? "barber").trim().toLowerCase();
  if (!masterEnabled || vertical !== "beauty") return false;
  const result = await client.query<{ location_id: number | null; enabled: boolean }>(`
    SELECT location_id, enabled FROM ${table("business_feature_settings")}
    WHERE feature_name = $2 AND (location_id IS NULL OR location_id = $1)
    ORDER BY location_id NULLS FIRST
    FOR SHARE
  `, [locationId, featureName]);
  let enabled = false;
  for (const row of result.rows) enabled = Boolean(row.enabled);
  return enabled;
}

export async function loadParallelServiceCompatibilityWithClient(
  client: PoolClient,
  locationId: number,
  serviceIds: readonly number[],
  table: (name: string) => string,
) {
  const uniqueIds = Array.from(new Set(serviceIds));
  if (uniqueIds.length < 2) return new Set<string>();
  const result = await client.query<{ first_service_id: number; second_service_id: number }>(`
    SELECT first_service_id, second_service_id
    FROM ${table("parallel_service_compatibilities")}
    WHERE location_id = $1
      AND first_service_id = ANY($2::int[])
      AND second_service_id = ANY($2::int[])
    FOR SHARE
  `, [locationId, uniqueIds]);
  return new Set(result.rows.map((row) => serviceCompatibilityKey(
    Number(row.first_service_id),
    Number(row.second_service_id),
  )));
}

export async function resolveExecutionTermsWithClient(
  client: PoolClient,
  locationId: number,
  terms: readonly MultiServiceSegmentTerms[],
  options: MultiServiceEngineOptions,
  table: (name: string) => string,
  preserveStages: boolean,
  executionMode?: AppointmentRequestExecutionMode,
) {
  if (!preserveStages && executionMode === "sequential") {
    return terms.map((term, position) => ({ ...term, executionStage: position }));
  }
  const parallelEnabled = await isBeautyV2FeatureEnabledWithClient(
    client, locationId, "parallelServiceScheduling", options, table,
  );
  if (!parallelEnabled) {
    if (!preserveStages && executionMode === "parallel") {
      throw new MultiServiceFeatureDisabledError();
    }
    if (preserveStages && terms.some((term, position) => (term.executionStage ?? position) !== position)) {
      throw new MultiServiceFeatureDisabledError();
    }
    return terms.map((term, position) => ({ ...term, executionStage: position }));
  }
  const pairs = await loadParallelServiceCompatibilityWithClient(
    client, locationId, terms.map((term) => term.serviceId), table,
  );
  const staged = preserveStages
    ? terms.map((term, position) => ({ ...term, executionStage: term.executionStage ?? position }))
    : assignParallelExecutionStages(terms, pairs);
  assertParallelServiceCompatibility(staged, pairs);
  if (!preserveStages && executionMode === "parallel") {
    const stageCounts = new Map<number, number>();
    staged.forEach((term, position) => {
      const stage = term.executionStage ?? position;
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
    });
    if (!Array.from(stageCounts.values()).some((count) => count > 1)) {
      throw new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
        "Os serviços e profissionais selecionados não permitem uma execução em simultâneo.",
      );
    }
  }
  return staged;
}

export async function resolveAppointmentServiceTermsWithClient(
  client: PoolClient,
  locationId: number,
  selections: readonly MultiServiceSelection[],
  table: (name: string) => string,
) {
  const uniqueSelections = Array.from(new Map(selections.map((selection) => [
    `${selection.barberId}:${selection.serviceId}`,
    selection,
  ])).values()).sort((left, right) => left.barberId - right.barberId || left.serviceId - right.serviceId);
  const resolved = new Map<string, MultiServiceSegmentTerms>();

  for (const selection of uniqueSelections) {
    const result = await client.query<{
      service_id: number;
      barber_id: number;
      service_name: string;
      price_cents: number;
      duration_minutes: number;
      buffer_before_minutes: number;
      buffer_after_minutes: number;
    }>(`
      SELECT
        service.id AS service_id,
        assignment.barber_id,
        service.name AS service_name,
        coalesce(offer.price_override, service.price) AS price_cents,
        coalesce(offer.duration_override, service.duration) AS duration_minutes,
        offer.buffer_before_minutes,
        offer.buffer_after_minutes
      FROM ${table("services")} service
      JOIN ${table("service_locations")} offer
        ON offer.service_id = service.id AND offer.location_id = $1 AND offer.is_active = true
      JOIN ${table("barber_services")} assignment
        ON assignment.service_id = service.id
        AND assignment.location_id = offer.location_id
        AND assignment.barber_id = $2
      JOIN ${table("barber_locations")} professional_location
        ON professional_location.barber_id = assignment.barber_id
        AND professional_location.location_id = assignment.location_id
        AND professional_location.is_active = true
      WHERE service.id = $3
      FOR SHARE OF service, offer, assignment, professional_location
    `, [locationId, selection.barberId, selection.serviceId]);
    const row = result.rows[0];
    if (!row) throw new MultiServiceScopeError();
    resolved.set(`${selection.barberId}:${selection.serviceId}`, {
      serviceId: Number(row.service_id),
      barberId: Number(row.barber_id),
      serviceName: row.service_name,
      priceCents: Number(row.price_cents),
      durationMinutes: Number(row.duration_minutes),
      bufferBeforeMinutes: Number(row.buffer_before_minutes),
      bufferAfterMinutes: Number(row.buffer_after_minutes),
    });
  }

  return selections.map((selection) => resolved.get(`${selection.barberId}:${selection.serviceId}`)!);
}

async function resolveWorkingPeriods(
  client: PoolClient,
  plan: MultiServiceAppointmentPlan,
  locationId: number,
  timeZone: string,
  table: (name: string) => string,
  cached?: {
    shopRows: Array<{ day_of_week: number; start_time: string; end_time: string; is_open: boolean }>;
    barberRows: Array<{ barber_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean }>;
  },
) {
  const barberIds = Array.from(new Set(plan.segments.map((segment) => segment.barberId)));
  const shopResult = cached ? { rows: cached.shopRows } : await client.query<{
    day_of_week: number; start_time: string; end_time: string; is_open: boolean;
  }>(`
    SELECT day_of_week, start_time, end_time, is_open
    FROM ${table("shop_availability")}
    WHERE location_id = $1
    ORDER BY day_of_week, start_time, end_time
    FOR SHARE
  `, [locationId]);
  const barberResult = cached ? { rows: cached.barberRows } : await client.query<{
    barber_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean;
  }>(`
    SELECT barber_id, day_of_week, start_time, end_time, is_working
    FROM ${table("barber_availability")}
    WHERE location_id = $1 AND barber_id = ANY($2::int[])
    ORDER BY barber_id, day_of_week, start_time, end_time
    FOR SHARE
  `, [locationId, barberIds]);

  const periods = new Map<string, MultiServiceWorkingPeriod[]>();
  for (const segment of plan.segments) {
    const local = getCalendarDateTimeParts(segment.operationalStart, timeZone);
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const shopPeriods = shopResult.rows.length === 0
      ? defaultWorkingPeriods(weekday)
      : rowsToPeriods(shopResult.rows.filter((row) => row.day_of_week === weekday && row.is_open));
    const professionalRows = barberResult.rows.filter((row) => row.barber_id === segment.barberId);
    const professionalPeriods = professionalRows.length === 0
      ? shopPeriods
      : intersectPeriods(
          shopPeriods,
          rowsToPeriods(professionalRows.filter((row) => row.day_of_week === weekday && row.is_working)),
        );
    periods.set(`${segment.barberId}:${weekday}`, professionalPeriods);
  }
  return periods;
}

export async function previewSequentialAppointmentAvailabilityWithPool(
  databasePool: Pool,
  input: {
    locationId: number;
    date: string;
    services: MultiServiceSelection[];
    executionMode?: AppointmentRequestExecutionMode;
    slotIntervalMinutes: number;
    now?: Date;
  },
  options: MultiServiceEngineOptions = {},
) {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await assertBeautyV2FeaturesEnabledWithClient(client, input.locationId, {
      ...options,
      requiredFeatures: input.services.length > 1
        ? ["appointmentRequests", "multiServiceAppointments"]
        : ["appointmentRequests"],
    }, table);
    const location = await client.query<{ timezone: string }>(`
      SELECT timezone FROM ${table("locations")}
      WHERE id = $1 AND is_active = true
    `, [input.locationId]);
    if (!location.rows[0]) throw new MultiServiceScopeError("A localização não está disponível.");
    const timeZone = location.rows[0].timezone;
    const currentTerms = await resolveAppointmentServiceTermsWithClient(client, input.locationId, input.services, table);
    const snapshotTerms = options.termsSnapshot
      ? options.termsSnapshot.map((snapshot, index) => {
          const current = currentTerms[index];
          if (!current || current.serviceId !== snapshot.serviceId || current.barberId !== snapshot.barberId) {
            throw new MultiServiceScopeError();
          }
          return { ...snapshot };
        })
      : currentTerms;
    if (snapshotTerms.length !== currentTerms.length) throw new MultiServiceScopeError();
    const preserveExecutionStages = Boolean(options.termsSnapshot);
    const executionMode = input.executionMode ?? "sequential";
    const sequentialTerms = snapshotTerms.map((term, position) => ({ ...term, executionStage: position }));
    let parallelTerms: Array<MultiServiceSegmentTerms & { executionStage: number }> | null = null;
    let parallelFailure: unknown;
    if (preserveExecutionStages) {
      const preservedTerms = await resolveExecutionTermsWithClient(
        client, input.locationId, snapshotTerms, options, table, true,
      );
      const hasParallelStage = preservedTerms.some((term, position) =>
        Number(term.executionStage ?? position) !== position,
      );
      parallelTerms = hasParallelStage ? preservedTerms : null;
    } else if (currentTerms.length > 1) {
      try {
        parallelTerms = await resolveExecutionTermsWithClient(
          client, input.locationId, snapshotTerms, options, table, false, "parallel",
        );
      } catch (error) {
        if (error instanceof MultiServiceFeatureDisabledError
          || (error instanceof MultiServiceAppointmentValidationError
            && [
              "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
              "MULTI_SERVICE_PARALLEL_BARBER_CONFLICT",
            ].includes(error.code))) {
          parallelFailure = error;
        } else {
          throw error;
        }
      }
    }
    if (!preserveExecutionStages && executionMode === "parallel" && !parallelTerms) {
      throw parallelFailure ?? new MultiServiceAppointmentValidationError(
        "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
        "Os serviços e profissionais selecionados não permitem uma execução em simultâneo.",
      );
    }
    const terms = preserveExecutionStages
      ? (parallelTerms ?? sequentialTerms)
      : executionMode === "parallel" ? parallelTerms! : sequentialTerms;
    const [year, month, day] = input.date.split("-").map(Number);
    const bounds = getCalendarDateBounds(input.date, timeZone);
    const barberIds = Array.from(new Set(input.services.map((selection) => selection.barberId)));
    const occupied = await client.query<{ barber_id: number; start_time: Date; end_time: Date }>(`
      SELECT barber_id, start_time, end_time
      FROM ${table("appointment_occupancy_periods")}
      WHERE barber_id = ANY($1::int[])
        AND start_time < $3 AND end_time > $2
    `, [barberIds, bounds.start, bounds.endExclusive]);
    const shopAvailability = await client.query<{
      day_of_week: number; start_time: string; end_time: string; is_open: boolean;
    }>(`
      SELECT day_of_week, start_time, end_time, is_open
      FROM ${table("shop_availability")}
      WHERE location_id = $1
      ORDER BY day_of_week, start_time, end_time
    `, [input.locationId]);
    const professionalAvailability = await client.query<{
      barber_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean;
    }>(`
      SELECT barber_id, day_of_week, start_time, end_time, is_working
      FROM ${table("barber_availability")}
      WHERE location_id = $1 AND barber_id = ANY($2::int[])
      ORDER BY barber_id, day_of_week, start_time, end_time
    `, [input.locationId, barberIds]);
    const starts: string[] = [];
    const now = input.now ?? new Date();
    for (let minute = 0; minute < 24 * 60; minute += input.slotIntervalMinutes) {
      const startTime = calendarDateTimeToInstant({
        year,
        month,
        day,
        hour: Math.floor(minute / 60),
        minute: minute % 60,
        second: 0,
      }, timeZone);
      const represented = getCalendarDateTimeParts(startTime, timeZone);
      if (represented.year !== year || represented.month !== month || represented.day !== day
        || represented.hour !== Math.floor(minute / 60) || represented.minute !== minute % 60
        || startTime <= now) continue;
      const plan = planAppointmentServices(startTime, terms, 1);
      try {
        const periods = await resolveWorkingPeriods(client, plan, input.locationId, timeZone, table, {
          shopRows: shopAvailability.rows,
          barberRows: professionalAvailability.rows,
        });
        assertMultiServicePlanFitsWorkingPeriods(plan, timeZone, periods);
      } catch (error) {
        if (error instanceof MultiServiceAppointmentValidationError) continue;
        throw error;
      }
      const conflict = plan.occupancyPeriods.some((period) => occupied.rows.some((row) =>
        row.barber_id === period.barberId
        && new Date(row.start_time) < period.endTime
        && new Date(row.end_time) > period.startTime));
      if (!conflict) starts.push(startTime.toISOString());
    }
    await client.query("COMMIT");
    const plan = planAppointmentServices(
      calendarDateTimeToInstant({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone),
      terms,
      1,
    );
    const sequentialPlan = planAppointmentServices(plan.startTime, sequentialTerms, 1);
    const parallelPlan = parallelTerms ? planAppointmentServices(plan.startTime, parallelTerms, 1) : null;
    return {
      date: input.date,
      timeZone,
      starts,
      executionMode: preserveExecutionStages && parallelTerms ? "parallel" : executionMode,
      parallelEligible: Boolean(parallelPlan && parallelPlan.durationMinutes < sequentialPlan.durationMinutes),
      sequentialDurationMinutes: sequentialPlan.durationMinutes,
      parallelDurationMinutes: parallelPlan?.durationMinutes ?? null,
      durationMinutes: plan.durationMinutes,
      totalPriceCents: plan.totalPriceCents,
      segments: plan.segments.map((segment) => ({
        position: segment.position,
        executionStage: segment.executionStage,
        serviceId: segment.serviceId,
        barberId: segment.barberId,
        startOffsetMinutes: Math.round((segment.startTime.getTime() - plan.startTime.getTime()) / 60_000),
        durationMinutes: segment.durationMinutes,
        serviceName: segment.serviceNameSnapshot,
        priceCents: segment.servicePriceCentsSnapshot,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function validateMultiServiceAppointmentAvailabilityInTransaction(
  client: PoolClient,
  input: ValidateMultiServiceAppointmentAvailabilityInput,
  options: MultiServiceEngineOptions = {},
): Promise<MultiServiceAppointmentPlan> {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;
  await assertBeautyV2FeaturesEnabledWithClient(client, input.locationId, options, table);
  const location = await client.query<{ id: number; timezone: string }>(`
    SELECT id, timezone FROM ${table("locations")}
    WHERE id = $1 AND is_active = true
    FOR SHARE
  `, [input.locationId]);
  if (!location.rows[0]) throw new MultiServiceScopeError("A localização não está disponível.");

  const currentTerms = await resolveAppointmentServiceTermsWithClient(
    client,
    input.locationId,
    input.services,
    table,
  );
  const snapshotTerms = options.termsSnapshot
    ? options.termsSnapshot.map((snapshot, index) => {
        const current = currentTerms[index];
        if (!current || current.serviceId !== snapshot.serviceId || current.barberId !== snapshot.barberId) {
          throw new MultiServiceScopeError();
        }
        return { ...snapshot };
      })
    : currentTerms;
  if (snapshotTerms.length !== currentTerms.length) throw new MultiServiceScopeError();
  const terms = await resolveExecutionTermsWithClient(
    client, input.locationId, snapshotTerms, options, table, Boolean(options.termsSnapshot),
  );
  const plan = planAppointmentServices(
    input.startTime,
    terms,
    options.minimumSegments ?? MIN_MULTI_SERVICE_SEGMENTS,
  );
  if (!input.manualOutsideHours) {
    const workingPeriods = await resolveWorkingPeriods(
      client,
      plan,
      input.locationId,
      location.rows[0].timezone,
      table,
    );
    assertMultiServicePlanFitsWorkingPeriods(plan, location.rows[0].timezone, workingPeriods);
  }

  const lockKeys = Array.from(new Set(plan.occupancyPeriods.flatMap((period) => [
    `${period.barberId}:${lockDayKey(period.startTime)}`,
    `${period.barberId}:${lockDayKey(period.endTime)}`,
  ]))).map((key) => key.split(":").map(Number) as [number, number])
    .sort(([leftBarber, leftDay], [rightBarber, rightDay]) => leftBarber - rightBarber || leftDay - rightDay);
  for (const [barberId, dayKey] of lockKeys) {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [barberId, dayKey]);
  }

  for (const period of plan.occupancyPeriods) {
    const conflict = await client.query(`
      SELECT appointment_id
      FROM ${table("appointment_occupancy_periods")}
      WHERE barber_id = $1 AND start_time < $2 AND end_time > $3
        AND ($4::int IS NULL OR appointment_id <> $4)
      LIMIT 1
    `, [
      period.barberId,
      utcTimestamp(period.endTime),
      utcTimestamp(period.startTime),
      input.excludeAppointmentId ?? null,
    ]);
    if (conflict.rowCount) throw new MultiServiceConflictError();
  }

  return plan;
}

export async function createSequentialAppointmentInTransaction(
  client: PoolClient,
  input: CreateMultiServiceAppointmentInput,
  options: MultiServiceEngineOptions = {},
): Promise<CreatedMultiServiceAppointment> {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;
  const plan = await validateMultiServiceAppointmentAvailabilityInTransaction(client, input, options);

  const customerName = input.customerName.trim();
  const customerPhone = input.customerPhone.trim();
  if (!customerName || !customerPhone || !input.cancelToken.trim()) {
    throw new MultiServiceScopeError("Os dados essenciais da marcação são inválidos.");
  }

  const appointmentResult = await client.query<{
      id: number;
      location_id: number;
      barber_id: number;
      service_id: number;
      start_time: Date;
      duration_minutes: number;
      service_name_snapshot: string;
      service_price_cents_snapshot: number;
      status: string;
    }>(`
      INSERT INTO ${table("appointments")} (
        location_id, barber_id, service_id, start_time,
        customer_name, customer_email, customer_phone,
        duration_minutes, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
        service_name_snapshot, service_price_cents_snapshot,
        manual_outside_hours, status, cancel_token, whatsapp_opt_in, whatsapp_opt_in_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12,
        $13, 'booked', $14, $15, $16
      )
      RETURNING id, location_id, barber_id, service_id, start_time, duration_minutes,
        service_name_snapshot, service_price_cents_snapshot, status
    `, [
      input.locationId,
      plan.primaryBarberId,
      plan.primaryServiceId,
      utcTimestamp(plan.startTime),
      customerName,
      input.customerEmail?.trim() || null,
      customerPhone,
      plan.durationMinutes,
      plan.bufferBeforeMinutesSnapshot,
      plan.bufferAfterMinutesSnapshot,
      plan.summaryServiceName,
      plan.totalPriceCents,
      input.manualOutsideHours ?? false,
      input.cancelToken.trim(),
      input.whatsappOptIn ?? false,
      input.whatsappOptIn ? utcTimestamp(new Date()) : null,
    ]);
  const appointmentId = appointmentResult.rows[0].id;
  const storedSegments: StoredMultiServiceSegment[] = [];
  if (plan.segments.length > 1) {
    await client.query(`
      INSERT INTO ${table("appointment_service_sets")} (appointment_id)
      VALUES ($1)
    `, [appointmentId]);

    for (const segment of plan.segments) {
      const result = await client.query<{
        id: number;
        appointment_id: number;
        position: number;
        execution_stage: number | null;
        service_id: number;
        barber_id: number;
        start_time: Date;
        duration_minutes: number;
        buffer_before_minutes_snapshot: number;
        buffer_after_minutes_snapshot: number;
        service_name_snapshot: string;
        service_price_cents_snapshot: number;
      }>(`
        INSERT INTO ${table("appointment_service_segments")} (
          appointment_id, position, execution_stage, service_id, barber_id, start_time, duration_minutes,
          buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
          service_name_snapshot, service_price_cents_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, appointment_id, position, execution_stage, service_id, barber_id, start_time, duration_minutes,
          buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
          service_name_snapshot, service_price_cents_snapshot
      `, [
        appointmentId,
        segment.position,
        segment.executionStage,
        segment.serviceId,
        segment.barberId,
        utcTimestamp(segment.startTime),
        segment.durationMinutes,
        segment.bufferBeforeMinutesSnapshot,
        segment.bufferAfterMinutesSnapshot,
        segment.serviceNameSnapshot,
        segment.servicePriceCentsSnapshot,
      ]);
      const row = result.rows[0];
      storedSegments.push(mapStoredSegment(row));
    }
  }

  await options.afterSegmentsInserted?.(client, appointmentId);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  const appointment = appointmentResult.rows[0];
  return {
    appointment: {
      id: Number(appointment.id),
      locationId: Number(appointment.location_id),
      barberId: Number(appointment.barber_id),
      serviceId: Number(appointment.service_id),
      startTime: new Date(appointment.start_time),
      durationMinutes: Number(appointment.duration_minutes),
      serviceNameSnapshot: appointment.service_name_snapshot,
      servicePriceCentsSnapshot: Number(appointment.service_price_cents_snapshot),
      status: appointment.status,
    },
    segments: storedSegments,
    plan,
  };
}

export async function createMultiServiceAppointmentWithPool(
  databasePool: Pool,
  input: CreateMultiServiceAppointmentInput,
  options: MultiServiceEngineOptions = {},
): Promise<CreatedMultiServiceAppointment> {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const created = await createSequentialAppointmentInTransaction(client, input, {
      ...options,
      requiredFeatures: options.requiredFeatures ?? ["multiServiceAppointments"],
      minimumSegments: options.minimumSegments ?? MIN_MULTI_SERVICE_SEGMENTS,
    });
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (databaseCode(error) === "23P01") throw new MultiServiceConflictError();
    throw error;
  } finally {
    client.release();
  }
}

export function createMultiServiceAppointment(input: CreateMultiServiceAppointmentInput) {
  return createMultiServiceAppointmentWithPool(applicationPool, input);
}

export async function getMultiServiceAppointmentSegmentsWithPool(
  databasePool: Pool,
  appointmentId: number,
) {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const result = await databasePool.query<Parameters<typeof mapStoredSegment>[0]>(`
    SELECT id, appointment_id, position, execution_stage, service_id, barber_id, start_time, duration_minutes,
      buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      service_name_snapshot, service_price_cents_snapshot
    FROM ${schema}.${quoteIdentifier("appointment_service_segments")}
    WHERE appointment_id = $1
    ORDER BY position
  `, [appointmentId]);
  return result.rows.map(mapStoredSegment);
}

export function getMultiServiceAppointmentSegments(appointmentId: number) {
  return getMultiServiceAppointmentSegmentsWithPool(applicationPool, appointmentId);
}

type MultiServiceRescheduleAppointmentRow = {
  id: number;
  location_id: number;
  status: string;
  start_time: Date;
  reschedule_revision: number;
  notification_revision: number;
  manual_outside_hours: boolean;
  customer_name: string;
};

function schemaTables() {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  return (name: string) => `${schema}.${quoteIdentifier(name)}`;
}

async function loadMultiServiceRescheduleContextWithClient(
  client: PoolClient,
  input: {
    appointmentId: number;
    locationId: number;
    expectedRevision?: number;
    lock?: "share" | "update";
  },
  options: MultiServiceEngineOptions,
) {
  const table = schemaTables();
  const lock = input.lock === "update" ? "FOR UPDATE" : "FOR SHARE";
  const appointmentResult = await client.query<MultiServiceRescheduleAppointmentRow>(`
    SELECT id, location_id, status, start_time, reschedule_revision, notification_revision,
      manual_outside_hours, customer_name
    FROM ${table("appointments")}
    WHERE id = $1 AND location_id = $2
    ${lock}
  `, [input.appointmentId, input.locationId]);
  const appointment = appointmentResult.rows[0];
  if (!appointment) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_NOT_FOUND",
      "A marcação não foi encontrada neste estabelecimento.",
      404,
    );
  }
  if (appointment.status !== "booked" || appointment.manual_outside_hours) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE",
      "Esta marcação não pode ser reagendada online.",
    );
  }
  if (input.expectedRevision !== undefined
    && Number(appointment.reschedule_revision) !== input.expectedRevision) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT",
      "A marcação foi alterada entretanto. Atualize a página antes de escolher outro horário.",
    );
  }

  const segmentResult = await client.query<Parameters<typeof mapStoredSegment>[0]>(`
    SELECT id, appointment_id, position, execution_stage, service_id, barber_id, start_time,
      duration_minutes, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      service_name_snapshot, service_price_cents_snapshot
    FROM ${table("appointment_service_segments")}
    WHERE appointment_id = $1
    ORDER BY position
    ${lock}
  `, [input.appointmentId]);
  const segments = segmentResult.rows.map(mapStoredSegment);
  if (segments.length < MIN_MULTI_SERVICE_SEGMENTS) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE",
      "Esta marcação não contém um plano multi-serviço válido.",
    );
  }

  const snapshots: MultiServiceSegmentTerms[] = segments.map((segment) => ({
    serviceId: segment.serviceId,
    barberId: segment.barberId,
    serviceName: segment.serviceNameSnapshot,
    priceCents: segment.servicePriceCentsSnapshot,
    durationMinutes: segment.durationMinutes,
    bufferBeforeMinutes: segment.bufferBeforeMinutesSnapshot,
    bufferAfterMinutes: segment.bufferAfterMinutesSnapshot,
    executionStage: segment.executionStage,
  }));
  await assertBeautyV2FeaturesEnabledWithClient(client, input.locationId, {
    ...options,
    requiredFeatures: ["multiServiceAppointments"],
  }, table);
  const currentTerms = await resolveAppointmentServiceTermsWithClient(
    client,
    input.locationId,
    snapshots.map(({ serviceId, barberId }) => ({ serviceId, barberId })),
    table,
  );
  currentTerms.forEach((current, index) => {
    const snapshot = snapshots[index];
    if (current.serviceId !== snapshot.serviceId || current.barberId !== snapshot.barberId) {
      throw new MultiServiceScopeError();
    }
  });
  await resolveExecutionTermsWithClient(client, input.locationId, snapshots, options, table, true);
  return { appointment, segments, snapshots, table };
}

export async function canRescheduleMultiServiceAppointmentWithPool(
  databasePool: Pool,
  input: { appointmentId: number; locationId: number },
  options: MultiServiceEngineOptions = {},
) {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    await loadMultiServiceRescheduleContextWithClient(client, input, options);
    await client.query("COMMIT");
    return true;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return false;
  } finally {
    client.release();
  }
}

export async function previewMultiServiceRescheduleAvailabilityWithPool(
  databasePool: Pool,
  input: {
    appointmentId: number;
    locationId: number;
    expectedRevision: number;
    date: string;
    slotIntervalMinutes: number;
    now?: Date;
  },
  options: MultiServiceEngineOptions = {},
): Promise<MultiServiceReschedulePreview> {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const context = await loadMultiServiceRescheduleContextWithClient(client, input, options);
    const location = await client.query<{ timezone: string }>(`
      SELECT timezone FROM ${context.table("locations")}
      WHERE id = $1 AND is_active = true
      FOR SHARE
    `, [input.locationId]);
    if (!location.rows[0]) throw new MultiServiceScopeError("A localização não está disponível.");
    const timeZone = location.rows[0].timezone;
    const [year, month, day] = input.date.split("-").map(Number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)
      || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      throw new MultiServiceRescheduleError(
        "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE",
        "A data escolhida é inválida.",
        400,
      );
    }
    const bounds = getCalendarDateBounds(input.date, timeZone);
    const barberIds = Array.from(new Set(context.snapshots.map((segment) => segment.barberId)));
    const [occupied, shopAvailability, professionalAvailability] = await Promise.all([
      client.query<{ barber_id: number; start_time: Date; end_time: Date }>(`
        SELECT barber_id, start_time, end_time
        FROM ${context.table("appointment_occupancy_periods")}
        WHERE barber_id = ANY($1::int[])
          AND appointment_id <> $2
          AND start_time < $4 AND end_time > $3
      `, [barberIds, input.appointmentId, bounds.start, bounds.endExclusive]),
      client.query<{ day_of_week: number; start_time: string; end_time: string; is_open: boolean }>(`
        SELECT day_of_week, start_time, end_time, is_open
        FROM ${context.table("shop_availability")}
        WHERE location_id = $1
        ORDER BY day_of_week, start_time, end_time
      `, [input.locationId]),
      client.query<{ barber_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean }>(`
        SELECT barber_id, day_of_week, start_time, end_time, is_working
        FROM ${context.table("barber_availability")}
        WHERE location_id = $1 AND barber_id = ANY($2::int[])
        ORDER BY barber_id, day_of_week, start_time, end_time
      `, [input.locationId, barberIds]),
    ]);
    const starts: string[] = [];
    const now = input.now ?? options.now?.() ?? new Date();
    for (let minute = 0; minute < 24 * 60; minute += input.slotIntervalMinutes) {
      const startTime = calendarDateTimeToInstant({
        year,
        month,
        day,
        hour: Math.floor(minute / 60),
        minute: minute % 60,
        second: 0,
      }, timeZone);
      const represented = getCalendarDateTimeParts(startTime, timeZone);
      if (represented.year !== year || represented.month !== month || represented.day !== day
        || represented.hour !== Math.floor(minute / 60) || represented.minute !== minute % 60
        || startTime <= now) continue;
      const plan = planAppointmentServices(startTime, context.snapshots, MIN_MULTI_SERVICE_SEGMENTS);
      try {
        const periods = await resolveWorkingPeriods(client, plan, input.locationId, timeZone, context.table, {
          shopRows: shopAvailability.rows,
          barberRows: professionalAvailability.rows,
        });
        assertMultiServicePlanFitsWorkingPeriods(plan, timeZone, periods);
      } catch (error) {
        if (error instanceof MultiServiceAppointmentValidationError) continue;
        throw error;
      }
      const conflict = plan.occupancyPeriods.some((period) => occupied.rows.some((row) =>
        row.barber_id === period.barberId
        && new Date(row.start_time) < period.endTime
        && new Date(row.end_time) > period.startTime));
      if (!conflict) starts.push(startTime.toISOString());
    }
    const referenceStart = calendarDateTimeToInstant({ year, month, day, hour: 12, minute: 0, second: 0 }, timeZone);
    const referencePlan = planAppointmentServices(referenceStart, context.snapshots, MIN_MULTI_SERVICE_SEGMENTS);
    await client.query("COMMIT");
    return {
      date: input.date,
      timeZone,
      starts,
      durationMinutes: referencePlan.durationMinutes,
      totalPriceCents: referencePlan.totalPriceCents,
      segments: referencePlan.segments.map((segment) => ({
        position: segment.position,
        executionStage: segment.executionStage,
        serviceId: segment.serviceId,
        barberId: segment.barberId,
        startOffsetMinutes: Math.round((segment.startTime.getTime() - referencePlan.startTime.getTime()) / 60_000),
        durationMinutes: segment.durationMinutes,
        serviceName: segment.serviceNameSnapshot,
        priceCents: segment.servicePriceCentsSnapshot,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rescheduleMultiServiceAppointmentInTransaction(
  client: PoolClient,
  input: RescheduleMultiServiceAppointmentInput,
  options: MultiServiceEngineOptions = {},
): Promise<RescheduledMultiServiceAppointment> {
  const requestedStartTime = input.startTime instanceof Date ? new Date(input.startTime) : new Date(input.startTime);
  if (Number.isNaN(requestedStartTime.getTime())) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE",
      "A data escolhida é inválida.",
      400,
    );
  }
  await client.query("SELECT pg_advisory_xact_lock(-2, $1)", [input.appointmentId]);
  const table = schemaTables();
  const currentResult = await client.query<MultiServiceRescheduleAppointmentRow>(`
    SELECT id, location_id, status, start_time, reschedule_revision, notification_revision,
      manual_outside_hours, customer_name
    FROM ${table("appointments")}
    WHERE id = $1 AND location_id = $2
    FOR UPDATE
  `, [input.appointmentId, input.locationId]);
  const current = currentResult.rows[0];
  if (!current) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_NOT_FOUND",
      "A marcação não foi encontrada neste estabelecimento.",
      404,
    );
  }
  const currentRevision = Number(current.reschedule_revision);
  if (currentRevision !== input.expectedRevision) {
    if (currentRevision === input.expectedRevision + 1
      && new Date(current.start_time).getTime() === requestedStartTime.getTime()) {
      const segments = await getMultiServiceAppointmentSegmentsWithClient(client, input.appointmentId, table, "FOR SHARE");
      return {
        appointmentId: input.appointmentId,
        previousStartTime: new Date(current.start_time),
        startTime: new Date(current.start_time),
        rescheduleRevision: currentRevision,
        notificationRevision: Number(current.notification_revision),
        notificationEventId: null,
        reused: true,
        segments,
      };
    }
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT",
      "A marcação foi alterada entretanto. Atualize a página antes de escolher outro horário.",
    );
  }
  if (current.status !== "booked" || current.manual_outside_hours) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_UNAVAILABLE",
      "Esta marcação não pode ser reagendada online.",
    );
  }
  if (new Date(current.start_time).getTime() === requestedStartTime.getTime()) {
    return {
      appointmentId: input.appointmentId,
      previousStartTime: new Date(current.start_time),
      startTime: new Date(current.start_time),
      rescheduleRevision: currentRevision,
      notificationRevision: Number(current.notification_revision),
      notificationEventId: null,
      reused: true,
      segments: await getMultiServiceAppointmentSegmentsWithClient(client, input.appointmentId, table, "FOR SHARE"),
    };
  }
  const now = options.now?.() ?? new Date();
  if (input.requireFutureCurrentStart && new Date(current.start_time) <= now) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_TOKEN_EXPIRED",
      "A ligação de reagendamento já não está disponível.",
      410,
    );
  }
  const context = await loadMultiServiceRescheduleContextWithClient(client, {
    appointmentId: input.appointmentId,
    locationId: input.locationId,
    expectedRevision: input.expectedRevision,
    lock: "update",
  }, options);
  const plan = await validateMultiServiceAppointmentAvailabilityInTransaction(client, {
    locationId: input.locationId,
    startTime: requestedStartTime,
    manualOutsideHours: false,
    services: context.snapshots.map(({ serviceId, barberId }) => ({ serviceId, barberId })),
    excludeAppointmentId: input.appointmentId,
  }, {
    ...options,
    requiredFeatures: ["multiServiceAppointments"],
    minimumSegments: MIN_MULTI_SERVICE_SEGMENTS,
    termsSnapshot: context.snapshots,
  });

  await client.query("SET CONSTRAINTS ALL DEFERRED");
  const values: unknown[] = [];
  const plannedRows = plan.segments.map((segment, index) => {
    values.push(context.segments[index].id, utcTimestamp(segment.startTime));
    const offset = index * 2;
    return `($${offset + 1}::int, $${offset + 2}::timestamp)`;
  });
  const updatedSegments = await client.query(`
    UPDATE ${table("appointment_service_segments")} AS segment
    SET start_time = planned.start_time
    FROM (VALUES ${plannedRows.join(", ")}) AS planned(id, start_time)
    WHERE segment.id = planned.id AND segment.appointment_id = $${values.length + 1}
  `, [...values, input.appointmentId]);
  if (updatedSegments.rowCount !== plan.segments.length) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT",
      "A marcação foi alterada entretanto. Atualize a página antes de escolher outro horário.",
    );
  }

  const nextRescheduleRevision = currentRevision + 1;
  const nextNotificationRevision = Number(current.notification_revision) + 1;
  const updated = await client.query<MultiServiceRescheduleAppointmentRow>(`
    UPDATE ${table("appointments")}
    SET start_time = $1,
      reschedule_revision = $2,
      notification_revision = $3
    WHERE id = $4 AND location_id = $5 AND status = 'booked' AND reschedule_revision = $6
    RETURNING id, location_id, status, start_time, reschedule_revision, notification_revision,
      manual_outside_hours, customer_name
  `, [
    utcTimestamp(plan.startTime),
    nextRescheduleRevision,
    nextNotificationRevision,
    input.appointmentId,
    input.locationId,
    input.expectedRevision,
  ]);
  if (!updated.rows[0]) {
    throw new MultiServiceRescheduleError(
      "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT",
      "A marcação foi alterada entretanto. Atualize a página antes de escolher outro horário.",
    );
  }

  let notificationEventId: number | null = null;
  if (options.appointmentNotificationsEnabled) {
    const notification = await client.query<{ id: number }>(`
      INSERT INTO ${table("appointment_notification_events")} (
        appointment_id, event_type, event_revision, event_key, appointment_start_time,
        previous_start_time, new_start_time
      ) VALUES ($1, 'appointment_rescheduled', $2, $3, $4, $5, $4)
      RETURNING id
    `, [
      input.appointmentId,
      nextNotificationRevision,
      `appointment:${input.appointmentId}:rescheduled:${nextNotificationRevision}`,
      utcTimestamp(plan.startTime),
      utcTimestamp(new Date(current.start_time)),
    ]);
    notificationEventId = Number(notification.rows[0].id);
    if (input.reminderAvailableAt) {
      await client.query(`
        INSERT INTO ${table("appointment_notification_events")} (
          appointment_id, event_type, event_revision, event_key, available_at, appointment_start_time
        ) VALUES ($1, 'appointment_reminder_day_before', $2, $3, $4, $5)
      `, [
        input.appointmentId,
        nextNotificationRevision,
        `appointment:${input.appointmentId}:reminder_day_before:${nextNotificationRevision}`,
        utcTimestamp(input.reminderAvailableAt),
        utcTimestamp(plan.startTime),
      ]);
    }
  }

  const actor = input.actor ?? { actorType: "system" as const, actorName: "Sistema" };
  await client.query(`
    INSERT INTO ${table("audit_logs")} (
      actor_type, actor_id, actor_name, actor_user_id, actor_professional_id,
      location_id, action, entity_type, entity_id, summary, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, 'appointment.rescheduled', 'appointment', $7, $8, $9)
  `, [
    actor.actorType,
    actor.actorId ?? null,
    actor.actorName ?? null,
    actor.actorUserId ?? null,
    actor.actorProfessionalId ?? null,
    input.locationId,
    input.appointmentId,
    `Marcação multi-serviço reagendada: ${current.customer_name}`,
    serializeSafeAuditMetadata({
      previousStartTime: new Date(current.start_time).toISOString(),
      newStartTime: plan.startTime.toISOString(),
      serviceCount: plan.segments.length,
      professionalCount: new Set(plan.segments.map((segment) => segment.barberId)).size,
      executionStages: plan.segments.map((segment) => segment.executionStage),
      rescheduleRevision: nextRescheduleRevision,
    }),
  ]);

  await options.afterSegmentsRescheduled?.(client, input.appointmentId);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  return {
    appointmentId: input.appointmentId,
    previousStartTime: new Date(current.start_time),
    startTime: new Date(updated.rows[0].start_time),
    rescheduleRevision: nextRescheduleRevision,
    notificationRevision: nextNotificationRevision,
    notificationEventId,
    reused: false,
    segments: await getMultiServiceAppointmentSegmentsWithClient(client, input.appointmentId, table, "FOR SHARE"),
  };
}

async function getMultiServiceAppointmentSegmentsWithClient(
  client: PoolClient,
  appointmentId: number,
  table: (name: string) => string,
  lock = "",
) {
  const result = await client.query<Parameters<typeof mapStoredSegment>[0]>(`
    SELECT id, appointment_id, position, execution_stage, service_id, barber_id, start_time,
      duration_minutes, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      service_name_snapshot, service_price_cents_snapshot
    FROM ${table("appointment_service_segments")}
    WHERE appointment_id = $1
    ORDER BY position
    ${lock}
  `, [appointmentId]);
  return result.rows.map(mapStoredSegment);
}

export async function rescheduleMultiServiceAppointmentWithPool(
  databasePool: Pool,
  input: RescheduleMultiServiceAppointmentInput,
  options: MultiServiceEngineOptions = {},
) {
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    const result = await rescheduleMultiServiceAppointmentInTransaction(client, input, options);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (databaseCode(error) === "23P01") throw new MultiServiceConflictError();
    throw error;
  } finally {
    client.release();
  }
}
