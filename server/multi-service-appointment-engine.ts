import type { Pool, PoolClient } from "pg";
import { pool as applicationPool } from "./db";
import { parseBeautyV2MasterSwitch } from "@shared/business/v2-features";
import {
  assertMultiServicePlanFitsWorkingPeriods,
  planMultiServiceAppointment,
  type MultiServiceAppointmentPlan,
  type MultiServiceSegmentTerms,
  type MultiServiceWorkingPeriod,
} from "@shared/multi-service-appointments";
import { getCalendarDateTimeParts } from "./calendar-timezone";

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

export type StoredMultiServiceSegment = {
  id: number;
  appointmentId: number;
  position: number;
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

type MultiServiceEngineOptions = {
  masterEnabled?: boolean;
  businessVertical?: string;
  afterSegmentsInserted?: (client: PoolClient, appointmentId: number) => Promise<void>;
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

async function assertFeatureEnabled(
  client: PoolClient,
  locationId: number,
  options: MultiServiceEngineOptions,
  table: (name: string) => string,
) {
  const masterEnabled = options.masterEnabled
    ?? parseBeautyV2MasterSwitch(process.env.BEAUTY_V2_FEATURES_ENABLED);
  const vertical = (options.businessVertical ?? process.env.BUSINESS_VERTICAL ?? "barber").trim().toLowerCase();
  if (!masterEnabled || vertical !== "beauty") throw new MultiServiceFeatureDisabledError();

  const settings = await client.query<{ location_id: number | null; enabled: boolean }>(`
    SELECT location_id, enabled
    FROM ${table("business_feature_settings")}
    WHERE feature_name = 'multiServiceAppointments'
      AND (location_id IS NULL OR location_id = $1)
    ORDER BY location_id NULLS FIRST
    FOR SHARE
  `, [locationId]);
  let enabled = false;
  for (const setting of settings.rows) enabled = Boolean(setting.enabled);
  if (!enabled) throw new MultiServiceFeatureDisabledError();
}

async function resolveTerms(
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
) {
  const barberIds = Array.from(new Set(plan.segments.map((segment) => segment.barberId)));
  const [shopResult, barberResult] = await Promise.all([
    client.query<{ day_of_week: number; start_time: string; end_time: string; is_open: boolean }>(`
      SELECT day_of_week, start_time, end_time, is_open
      FROM ${table("shop_availability")}
      WHERE location_id = $1
      ORDER BY day_of_week, start_time, end_time
      FOR SHARE
    `, [locationId]),
    client.query<{ barber_id: number; day_of_week: number; start_time: string; end_time: string; is_working: boolean }>(`
      SELECT barber_id, day_of_week, start_time, end_time, is_working
      FROM ${table("barber_availability")}
      WHERE location_id = $1 AND barber_id = ANY($2::int[])
      ORDER BY barber_id, day_of_week, start_time, end_time
      FOR SHARE
    `, [locationId, barberIds]),
  ]);

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

export async function createMultiServiceAppointmentWithPool(
  databasePool: Pool,
  input: CreateMultiServiceAppointmentInput,
  options: MultiServiceEngineOptions = {},
): Promise<CreatedMultiServiceAppointment> {
  const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
  const schema = quoteIdentifier(schemaName);
  const table = (name: string) => `${schema}.${quoteIdentifier(name)}`;
  const client = await databasePool.connect();

  try {
    await client.query("BEGIN");
    await assertFeatureEnabled(client, input.locationId, options, table);
    const location = await client.query<{ id: number; timezone: string }>(`
      SELECT id, timezone FROM ${table("locations")}
      WHERE id = $1 AND is_active = true
      FOR SHARE
    `, [input.locationId]);
    if (!location.rows[0]) throw new MultiServiceScopeError("A localização não está disponível.");

    const terms = await resolveTerms(client, input.locationId, input.services, table);
    const plan = planMultiServiceAppointment(input.startTime, terms);
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
        LIMIT 1
      `, [period.barberId, utcTimestamp(period.endTime), utcTimestamp(period.startTime)]);
      if (conflict.rowCount) throw new MultiServiceConflictError();
    }

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
    await client.query(`
      INSERT INTO ${table("appointment_service_sets")} (appointment_id)
      VALUES ($1)
    `, [appointmentId]);

    const storedSegments: StoredMultiServiceSegment[] = [];
    for (const segment of plan.segments) {
      const result = await client.query<{
        id: number;
        appointment_id: number;
        position: number;
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
          appointment_id, position, service_id, barber_id, start_time, duration_minutes,
          buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
          service_name_snapshot, service_price_cents_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, appointment_id, position, service_id, barber_id, start_time, duration_minutes,
          buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
          service_name_snapshot, service_price_cents_snapshot
      `, [
        appointmentId,
        segment.position,
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

    await options.afterSegmentsInserted?.(client, appointmentId);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
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
    SELECT id, appointment_id, position, service_id, barber_id, start_time, duration_minutes,
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
