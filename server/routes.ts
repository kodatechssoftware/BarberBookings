import type { Express } from "express";
import type { Server } from "http";
import type { NextFunction, Request, Response } from "express";
import { isAppointmentConflictError, storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  sendBookingCancellationConfirmation,
  sendBookingConfirmation,
} from "./email";
import {
  sendBookingWhatsAppCancellation,
  sendBookingWhatsAppConfirmation,
} from "./whatsapp";
import { pool } from "./db";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { parseISO, format, isValid, startOfDay, endOfDay } from "date-fns";
import { pt } from "date-fns/locale";
import ExcelJS from 'exceljs';
import { appointmentStatuses, insertServiceSchema, type Appointment } from "@shared/schema";
import {
  emailValidationMessage,
  isValidOptionalEmail,
  normalizeEmail,
  normalizePortuguesePhone,
} from "@shared/customer-validation";
import {
  normalizeSupportedPhone,
  supportedPhoneValidationMessage,
  supportedPhonesMatch,
} from "@shared/phone-countries";

const PostgresSessionStore = connectPg(session);

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const SHOP_TIME_ZONE = process.env.SHOP_TIME_ZONE || "Europe/Lisbon";
const CANCELLATION_POLICY_HOURS = Number(process.env.CANCELLATION_POLICY_HOURS || 4);
const DEPOSIT_LONG_SERVICE_MINUTES = Number(process.env.DEPOSIT_LONG_SERVICE_MINUTES || 45);
const DEPOSIT_RISK_THRESHOLD = Number(process.env.DEPOSIT_RISK_THRESHOLD || 2);
const BARBER_INVITE_EXPIRY_DAYS = Number(process.env.BARBER_INVITE_EXPIRY_DAYS || 7);
const isProduction = process.env.NODE_ENV === "production";
const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true";
const databaseSchema = process.env.DATABASE_SCHEMA?.trim();
const sessionSchemaName =
  databaseSchema && databaseSchema !== "public" ? databaseSchema : undefined;

function quoteSqlIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

async function ensureSessionStoreTable() {
  if (useMemoryStorage) return;

  const schemaName = sessionSchemaName || "public";
  const qualifiedTableName = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier("session")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedTableName} (
      sid varchar NOT NULL COLLATE "default",
      sess json NOT NULL,
      expire timestamp(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire"
    ON ${qualifiedTableName} (expire)
  `);
}

const shopDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const shopDateTimeFormatter = new Intl.DateTimeFormat("pt-PT", {
  timeZone: SHOP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const weekdays: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function formatShopDateTime(date: Date) {
  return shopDateTimeFormatter.format(date).replace(",", "");
}

const appointmentStatusSet = new Set<string>(appointmentStatuses);
const appointmentStatusLabels: Record<Appointment["status"], string> = {
  booked: "Marcada",
  completed: "Concluída",
  cancelled: "Cancelada",
  late_cancelled: "Cancelamento tardio",
  no_show: "Falta",
};

type AppSession = session.Session & Partial<session.SessionData> & {
  adminId?: number;
  barberId?: number;
  role?: "admin" | "barber";
};

const customerNotesInputSchema = z.object({
  customerName: z.string().trim().max(120, "O nome não pode ter mais de 120 caracteres.").optional(),
  email: z.string().email().or(z.literal("")).optional(),
  notes: z.string().max(1200, "As notas não podem ter mais de 1200 caracteres."),
});

const barberUpdateInputSchema = api.barbers.create.input.partial();

const blacklistInputSchema = z.object({
  phone: z
    .string()
    .transform((value) => {
      const normalizedPhone = normalizeSupportedPhone(value);
      return normalizedPhone.startsWith("+351") ? normalizedPhone.slice(4) : normalizedPhone;
    })
    .refine((value) => Boolean(normalizeSupportedPhone(value)), supportedPhoneValidationMessage),
  email: z
    .string()
    .nullish()
    .transform((value) => normalizeEmail(value))
    .refine(isValidOptionalEmail, emailValidationMessage),
  reason: z.string().trim().max(500).optional(),
  cancelFutureAppointments: z.boolean().optional(),
});

let blacklistMutationQueue: Promise<void> = Promise.resolve();

async function withBlacklistMutationLock<T>(callback: () => Promise<T>): Promise<T> {
  const previousMutation = blacklistMutationQueue;
  let releaseMutation!: () => void;
  blacklistMutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await previousMutation;
  try {
    return await callback();
  } finally {
    releaseMutation();
  }
}

function getAppSession(req: Request) {
  return req.session as AppSession;
}

type AuditLogInput = {
  actorType?: string;
  actorId?: number | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary: string;
  metadata?: Record<string, unknown> | string | null;
};

async function getAuditActor(req: Request) {
  const appSession = getAppSession(req);

  if (appSession.role === "barber" && appSession.barberId) {
    const barber = await storage.getBarber(appSession.barberId);
    return {
      actorType: "barber",
      actorId: appSession.barberId,
      actorName: barber?.name || "Barbeiro",
    };
  }

  if (appSession.role === "admin" && appSession.adminId) {
    return {
      actorType: "admin",
      actorId: appSession.adminId,
      actorName: "Administrador",
    };
  }

  return {
    actorType: "system",
    actorId: null,
    actorName: "Sistema",
  };
}

function recordAuditLog(req: Request, input: AuditLogInput) {
  void (async () => {
    try {
      const actor = input.actorType
        ? {
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            actorName: input.actorName ?? null,
          }
        : await getAuditActor(req);

      const metadata = input.metadata
        ? typeof input.metadata === "string"
          ? input.metadata
          : JSON.stringify(input.metadata)
        : null;

      await storage.createAuditLog({
        ...actor,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Audit log skipped:", message);
    }
  })();
}

function getSessionSameSite(): "lax" | "strict" | "none" {
  const value = (process.env.SESSION_SAME_SITE || (isProduction ? "none" : "lax")).toLowerCase();

  if (value === "strict" || value === "none") {
    return value;
  }

  return "lax";
}

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function getShopDateParts(date: Date) {
  const parts = Object.fromEntries(
    shopDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday] ?? -1,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isBeforeShopToday(date: Date) {
  return getShopDateParts(date).dateKey < getShopDateParts(new Date()).dateKey;
}

function isBeforeNow(date: Date) {
  return date.getTime() < Date.now();
}

function addDaysToShopCalendarDate(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getShopTimeZoneOffsetMs(date: Date) {
  const parts = getShopDateParts(date);
  const shopTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );

  return shopTimeAsUtc - date.getTime();
}

function createShopDateTime(year: number, month: number, day: number, hour: number, minute: number) {
  const shopTimeAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let result = new Date(shopTimeAsUtc - getShopTimeZoneOffsetMs(new Date(shopTimeAsUtc)));
  const adjustedResult = new Date(shopTimeAsUtc - getShopTimeZoneOffsetMs(result));

  if (adjustedResult.getTime() !== result.getTime()) {
    result = adjustedResult;
  }

  return result;
}

function addWeeksPreservingShopTime(startTime: Date, weeks: number) {
  const start = getShopDateParts(startTime);
  const targetDate = addDaysToShopCalendarDate(start.year, start.month, start.day, weeks * 7);

  return createShopDateTime(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    start.hour,
    start.minute,
  );
}

type MinutePeriod = { start: number; end: number };

function getDefaultShopWorkingPeriods(weekday: number): MinutePeriod[] {
  if (weekday === 1) {
    return [{ start: 14 * 60, end: 20 * 60 }];
  }

  if (weekday >= 2 && weekday <= 5) {
    return [
      { start: 9 * 60, end: 13 * 60 },
      { start: 14 * 60, end: 20 * 60 },
    ];
  }

  if (weekday === 6) {
    return [
      { start: 9 * 60, end: 13 * 60 },
      { start: 14 * 60, end: 19 * 60 },
    ];
  }

  return [];
}

function getDefaultShopAvailabilityRows() {
  return [
    { dayOfWeek: 0, startTime: "09:00", endTime: "13:00", isOpen: false },
    { dayOfWeek: 1, startTime: "14:00", endTime: "20:00", isOpen: true },
    { dayOfWeek: 2, startTime: "09:00", endTime: "13:00", isOpen: true },
    { dayOfWeek: 2, startTime: "14:00", endTime: "20:00", isOpen: true },
    { dayOfWeek: 3, startTime: "09:00", endTime: "13:00", isOpen: true },
    { dayOfWeek: 3, startTime: "14:00", endTime: "20:00", isOpen: true },
    { dayOfWeek: 4, startTime: "09:00", endTime: "13:00", isOpen: true },
    { dayOfWeek: 4, startTime: "14:00", endTime: "20:00", isOpen: true },
    { dayOfWeek: 5, startTime: "09:00", endTime: "13:00", isOpen: true },
    { dayOfWeek: 5, startTime: "14:00", endTime: "20:00", isOpen: true },
    { dayOfWeek: 6, startTime: "09:00", endTime: "13:00", isOpen: true },
    { dayOfWeek: 6, startTime: "14:00", endTime: "19:00", isOpen: true },
  ];
}

async function ensureDefaultShopAvailability() {
  const availability = await storage.getShopAvailability();
  if (availability.length === 0) {
    await storage.replaceShopAvailability(getDefaultShopAvailabilityRows());
  }
}

function parseTimeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function normalizePhone(value?: string | null) {
  const supportedPhone = normalizeSupportedPhone(value);
  if (supportedPhone) return supportedPhone;

  const trimmed = (value || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (trimmed.startsWith("00")) return `+${digits.slice(2)}`;
  return digits;
}

function normalizeCustomerPhoneForStorage(value?: string | null) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }

  if (trimmed.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  const portuguesePhone = normalizePortuguesePhone(trimmed);
  if (/^9\d{8}$/.test(portuguesePhone)) {
    return `+351${portuguesePhone}`;
  }

  return digits;
}

function normalizeCustomerName(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function customerContactMatches(appointment: Appointment, phone?: string, email?: string) {
  const samePhone = phone && normalizePhone(appointment.customerPhone) === phone;
  const sameEmail = email && appointment.customerEmail?.toLowerCase() === email;
  return Boolean(samePhone || sameEmail);
}

function customerNameMatches(appointment: Appointment, customerNameKey?: string) {
  return !customerNameKey || normalizeCustomerName(appointment.customerName) === customerNameKey;
}

function customerIdentityMatches(
  appointment: Appointment,
  phone?: string,
  email?: string,
  customerNameKey?: string,
) {
  return customerContactMatches(appointment, phone, email) && customerNameMatches(appointment, customerNameKey);
}

function isKnownAppointmentStatus(status: unknown): status is Appointment["status"] {
  return typeof status === "string" && appointmentStatusSet.has(status);
}

function getStatusPatch(status: Appointment["status"]) {
  const patch: { status: Appointment["status"]; cancelledAt?: Date | null } = { status };

  if (status === "cancelled" || status === "late_cancelled") {
    patch.cancelledAt = new Date();
  }

  if (status === "booked" || status === "completed") {
    patch.cancelledAt = null;
  }

  return patch;
}

async function getFutureBookedCustomerAppointments(phone: string, email?: string) {
  const now = new Date();
  return (await storage.getAppointments())
    .filter((appointment) =>
      appointment.status === "booked" &&
      new Date(appointment.startTime).getTime() >= now.getTime() &&
      customerContactMatches(appointment, phone, email)
    )
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

async function getBlacklistAppointmentSummaries(appointments: Appointment[]) {
  const [barbers, services] = await Promise.all([
    storage.getBarbers(),
    storage.getServices(),
  ]);
  const barbersById = new Map(barbers.map((barber) => [barber.id, barber]));
  const servicesById = new Map(services.map((service) => [service.id, service]));

  return appointments.map((appointment) => ({
    id: appointment.id,
    barberId: appointment.barberId,
    barberName: barbersById.get(appointment.barberId)?.name || "Barbeiro desconhecido",
    serviceId: appointment.serviceId,
    serviceName: appointment.serviceId
      ? servicesById.get(appointment.serviceId)?.name || "Serviço indisponível"
      : "Sem serviço",
    startTime: appointment.startTime,
    durationMinutes: appointment.durationMinutes,
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
  }));
}

function buildBarberServiceMap(rows: Array<{ barberId: number; serviceId: number }>) {
  const map = new Map<number, number[]>();
  rows.forEach((row) => {
    const current = map.get(row.barberId) || [];
    current.push(row.serviceId);
    map.set(row.barberId, current);
  });
  return map;
}

function barberCanPerformService(
  barberServiceMap: Map<number, number[]>,
  barberId: number,
  serviceId?: number | null,
) {
  if (!serviceId) return true;
  const serviceIds = barberServiceMap.get(barberId) || [];
  return serviceIds.length === 0 || serviceIds.includes(serviceId);
}

async function normalizeBarberServiceIds(serviceIds: number[] | undefined) {
  if (serviceIds === undefined) return undefined;

  const allServices = await storage.getServices();
  const existingServiceIds = new Set(allServices.map((service) => service.id));
  const uniqueServiceIds = Array.from(new Set(serviceIds));
  const invalidServiceId = uniqueServiceIds.find((serviceId) => !existingServiceIds.has(serviceId));

  if (invalidServiceId) {
    throw new Error("Serviço inválido para este barbeiro.");
  }

  return uniqueServiceIds.length >= allServices.length ? [] : uniqueServiceIds;
}

function normalizeBarberEmail<T extends { email?: string | null }>(barberInput: T) {
  if (!("email" in barberInput)) return barberInput;

  const email = typeof barberInput.email === "string" ? barberInput.email.trim() : barberInput.email;
  return {
    ...barberInput,
    email: email || null,
  };
}

async function getBarbersWithServiceIds() {
  const [barbers, serviceRows] = await Promise.all([
    storage.getBarbers(),
    storage.getAllBarberServices(),
  ]);
  const barberServiceMap = buildBarberServiceMap(serviceRows);

  return barbers.map((barber) => ({
    ...barber,
    serviceIds: barberServiceMap.get(barber.id) || [],
  }));
}

async function freezeUniversalBarberServiceAssignments(existingServiceIds: number[]) {
  if (existingServiceIds.length === 0) return;

  const [barbers, serviceRows] = await Promise.all([
    storage.getBarbers(),
    storage.getAllBarberServices(),
  ]);
  const barberServiceMap = buildBarberServiceMap(serviceRows);

  await Promise.all(
    barbers
      .filter((barber) => (barberServiceMap.get(barber.id) || []).length === 0)
      .map((barber) => storage.replaceBarberServices(barber.id, existingServiceIds)),
  );
}

function sanitizeBarberForResponse<T extends { email?: unknown; password?: unknown }>(
  barber: T,
  includePrivateFields = false,
) {
  const { email, password: _password, ...publicBarber } = barber;
  return includePrivateFields ? { ...publicBarber, email } : publicBarber;
}

function isLateCancellation(startTime: Date | string) {
  const appointmentDate = toDate(startTime);
  const millisecondsUntilAppointment = appointmentDate.getTime() - Date.now();
  return millisecondsUntilAppointment < CANCELLATION_POLICY_HOURS * 60 * 60 * 1000;
}

function getCustomerMetrics(
  appointments: Appointment[],
  phone?: string | null,
  email?: string | null,
) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = (email || "").trim().toLowerCase();

  const matches = appointments.filter((appointment) => {
    const samePhone = normalizedPhone && normalizePhone(appointment.customerPhone) === normalizedPhone;
    const sameEmail = normalizedEmail && appointment.customerEmail?.toLowerCase() === normalizedEmail;
    return samePhone || sameEmail;
  });

  const sortedDesc = [...matches].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );

  return {
    total: matches.length,
    booked: matches.filter((appointment) => appointment.status === "booked").length,
    completed: matches.filter((appointment) => appointment.status === "completed").length,
    cancelled: matches.filter((appointment) => appointment.status === "cancelled").length,
    lateCancelled: matches.filter((appointment) => appointment.status === "late_cancelled").length,
    noShows: matches.filter((appointment) => appointment.status === "no_show").length,
    lastPresence:
      sortedDesc.find((appointment) => appointment.status === "completed")?.startTime || null,
  };
}

function getDepositRecommendation(params: {
  previousAppointments: Appointment[];
  customerPhone?: string | null;
  customerEmail?: string | null;
  serviceDurationMinutes: number;
}) {
  const metrics = getCustomerMetrics(
    params.previousAppointments,
    params.customerPhone,
    params.customerEmail,
  );
  const riskCount = metrics.noShows + metrics.lateCancelled;
  const reasons: string[] = [];

  if (metrics.total === 0) reasons.push("cliente novo");
  if (params.serviceDurationMinutes >= DEPOSIT_LONG_SERVICE_MINUTES) {
    reasons.push(`serviço longo (${params.serviceDurationMinutes} min)`);
  }
  if (riskCount >= DEPOSIT_RISK_THRESHOLD) {
    reasons.push(`${riskCount} faltas/cancelamentos tardios`);
  }

  return {
    required: reasons.length > 0,
    reason: reasons.join(", ") || null,
    metrics,
  };
}

function buildPublicUrl(path: string) {
  const configuredUrl =
    process.env.PUBLIC_URL ||
    process.env.APP_BASE_URL ||
    (process.env.REPL_SLUG && process.env.REPL_OWNER
      ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : "http://localhost:5000");

  return `${configuredUrl.replace(/\/$/, "")}${path}`;
}

type BookingCreatedNotificationParams = {
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  barberName?: string;
  serviceName: string;
  startTime: Date;
  cancelToken: string;
  durationMinutes: number;
  depositRequired: boolean;
  depositReason?: string | null;
};

type NotificationChannel = "whatsapp" | "email" | "none";

function runNotificationJob(
  label: string,
  task: () => Promise<NotificationChannel>,
) {
  void task()
    .then((channel) => {
      console.log(`${label} notification finished via ${channel}.`);
    })
    .catch((error) => {
      console.error(`${label} notification failed:`, error);
    });
}

async function sendBookingCreatedNotification(params: BookingCreatedNotificationParams) {
  let whatsappSent = false;

  try {
    whatsappSent = await sendBookingWhatsAppConfirmation({
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      barberName: params.barberName,
      serviceName: params.serviceName,
      startTime: params.startTime,
      cancelUrl: buildPublicUrl(`/cancel/${params.cancelToken}`),
    });
  } catch (error) {
    console.error("WhatsApp booking confirmation failed; trying email fallback:", error);
  }

  if (whatsappSent) return "whatsapp";
  if (!params.customerEmail) return "none";

  const emailSent = await sendBookingConfirmation({
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    barberName: params.barberName || "Barbeiro indisponível",
    serviceName: params.serviceName,
    startTime: params.startTime,
    cancelToken: params.cancelToken,
    durationMinutes: params.durationMinutes,
    depositRequired: params.depositRequired,
    depositReason: params.depositReason,
    cancellationPolicyHours: CANCELLATION_POLICY_HOURS,
  });

  return emailSent ? "email" : "none";
}

type BookingCancelledNotificationParams = {
  customerName: string;
  customerEmail?: string | null;
  customerPhone: string;
  barberName?: string;
  serviceName: string;
  startTime: Date;
  lateCancellation: boolean;
};

async function sendBookingCancelledNotification(params: BookingCancelledNotificationParams) {
  let whatsappSent = false;

  try {
    whatsappSent = await sendBookingWhatsAppCancellation({
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      barberName: params.barberName,
      serviceName: params.serviceName,
      startTime: params.startTime,
    });
  } catch (error) {
    console.error("WhatsApp booking cancellation failed; trying email fallback:", error);
  }

  if (whatsappSent) return "whatsapp";
  if (!params.customerEmail) return "none";

  const emailSent = await sendBookingCancellationConfirmation({
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    barberName: params.barberName || "Barbeiro indisponível",
    serviceName: params.serviceName,
    startTime: params.startTime,
    lateCancellation: params.lateCancellation,
    cancellationPolicyHours: CANCELLATION_POLICY_HOURS,
  });

  return emailSent ? "email" : "none";
}

async function getBarberWorkingPeriods(barberId: number, weekday: number) {
  const [shopAvailability, barberAvailability] = await Promise.all([
    storage.getShopAvailability(),
    storage.getBarberAvailability(barberId),
  ]);

  const shopPeriods = shopAvailability.length === 0
    ? getDefaultShopWorkingPeriods(weekday)
    : availabilityRowsToPeriods(
        shopAvailability.filter((period) => period.dayOfWeek === weekday && period.isOpen),
      );

  if (shopPeriods.length === 0 || barberAvailability.length === 0) {
    return shopPeriods;
  }

  const barberPeriods = availabilityRowsToPeriods(
    barberAvailability.filter((period) => period.dayOfWeek === weekday && period.isWorking),
  );

  return intersectWorkingPeriods(shopPeriods, barberPeriods);
}

function availabilityRowsToPeriods(rows: Array<{ startTime: string; endTime: string }>): MinutePeriod[] {
  return rows
    .map((period) => ({
      start: parseTimeToMinutes(period.startTime),
      end: parseTimeToMinutes(period.endTime),
    }))
    .filter((period): period is MinutePeriod =>
      period.start !== null && period.end !== null && period.end > period.start,
    );
}

function intersectWorkingPeriods(primaryPeriods: MinutePeriod[], overridePeriods: MinutePeriod[]) {
  const intersections: MinutePeriod[] = [];

  for (const primary of primaryPeriods) {
    for (const override of overridePeriods) {
      const start = Math.max(primary.start, override.start);
      const end = Math.min(primary.end, override.end);
      if (end > start) {
        intersections.push({ start, end });
      }
    }
  }

  return intersections;
}

function getScheduleValidationError(
  startTime: Date,
  durationMinutes: number,
  workingPeriods?: { start: number; end: number }[],
) {
  if (Number.isNaN(startTime.getTime())) {
    return "Data ou hora inválida.";
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return "Duração inválida.";
  }

  const start = getShopDateParts(startTime);
  const end = getShopDateParts(new Date(startTime.getTime() + durationMinutes * 60000));

  if (start.weekday < 0 || Number.isNaN(start.hour) || Number.isNaN(start.minute)) {
    return "Data ou hora inválida.";
  }

  if (start.minute % 30 !== 0) {
    return "As marcações só podem começar de 30 em 30 minutos.";
  }

  const periods = workingPeriods ?? getDefaultShopWorkingPeriods(start.weekday);
  if (periods.length === 0) {
    return "A barbearia está encerrada neste dia.";
  }

  if (start.dateKey !== end.dateKey) {
    return "A marcação não cabe dentro do horário de funcionamento da barbearia.";
  }

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const fitsWorkingPeriod = periods.some(
    (period) => startMinutes >= period.start && endMinutes <= period.end,
  );

  if (!fitsWorkingPeriod) {
    return "A marcação não cabe dentro do horário de funcionamento da barbearia.";
  }

  return null;
}

type AppointmentLike = {
  id?: number;
  barberId: number;
  serviceId: number | null;
  startTime: Date | string;
  durationMinutes?: number;
  status: string;
};

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function getAppointmentDurationMinutes(
  serviceId: number | null | undefined,
  serviceDurations: Map<number, number>,
) {
  if (!serviceId) return DEFAULT_APPOINTMENT_DURATION_MINUTES;
  return serviceDurations.get(serviceId) ?? DEFAULT_APPOINTMENT_DURATION_MINUTES;
}

function getEffectiveAppointmentDurationMinutes(
  appointment: Pick<AppointmentLike, "serviceId" | "durationMinutes">,
  serviceDurations: Map<number, number>,
) {
  const serviceDuration = getAppointmentDurationMinutes(appointment.serviceId, serviceDurations);
  const storedDuration = appointment.durationMinutes;

  if (typeof storedDuration !== "number" || !Number.isFinite(storedDuration) || storedDuration <= 0) {
    return serviceDuration;
  }

  if (
    appointment.serviceId &&
    storedDuration === DEFAULT_APPOINTMENT_DURATION_MINUTES &&
    serviceDuration !== DEFAULT_APPOINTMENT_DURATION_MINUTES
  ) {
    return serviceDuration;
  }

  return storedDuration;
}

function getAppointmentEndTime(
  appointment: AppointmentLike,
  serviceDurations: Map<number, number>,
) {
  const startTime = toDate(appointment.startTime);
  const durationMinutes = getEffectiveAppointmentDurationMinutes(appointment, serviceDurations);
  return new Date(startTime.getTime() + durationMinutes * 60000);
}

function hasAppointmentConflict(
  appointments: AppointmentLike[],
  barberId: number,
  startTime: Date,
  endTime: Date,
  serviceDurations: Map<number, number>,
  ignoreAppointmentId?: number,
) {
  return appointments.some((appointment) => {
    if (appointment.barberId !== barberId) return false;
    if (appointment.status !== "booked") return false;
    if (ignoreAppointmentId !== undefined && appointment.id === ignoreAppointmentId) return false;

    const appointmentStart = toDate(appointment.startTime);
    const appointmentEnd = getAppointmentEndTime(appointment, serviceDurations);

    return startTime < appointmentEnd && endTime > appointmentStart;
  });
}

function isOperationalAppointment(appointment: Appointment) {
  const name = appointment.customerName.trim().toUpperCase();
  return ![
    "BLOQUEIO MANUAL",
    "AUSÊNCIA",
    "AUSENCIA",
    "FÉRIAS",
    "FERIAS",
  ].some((marker) => name.includes(marker)) && !name.startsWith("RECORRENTE:");
}

function getAppointmentStatusLabel(status: Appointment["status"]) {
  return appointmentStatusLabels[status] || status;
}

function getServicePriceCents(serviceId: number | null, servicePrices: Map<number, number>) {
  return serviceId ? servicePrices.get(serviceId) ?? 0 : 0;
}

function centsToEuros(cents: number) {
  return cents / 100;
}

function addCalendarDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function createDashboardDays(start: Date, end: Date) {
  const days: Array<{ key: string; label: string }> = [];
  let cursor = startOfDay(start);
  const lastDay = startOfDay(end);

  while (cursor <= lastDay) {
    days.push({
      key: format(cursor, "yyyy-MM-dd"),
      label: format(cursor, "dd/MM"),
    });
    cursor = addCalendarDays(cursor, 1);
  }

  return days;
}

function getCustomerIdentity(appointment: Appointment) {
  const phone = normalizePhone(appointment.customerPhone);
  const email = appointment.customerEmail?.trim().toLowerCase() || "";
  const contact = phone || email;
  const name = normalizeCustomerName(appointment.customerName);
  if (!contact) return "";
  return name ? `${contact}:${name}` : contact;
}

export async function registerRoutes(
  app: Express,
  httpServer: Server
): Promise<Server> {
  // Session middleware
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "baptista-barber-shop-secret",
    resave: false,
    saveUninitialized: false,
    proxy: isProduction,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: getSessionSameSite(),
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };

  if (!useMemoryStorage) {
    await ensureSessionStoreTable();
    sessionConfig.store = new PostgresSessionStore({
      pool,
      schemaName: sessionSchemaName,
      createTableIfMissing: false,
    });
  }

  app.use(session(sessionConfig));

  // === AUTH ===
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Try admin login first
      const admin = await storage.getAdminByUsername(username);
      if (admin && (await bcrypt.compare(password, admin.password))) {
        const appSession = getAppSession(req);
        appSession.adminId = admin.id;
        delete appSession.barberId;
        appSession.role = "admin";
        await saveSession(req);
        return res.json({
          message: "Login efetuado com sucesso",
          authorized: true,
          role: "admin",
          id: admin.id,
        });
      }

      // Try barber login if admin fails
      const barber = await storage.getBarberByEmail(username);
      if (barber) {
        if (!barber.password) {
          return res.status(403).json({
            message: "A palavra-passe ainda não foi definida. Peça ao administrador um convite de acesso.",
          });
        }
        
        if (await bcrypt.compare(password, barber.password)) {
          const appSession = getAppSession(req);
          appSession.barberId = barber.id;
          delete appSession.adminId;
          appSession.role = "barber";
          await saveSession(req);
          return res.json({
            message: "Login efetuado com sucesso",
            authorized: true,
            role: "barber",
            id: barber.id,
            name: barber.name,
            email: barber.email,
          });
        }
      }

      return res.status(401).json({ message: "Utilizador ou palavra-passe incorretos" });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ message: "Erro interno do servidor" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Erro ao sair" });
      }
      return res.json({ message: "Logout efetuado" });
    });
  });

  app.get("/api/admin/me", async (req, res) => {
    const appSession = getAppSession(req);
    if (!appSession.adminId && !appSession.barberId) {
      return res.json({ authorized: false, role: "" });
    }
    const role = appSession.role;
    const id = appSession.adminId || appSession.barberId;
    
    let userDetails = {};
    if (role === "barber") {
      const barber = appSession.barberId ? await storage.getBarber(appSession.barberId) : undefined;
      userDetails = { name: barber?.name, email: barber?.email };
    }
    
    return res.json({ authorized: true, role, id, ...userDetails });
  });

  // Auth Middleware for admin routes
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (getAppSession(req).role !== "admin") return res.status(401).json({ message: "Não autorizado" });
    next();
  };

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const appSession = getAppSession(req);
    if (!appSession.adminId && !appSession.barberId) return res.status(401).json({ message: "Não autorizado" });
    next();
  };

  app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
    try {
      const requestedLimit = Number(req.query.limit || 30);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
        : 30;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error) {
      console.warn("Could not load audit logs:", error instanceof Error ? error.message : error);
      res.json([]);
    }
  });

  // === BARBERS MGMT ===
  app.post("/api/barbers", requireAdmin, async (req, res) => {
    try {
      const input = api.barbers.create.input.parse(req.body);
      const { serviceIds, ...barberInput } = input;
      const barber = await storage.createBarber(normalizeBarberEmail(barberInput));
      const normalizedServiceIds = await normalizeBarberServiceIds(serviceIds);
      if (normalizedServiceIds !== undefined) {
        await storage.replaceBarberServices(barber.id, normalizedServiceIds);
      }
      await recordAuditLog(req, {
        action: "barber.created",
        entityType: "barber",
        entityId: barber.id,
        summary: `Barbeiro criado: ${barber.name}`,
        metadata: { serviceIds: normalizedServiceIds || [] },
      });
      res.status(201).json({ ...barber, serviceIds: normalizedServiceIds || [] });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      if (error instanceof Error && error.message === "Serviço inválido para este barbeiro.") {
        return res.status(400).json({ message: error.message });
      }
      console.error("Create barber error:", error);
      res.status(500).json({ message: "Erro ao criar barbeiro" });
    }
  });

  app.patch("/api/barbers/:id", requireAdmin, async (req, res) => {
    try {
      const barberId = Number(req.params.id);
      const input = barberUpdateInputSchema.parse(req.body);
      const { serviceIds, ...barberPatch } = input;
      const existing = await storage.getBarber(barberId);
      if (!existing) return res.status(404).json({ message: "Barbeiro não encontrado" });

      const hasBarberPatch = Object.keys(barberPatch).length > 0;
      const barber = hasBarberPatch
        ? await storage.updateBarber(barberId, normalizeBarberEmail(barberPatch))
        : existing;

      const normalizedServiceIds = await normalizeBarberServiceIds(serviceIds);
      if (normalizedServiceIds !== undefined) {
        await storage.replaceBarberServices(barberId, normalizedServiceIds);
      }

      const currentServiceIds = normalizedServiceIds ?? await storage.getBarberServiceIds(barberId);
      const updatedBarber = barber || existing;
      await recordAuditLog(req, {
        action: "barber.updated",
        entityType: "barber",
        entityId: barberId,
        summary: `Barbeiro atualizado: ${updatedBarber.name}`,
        metadata: {
          fields: [
            ...Object.keys(barberPatch),
            ...(normalizedServiceIds !== undefined ? ["serviceIds"] : []),
          ],
          previousColor: existing.color,
          newColor: updatedBarber.color,
          serviceIds: currentServiceIds,
        },
      });
      res.json({ ...updatedBarber, serviceIds: currentServiceIds });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      if (error instanceof Error && error.message === "Serviço inválido para este barbeiro.") {
        return res.status(400).json({ message: error.message });
      }
      console.error("Update barber error:", error);
      res.status(500).json({ message: "Erro ao atualizar barbeiro" });
    }
  });

  app.patch("/api/barbers/:id/services", requireAdmin, async (req, res) => {
    try {
      const barberId = Number(req.params.id);
      const barber = await storage.getBarber(barberId);
      if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado" });

      const parsed = z.object({
        serviceIds: z.array(z.number().int().positive()),
      }).parse(req.body);
      const normalizedServiceIds = await normalizeBarberServiceIds(parsed.serviceIds);
      await storage.replaceBarberServices(barberId, normalizedServiceIds || []);
      await recordAuditLog(req, {
        action: "barber.services_updated",
        entityType: "barber",
        entityId: barberId,
        summary: `Serviços do barbeiro atualizados: ${barber.name}`,
        metadata: { serviceIds: normalizedServiceIds || [] },
      });
      res.json({ ...barber, serviceIds: normalizedServiceIds || [] });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      if (error instanceof Error && error.message === "Serviço inválido para este barbeiro.") {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Erro ao atualizar barbeiro" });
    }
  });

  app.get("/api/barbers/:id/future-appointments", requireAdmin, async (req, res) => {
    try {
      const barberId = Number(req.params.id);
      if (!Number.isFinite(barberId) || barberId <= 0) {
        return res.status(400).json({ message: "Barbeiro inválido." });
      }

      const barber = await storage.getBarber(barberId);
      if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado" });

      const now = new Date();
      const futureAppointments = (await storage.getAppointments(barberId))
        .filter((appointment) =>
          appointment.status === "booked" &&
          new Date(appointment.startTime).getTime() >= now.getTime()
        )
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      res.json(futureAppointments);
    } catch (error) {
      console.error("Future barber appointments error:", error);
      res.status(500).json({ message: "Erro ao carregar marcações futuras do barbeiro" });
    }
  });

  app.delete("/api/barbers/:id", requireAdmin, async (req, res) => {
    try {
      const barberId = Number(req.params.id);
      const barber = await storage.getBarber(barberId);
      const result = await storage.deleteBarber(barberId);
      const wasHidden = result === "hidden";
      await recordAuditLog(req, {
        action: wasHidden ? "barber.hidden" : "barber.deleted",
        entityType: "barber",
        entityId: barberId,
        summary: wasHidden
          ? `Barbeiro ocultado por ter histórico: ${barber?.name || barberId}`
          : `Barbeiro removido: ${barber?.name || barberId}`,
      });
      res.json({
        message: wasHidden
          ? "O barbeiro foi ocultado porque tem histórico de marcações. Não aparece no site nem pode receber novas reservas."
          : "Barbeiro removido.",
      });
    } catch (error: any) {
      if (error?.code === "BARBER_HAS_FUTURE_APPOINTMENTS") {
        return res.status(409).json({
          message: "Este barbeiro tem marcações futuras. Reatribua ou cancele essas marcações antes de o remover.",
        });
      }
      if (error?.code === "23503") {
        return res.status(409).json({ message: "Não é possível remover este barbeiro porque existem dados associados." });
      }
      res.status(500).json({ message: "Erro ao remover barbeiro" });
    }
  });

  app.patch("/api/barbers/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateBarber(Number(req.params.id), { password: null });
      if (!updated) return res.status(404).json({ message: "Barbeiro não encontrado" });
      await recordAuditLog(req, {
        action: "barber.password_reset",
        entityType: "barber",
        entityId: updated.id,
        summary: `Palavra-passe removida: ${updated.name}`,
      });
      res.json({ message: "Palavra-passe removida" });
    } catch (error) {
      res.status(500).json({ message: "Erro ao repor palavra-passe" });
    }
  });

  app.post("/api/barbers/:id/invite", requireAdmin, async (req, res) => {
    try {
      const barberId = Number(req.params.id);
      const barber = await storage.getBarber(barberId);
      if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado" });
      if (!barber.email) {
        return res.status(400).json({ message: "Adicione um email ao barbeiro antes de criar o convite." });
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + BARBER_INVITE_EXPIRY_DAYS);
      const token = randomUUID();

      await storage.updateBarber(barberId, { password: null });
      const invite = await storage.createBarberInvite({ barberId, token, expiresAt, usedAt: null });
      const inviteUrl = buildPublicUrl(`/barber-invite/${invite.token}`);
      await recordAuditLog(req, {
        action: "barber.invite_created",
        entityType: "barber",
        entityId: barberId,
        summary: `Convite criado para ${barber.name}`,
        metadata: { expiresAt },
      });

      res.status(201).json({
        message: "Convite criado. Envie este link ao barbeiro para definir a palavra-passe.",
        inviteUrl,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      console.error("Create barber invite error:", error);
      res.status(500).json({ message: "Erro ao criar convite de acesso" });
    }
  });

  app.get("/api/barber-invites/:token", async (req, res) => {
    const invite = await storage.getBarberInviteByToken(req.params.token);
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return res.status(404).json({ message: "Convite inválido ou expirado." });
    }

    const barber = await storage.getBarber(invite.barberId);
    if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado." });

    res.json({
      barberName: barber.name,
      barberEmail: barber.email,
      expiresAt: invite.expiresAt,
    });
  });

  app.post("/api/barber-invites/:token/accept", async (req, res) => {
    try {
      const invite = await storage.getBarberInviteByToken(req.params.token);
      if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
        return res.status(404).json({ message: "Convite inválido ou expirado." });
      }

      const password = String(req.body?.password || "");
      if (password.length < 8) {
        return res.status(400).json({ message: "A palavra-passe deve ter pelo menos 8 caracteres." });
      }

      const barber = await storage.getBarber(invite.barberId);
      if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado." });

      const hashedPassword = await bcrypt.hash(password, 10);
      await storage.updateBarber(barber.id, { password: hashedPassword });
      await storage.markBarberInviteUsed(invite.id);

      const appSession = getAppSession(req);
      appSession.barberId = barber.id;
      appSession.role = "barber";

      res.json({ message: "Palavra-passe definida com sucesso.", role: "barber" });
    } catch (error) {
      console.error("Accept barber invite error:", error);
      res.status(500).json({ message: "Erro ao aceitar convite" });
    }
  });

  // === SERVICES MGMT ===
  app.post("/api/services", requireAdmin, async (req, res) => {
    try {
      const input = insertServiceSchema.parse(req.body);
      const existingServiceIds = (await storage.getServices()).map((service) => service.id);
      await freezeUniversalBarberServiceAssignments(existingServiceIds);
      const service = await storage.createService(input);
      await recordAuditLog(req, {
        action: "service.created",
        entityType: "service",
        entityId: service.id,
        summary: `Serviço criado: ${service.name}`,
        metadata: { duration: service.duration, price: service.price },
      });
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Erro ao criar serviço" });
    }
  });

  app.patch("/api/services/:id", requireAdmin, async (req, res) => {
    try {
      const input = insertServiceSchema.partial().parse(req.body);
      const service = await storage.updateService(Number(req.params.id), input);
      if (!service) return res.status(404).json({ message: "Serviço não encontrado" });
      await recordAuditLog(req, {
        action: "service.updated",
        entityType: "service",
        entityId: service.id,
        summary: `Serviço atualizado: ${service.name}`,
        metadata: { fields: Object.keys(req.body || {}) },
      });
      res.json(service);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Erro ao atualizar serviço" });
    }
  });

  app.delete("/api/services/:id", requireAdmin, async (req, res) => {
    try {
      const serviceId = Number(req.params.id);
      const service = await storage.getService(serviceId);
      await storage.deleteService(serviceId);
      await recordAuditLog(req, {
        action: "service.deleted",
        entityType: "service",
        entityId: serviceId,
        summary: `Serviço removido: ${service?.name || serviceId}`,
      });
      res.json({ message: "Serviço removido" });
    } catch (error) {
      res.status(500).json({ message: "Erro ao remover serviço" });
    }
  });

  // === ADMIN MGMT ===
  app.post("/api/admin/create", requireAdmin, async (req, res) => {
    try {
      const { username, password, email } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);
      const newAdmin = await storage.createAdmin({ username, password: hashedPassword, email });
      res.status(201).json({ id: newAdmin.id, username: newAdmin.username });
    } catch (error) {
      res.status(500).json({ message: "Erro ao criar administrador" });
    }
  });

  // === BARBERS ===
  app.get(api.barbers.list.path, async (req, res) => {
    const barbers = await getBarbersWithServiceIds();
    const appSession = getAppSession(req);
    const includeHidden = req.query.includeHidden === "true" &&
      Boolean(appSession.adminId || appSession.barberId);

    res.json(
      (includeHidden ? barbers : barbers.filter((barber) => barber.isVisible))
        .map((barber) => sanitizeBarberForResponse(barber, includeHidden)),
    );
  });

  app.get("/api/shop/availability", async (_req, res) => {
    const availability = await storage.getShopAvailability();
    res.json(availability.length > 0 ? availability : getDefaultShopAvailabilityRows());
  });

  app.patch("/api/shop/availability", requireAdmin, async (req, res) => {
    const inputSchema = z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      isOpen: z.boolean().optional(),
    }));

    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Disponibilidade inválida." });
    }

    const rows = parsed.data.map((row) => {
      const start = parseTimeToMinutes(row.startTime);
      const end = parseTimeToMinutes(row.endTime);
      if (start === null || end === null || end <= start) {
        return null;
      }

      return {
        ...row,
        isOpen: row.isOpen ?? true,
      };
    });

    if (rows.some((row) => row === null)) {
      return res.status(400).json({ message: "Horário inválido." });
    }

    const availability = await storage.replaceShopAvailability(rows.filter((row) => row !== null));
    await recordAuditLog(req, {
      action: "shop_availability.updated",
      entityType: "shop_availability",
      summary: "Horário base da barbearia atualizado",
      metadata: { rows: availability.length },
    });
    res.json(availability);
  });

  app.get("/api/barbers/availability", async (_req, res) => {
    const availability = await storage.getAllBarberAvailability();
    res.json(availability);
  });

  app.get("/api/barbers/:id/availability", async (req, res) => {
    const barber = await storage.getBarber(Number(req.params.id));
    if (!barber) {
      return res.status(404).json({ message: "Barbeiro não encontrado" });
    }

    const availability = await storage.getBarberAvailability(barber.id);
    res.json(availability);
  });

  app.patch("/api/barbers/:id/availability", requireAdmin, async (req, res) => {
    const inputSchema = z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      isWorking: z.boolean().optional(),
    }));

    const barberId = Number(req.params.id);
    const barber = await storage.getBarber(barberId);
    if (!barber) {
      return res.status(404).json({ message: "Barbeiro não encontrado" });
    }

    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Disponibilidade inválida." });
    }

    const rows = parsed.data.map((row) => {
      const start = parseTimeToMinutes(row.startTime);
      const end = parseTimeToMinutes(row.endTime);
      if (start === null || end === null || end <= start) {
        return null;
      }

      return {
        ...row,
        isWorking: row.isWorking ?? true,
      };
    });

    if (rows.some((row) => row === null)) {
      return res.status(400).json({ message: "Horário inválido." });
    }

    const availability = await storage.replaceBarberAvailability(barberId, rows.filter((row) => row !== null));
    await recordAuditLog(req, {
      action: "barber_availability.updated",
      entityType: "barber",
      entityId: barberId,
      summary: `Horário do barbeiro atualizado: ${barber.name}`,
      metadata: { rows: availability.length },
    });
    res.json(availability);
  });

  app.get(api.barbers.get.path, async (req, res) => {
    const barber = await storage.getBarber(Number(req.params.id));
    if (!barber) {
      return res.status(404).json({ message: "Barbeiro não encontrado" });
    }
    const appSession = getAppSession(req);
    const includePrivateFields = Boolean(appSession.adminId || appSession.barberId);
    if (!barber.isVisible && !includePrivateFields) {
      return res.status(404).json({ message: "Barbeiro não encontrado" });
    }

    const serviceIds = await storage.getBarberServiceIds(barber.id);
    res.json(sanitizeBarberForResponse({ ...barber, serviceIds }, includePrivateFields));
  });

  // === SERVICES ===
  app.get(api.services.list.path, async (req, res) => {
    const services = await storage.getServices();
    const appSession = getAppSession(req);
    const includeHidden = req.query.includeHidden === "true" &&
      Boolean(appSession.adminId || appSession.barberId);

    res.json(includeHidden ? services : services.filter((service) => service.isVisible));
  });

  // === APPOINTMENTS ===
  app.get(api.appointments.list.path, requireAuth, async (req, res) => {
    const appSession = getAppSession(req);
    const barberId = appSession.role === "barber"
      ? Number(appSession.barberId)
      : (req.query.barberId ? Number(req.query.barberId) : undefined);
    const date = req.query.date as string | undefined;
    // If barberId is 0 (Any), we fetch for all barbers to find combined busy slots
    const effectiveBarberId = barberId === 0 ? undefined : barberId;
    const appointments = await storage.getAppointments(effectiveBarberId, date);
    res.json(appointments);
  });

  app.post(api.appointments.create.path, async (req, res) => {
    try {
      // Coerce startTime to Date object if string
      const body = { ...req.body };
      if (typeof body.startTime === 'string') {
          body.startTime = new Date(body.startTime);
      }
      
      const input = api.appointments.create.input.parse(body);
      const normalizedCustomerEmail = normalizeEmail(input.customerEmail);

      if (isBeforeNow(input.startTime)) {
        return res.status(400).json({ message: "Escolha uma data e hora futuras." });
      }

      if (!isValidOptionalEmail(input.customerEmail)) {
        return res.status(400).json({ message: emailValidationMessage, field: "customerEmail" });
      }
      const services = await storage.getServices();
      const requestedService = services.find((service) => service.id === input.serviceId && service.isVisible);
      if (!requestedService) {
        return res.status(400).json({ message: "Serviço indisponível para marcação online." });
      }
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const requestedDuration = getAppointmentDurationMinutes(input.serviceId, serviceDurations);
      const requestedEndTime = new Date(input.startTime.getTime() + requestedDuration * 60000);
      const dateStr = getShopDateParts(input.startTime).dateKey;
      const normalizedCustomerPhone = normalizeCustomerPhoneForStorage(input.customerPhone);
      const barberServiceMap = buildBarberServiceMap(await storage.getAllBarberServices());
      // Check for blacklist
      const isBlacklisted = await storage.isBlacklisted(normalizedCustomerEmail || undefined, normalizedCustomerPhone);
      if (isBlacklisted) {
        return res.status(403).json({ message: "Não é possível realizar a marcação online. Contacte a barbearia." });
      }



      const cancelToken = randomUUID();
      
      // Handle "Any Barber" selection
      let finalBarberId = input.barberId;
      if (finalBarberId === 0) {
        const barbers = await storage.getBarbers();
        const existingAppointments = await storage.getAppointments(undefined, dateStr);
        
        const visibleBarbers = barbers.filter((barber) =>
          barber.isVisible && barberCanPerformService(barberServiceMap, barber.id, input.serviceId),
        );
        const appointmentCountsByBarber = new Map<number, number>();
        existingAppointments
          .filter((appointment) => appointment.status === "booked" && isOperationalAppointment(appointment))
          .forEach((appointment) => {
            appointmentCountsByBarber.set(
              appointment.barberId,
              (appointmentCountsByBarber.get(appointment.barberId) || 0) + 1,
            );
          });
        const availableBarbers: typeof visibleBarbers = [];

        for (const barber of visibleBarbers) {
          const workingPeriods = await getBarberWorkingPeriods(barber.id, getShopDateParts(input.startTime).weekday);
          const scheduleError = getScheduleValidationError(input.startTime, requestedDuration, workingPeriods);
          if (scheduleError) continue;

          const hasConflict = hasAppointmentConflict(
            existingAppointments,
            barber.id,
            input.startTime,
            requestedEndTime,
            serviceDurations,
          );
          if (!hasConflict) {
            availableBarbers.push(barber);
          }
        }

        if (availableBarbers.length === 0) {
          return res.status(409).json({ message: "Nenhum barbeiro disponível para este horário." });
        }
        const availableBarber = availableBarbers.sort((a, b) => {
          const countDifference =
            (appointmentCountsByBarber.get(a.id) || 0) - (appointmentCountsByBarber.get(b.id) || 0);
          return countDifference || a.id - b.id;
        })[0];
        finalBarberId = availableBarber.id;
      } else {
        const selectedBarber = await storage.getBarber(finalBarberId);
        if (!selectedBarber?.isVisible) {
          return res.status(400).json({ message: "Barbeiro indisponível para marcação online." });
        }
        if (!barberCanPerformService(barberServiceMap, finalBarberId, input.serviceId)) {
          return res.status(400).json({ message: "Este barbeiro não executa o serviço escolhido." });
        }

        const workingPeriods = await getBarberWorkingPeriods(finalBarberId, getShopDateParts(input.startTime).weekday);
        const scheduleError = getScheduleValidationError(input.startTime, requestedDuration, workingPeriods);
        if (scheduleError) {
          return res.status(400).json({ message: scheduleError });
        }

        const existingAppointments = await storage.getAppointments(finalBarberId, dateStr);
        if (
          hasAppointmentConflict(
            existingAppointments,
            finalBarberId,
            input.startTime,
            requestedEndTime,
            serviceDurations,
          )
        ) {
          return res.status(409).json({ message: "Este horário já está reservado." });
        }
      }

      const appointment = await storage.createAppointment({
        ...input,
        barberId: finalBarberId,
        customerPhone: normalizedCustomerPhone,
        customerEmail: normalizedCustomerEmail || null,
        cancelToken,
        durationMinutes: requestedDuration,
        depositRequired: false,
        depositReason: null,
      });
      await recordAuditLog(req, {
        actorType: "client",
        actorId: null,
        actorName: input.customerName,
        action: "appointment.created_online",
        entityType: "appointment",
        entityId: appointment.id,
        summary: `Marcação online criada: ${input.customerName}`,
        metadata: {
          barberId: finalBarberId,
          serviceId: input.serviceId,
          startTime: appointment.startTime,
        },
      });

      const service = services.find(s => s.id === input.serviceId);

      runNotificationJob("Booking confirmation", async () => {
        const barber = await storage.getBarber(finalBarberId);

        return sendBookingCreatedNotification({
          customerName: input.customerName,
          customerEmail: normalizedCustomerEmail || null,
          customerPhone: normalizedCustomerPhone,
          barberName: barber?.name,
          serviceName: service?.name || "Serviço indisponível",
          startTime: input.startTime,
          cancelToken,
          durationMinutes: appointment.durationMinutes,
          depositRequired: appointment.depositRequired,
          depositReason: appointment.depositReason,
        });
      });

      res.status(201).json(appointment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      if (isAppointmentConflictError(err)) {
        return res.status(409).json({ message: "Este horário já está reservado." });
      }
      throw err;
    }
  });

  app.post("/api/appointments/block", requireAdmin, async (req, res) => {
    try {
      const { barberId, startTime, name, phone, serviceId, isManualBooking, allowOutsideHours, isRecurring, recurringWeeks, recurringMonths } = req.body;
      if (
        (isManualBooking !== undefined && typeof isManualBooking !== "boolean") ||
        (allowOutsideHours !== undefined && typeof allowOutsideHours !== "boolean") ||
        (isRecurring !== undefined && typeof isRecurring !== "boolean")
      ) {
        return res.status(400).json({ message: "Pedido de marcação inválido." });
      }

      const barberIdNumber = Number(barberId);
      if (!Number.isInteger(barberIdNumber) || barberIdNumber <= 0 || !await storage.getBarber(barberIdNumber)) {
        return res.status(400).json({ message: "Barbeiro inválido." });
      }

      const start = new Date(startTime);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ message: "Data ou hora inválida." });
      }

      const serviceIdNumber = serviceId === null || serviceId === undefined || serviceId === ""
        ? null
        : Number(serviceId);
      if (serviceIdNumber !== null && (!Number.isInteger(serviceIdNumber) || serviceIdNumber <= 0)) {
        return res.status(400).json({ message: "Serviço inválido." });
      }
      if (isManualBooking && serviceIdNumber === null) {
        return res.status(400).json({ message: "Selecione um serviço para a marcação manual." });
      }

      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (isManualBooking && !normalizedName) {
        return res.status(400).json({ message: "Indique o nome do cliente." });
      }
      if (isManualBooking && !normalizeSupportedPhone(phone)) {
        return res.status(400).json({ message: supportedPhoneValidationMessage });
      }
      if (isRecurring && !isManualBooking) {
        return res.status(400).json({ message: "A repetição só está disponível para marcações manuais." });
      }
      if (allowOutsideHours && !isManualBooking) {
        return res.status(400).json({ message: "A exceção de horário só está disponível para marcações manuais." });
      }

      const normalizedCustomerPhone = normalizeCustomerPhoneForStorage(phone);
      const appointments: Array<Parameters<typeof storage.createAppointment>[0]> = [];
      const conflicts = [];
      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      if (serviceIdNumber !== null && !services.some((service) => service.id === serviceIdNumber)) {
        return res.status(400).json({ message: "Serviço não encontrado." });
      }
      const duration = serviceIdNumber
        ? getAppointmentDurationMinutes(serviceIdNumber, serviceDurations)
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;
      if (isManualBooking && serviceIdNumber) {
        const barberServiceMap = buildBarberServiceMap(await storage.getAllBarberServices());
        if (!barberCanPerformService(barberServiceMap, barberIdNumber, serviceIdNumber)) {
          return res.status(400).json({ message: "Este barbeiro não executa o serviço escolhido." });
        }
      }
      // Determine how many occurrences
      const recurringWeeksNumber = Number(recurringWeeks);
      const recurringMonthsNumber = Number(recurringMonths);
      if (
        isRecurring &&
        (!Number.isFinite(recurringWeeksNumber) ||
          !Number.isInteger(recurringWeeksNumber) ||
          recurringWeeksNumber <= 0 ||
          recurringWeeksNumber > 52 ||
          !Number.isFinite(recurringMonthsNumber) ||
          !Number.isInteger(recurringMonthsNumber) ||
          recurringMonthsNumber <= 0 ||
          recurringMonthsNumber > 24)
      ) {
        return res.status(400).json({ message: "Repetição inválida." });
      }
      if (isRecurring && isBeforeShopToday(start)) {
        return res.status(400).json({ message: "A recorrência deve começar hoje ou numa data futura." });
      }
      if (isRecurring && isBeforeNow(start)) {
        return res.status(400).json({ message: "A recorrência deve começar numa data e hora futuras." });
      }
      if (!isRecurring && isManualBooking && isBeforeNow(start)) {
        return res.status(400).json({ message: "Escolha uma data e hora futuras." });
      }

      const occurrences = (isRecurring && recurringWeeks && recurringMonths)
        ? Math.max(1, Math.floor((recurringMonthsNumber * 4.33) / recurringWeeksNumber))
        : 1;

      for (let i = 0; i < occurrences; i++) {
        const currentStart = isRecurring
          ? addWeeksPreservingShopTime(start, i * recurringWeeksNumber)
          : new Date(start);
        const currentEnd = new Date(currentStart.getTime() + duration * 60000);
        const workingPeriods = await getBarberWorkingPeriods(barberIdNumber, getShopDateParts(currentStart).weekday);
        const canBypassSchedule = Boolean(isManualBooking && allowOutsideHours);
        const scheduleError = canBypassSchedule
          ? null
          : getScheduleValidationError(currentStart, duration, workingPeriods);
        if (scheduleError) {
          return res.status(400).json({
            message: `${scheduleError} (${formatShopDateTime(currentStart)}, ${duration} min).`,
          });
        }

        const existingAppointments = await storage.getAppointments(
          barberIdNumber,
          getShopDateParts(currentStart).dateKey,
        );

        if (
          hasAppointmentConflict(
            existingAppointments,
            barberIdNumber,
            currentStart,
            currentEnd,
            serviceDurations,
          )
        ) {
          conflicts.push(formatShopDateTime(currentStart));
          continue;
        }

        appointments.push({
          barberId: barberIdNumber,
          serviceId: serviceIdNumber,
          startTime: currentStart,
          customerName: isManualBooking ? normalizedName : (occurrences > 1 ? `RECORRENTE: ${normalizedName}` : (normalizedName || "BLOQUEIO MANUAL")),
          customerPhone: isManualBooking ? normalizedCustomerPhone : "",
          customerEmail: "",
          durationMinutes: duration,
          status: "booked",
          cancelToken: randomUUID(),
          depositRequired: false,
          depositReason: null,
        });
      }

      if (conflicts.length > 0 && occurrences > 1) {
        return res.status(400).json({ 
          message: "Conflitos detetados em algumas datas", 
          conflicts 
        });
      } else if (conflicts.length > 0) {
        return res.status(400).json({ message: "Horário indisponível para este barbeiro." });
      }

      const createdAppointments: Appointment[] = [];
      for (const app of appointments) {
        createdAppointments.push(await storage.createAppointment(app));
      }

      await recordAuditLog(req, {
        action: isManualBooking ? "appointment.created_manual" : "appointment.absence_created",
        entityType: "appointment",
        entityId: createdAppointments[0]?.id ?? null,
        summary: isManualBooking
          ? `${createdAppointments.length} marcação manual criada`
          : `${createdAppointments.length} ausência criada`,
        metadata: {
          count: createdAppointments.length,
          barberId: barberIdNumber,
          serviceId: serviceIdNumber,
          recurring: Boolean(isRecurring),
        },
      });

      res.status(201).json({ message: `${appointments.length} marcações criadas.` });
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        return res.status(409).json({ message: "Horário indisponível para este barbeiro." });
      }
      console.error("Block error:", error);
      res.status(500).json({ message: "Erro ao bloquear horário" });
    }
  });

  app.get("/api/appointments/public", async (req, res) => {
    const barberId = req.query.barberId ? Number(req.query.barberId) : undefined;
    const date = req.query.date as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const effectiveBarberId = barberId === 0 ? undefined : barberId;
    const appointments = date
      ? await storage.getAppointments(effectiveBarberId, date)
      : await storage.getAppointmentsRange(effectiveBarberId, startDate, endDate);
    const visibleBarberIds = new Set(
      (await storage.getBarbers())
        .filter((barber) => barber.isVisible)
        .map((barber) => barber.id),
    );
    const serviceDurations = new Map(
      (await storage.getServices()).map((service) => [service.id, service.duration]),
    );
    const publicAppointments = appointments
      .filter((app) => app.status === "booked" && visibleBarberIds.has(app.barberId))
      .map((app) => ({
        id: app.id,
        startTime: app.startTime,
        barberId: app.barberId,
        serviceId: app.serviceId,
        duration: getEffectiveAppointmentDurationMinutes(app, serviceDurations),
      }));
    res.json(publicAppointments);
  });
  
  app.patch("/api/appointments/:id", requireAdmin, async (req, res) => {
    try {
      const { startTime, barberId, status } = req.body;
      const hasServicePatch = Object.prototype.hasOwnProperty.call(req.body, "serviceId");
      const appointmentId = Number(req.params.id);
      const currentApp = await storage.getAppointment(appointmentId);

      if (!currentApp) return res.status(404).json({ message: "Marcação não encontrada" });

      const newStartTime = startTime ? new Date(startTime) : new Date(currentApp.startTime);
      const newBarberId = barberId ? Number(barberId) : currentApp.barberId;
      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const newServiceId = hasServicePatch
        ? req.body.serviceId === null || req.body.serviceId === "" ? null : Number(req.body.serviceId)
        : currentApp.serviceId;

      if (Number.isNaN(newStartTime.getTime())) {
        return res.status(400).json({ message: "Data ou hora inválida." });
      }

      if (startTime && isBeforeNow(newStartTime)) {
        return res.status(400).json({ message: "Escolha uma data e hora futuras." });
      }

      if (!Number.isFinite(newBarberId) || newBarberId <= 0) {
        return res.status(400).json({ message: "Barbeiro inválido." });
      }

      if (hasServicePatch && newServiceId !== null && (!Number.isFinite(newServiceId) || newServiceId <= 0)) {
        return res.status(400).json({ message: "Serviço inválido." });
      }

      if (newServiceId !== null && !services.some((service) => service.id === newServiceId)) {
        return res.status(400).json({ message: "Serviço não encontrado." });
      }

      // Conflict check for re-scheduling or service changes
      if (startTime || barberId || hasServicePatch) {
        const duration = hasServicePatch
          ? getAppointmentDurationMinutes(newServiceId, serviceDurations)
          : getEffectiveAppointmentDurationMinutes(currentApp, serviceDurations);
        if (newServiceId) {
          const barberServiceMap = buildBarberServiceMap(await storage.getAllBarberServices());
          if (!barberCanPerformService(barberServiceMap, newBarberId, newServiceId)) {
            return res.status(400).json({ message: "Este barbeiro não executa o serviço desta marcação." });
          }
        }

        const workingPeriods = await getBarberWorkingPeriods(newBarberId, getShopDateParts(newStartTime).weekday);
        const scheduleError = getScheduleValidationError(newStartTime, duration, workingPeriods);
        if (scheduleError) {
          return res.status(400).json({ message: scheduleError });
        }

        const dateStr = getShopDateParts(newStartTime).dateKey;
        const existingAppointments = await storage.getAppointments(newBarberId, dateStr);
        const newEndTime = new Date(newStartTime.getTime() + duration * 60000);

        if (
          hasAppointmentConflict(
            existingAppointments,
            newBarberId,
            newStartTime,
            newEndTime,
            serviceDurations,
            appointmentId,
          )
        ) {
          return res.status(409).json({ message: "Este barbeiro já tem uma marcação para este horário." });
        }
      }

      const updateData: any = {};
      if (startTime) updateData.startTime = newStartTime;
      if (barberId) updateData.barberId = newBarberId;
      if (hasServicePatch) {
        updateData.serviceId = newServiceId;
        updateData.durationMinutes = getAppointmentDurationMinutes(newServiceId, serviceDurations);
      }
      if (status) {
        if (!isKnownAppointmentStatus(status)) {
          return res.status(400).json({ message: "Estado de marcação inválido." });
        }
        Object.assign(updateData, getStatusPatch(status));
      }

      const updated = await storage.updateAppointment(appointmentId, updateData);
      if (updated) {
        await recordAuditLog(req, {
          action: status ? "appointment.status_changed" : "appointment.updated",
          entityType: "appointment",
          entityId: appointmentId,
          summary: status
            ? `Estado da marcação alterado: ${currentApp.customerName}`
            : `Marcação atualizada: ${currentApp.customerName}`,
          metadata: {
            fields: Object.keys(updateData),
            previousStartTime: currentApp.startTime,
            newStartTime: updated.startTime,
            previousBarberId: currentApp.barberId,
            newBarberId: updated.barberId,
            previousServiceId: currentApp.serviceId,
            newServiceId: updated.serviceId,
            previousStatus: currentApp.status,
            newStatus: updated.status,
          },
        });
      }

      res.json(updated);
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        return res.status(409).json({ message: "Este barbeiro já tem uma marcação para este horário." });
      }
      console.error("Update appointment error:", error);
      res.status(500).json({ message: "Erro ao atualizar marcação" });
    }
  });

  app.patch(api.appointments.updateStatus.path, requireAuth, async (req, res) => {
    try {
      const status = req.body.status;
      if (!isKnownAppointmentStatus(status)) {
        return res.status(400).json({ message: "Estado de marcação inválido." });
      }

      const appointmentId = Number(req.params.id);
      const currentApp = await storage.getAppointment(appointmentId);
      if (!currentApp) return res.status(404).json({ message: "Marcação não encontrada" });

      const appSession = getAppSession(req);
      if (appSession.role === "barber" && currentApp.barberId !== Number(appSession.barberId)) {
        return res.status(403).json({ message: "Não autorizado" });
      }

      const updated = await storage.updateAppointmentStatus(appointmentId, status);
      if (!updated) return res.status(404).json({ message: "Marcação não encontrada" });
      await recordAuditLog(req, {
        action: "appointment.status_changed",
        entityType: "appointment",
        entityId: appointmentId,
        summary: `Estado da marcação alterado: ${currentApp.customerName}`,
        metadata: { previousStatus: currentApp.status, newStatus: status },
      });
      res.json(updated);
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        return res.status(409).json({ message: "Este horário já está reservado." });
      }
      throw error;
    }
  });

  app.get("/api/appointments/token/:token", async (req, res) => {
    const appointment = await storage.getAppointmentByToken(req.params.token);
    if (!appointment) {
      return res.status(404).json({ message: "Marcação não encontrada" });
    }

    const [barber, service] = await Promise.all([
      storage.getBarber(appointment.barberId),
      appointment.serviceId ? storage.getService(appointment.serviceId) : Promise.resolve(undefined),
    ]);

    res.json({
      id: appointment.id,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId,
      startTime: appointment.startTime,
      status: appointment.status,
      customerName: appointment.customerName,
      depositRequired: appointment.depositRequired,
      depositReason: appointment.depositReason,
      cancellationPolicyHours: CANCELLATION_POLICY_HOURS,
      isLateCancellation: isLateCancellation(appointment.startTime),
      barberName: barber?.name || "Desconhecido",
      serviceName: service?.name || "Serviço indisponível",
      duration: getEffectiveAppointmentDurationMinutes(
        appointment,
        new Map(service ? [[service.id, service.duration]] : []),
      ),
      price: service?.price || 0,
    });
  });

  app.post("/api/appointments/reschedule/:token", async (req, res) => {
    try {
      const appointment = await storage.getAppointmentByToken(req.params.token);
      if (!appointment) {
        return res.status(404).json({ message: "Marcação não encontrada" });
      }

      if (appointment.status !== "booked") {
        return res.status(409).json({ message: "Esta marcação já não pode ser reagendada." });
      }

      const startTime = new Date(req.body?.startTime);
      if (Number.isNaN(startTime.getTime())) {
        return res.status(400).json({ message: "Data ou hora inválida." });
      }

      if (isBeforeNow(startTime)) {
        return res.status(400).json({ message: "Escolha uma data e hora futuras." });
      }

      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const duration = getEffectiveAppointmentDurationMinutes(appointment, serviceDurations);
      if (appointment.serviceId) {
        const barberServiceMap = buildBarberServiceMap(await storage.getAllBarberServices());
        if (!barberCanPerformService(barberServiceMap, appointment.barberId, appointment.serviceId)) {
          return res.status(400).json({ message: "Este barbeiro já não executa o serviço desta marcação." });
        }
      }

      const workingPeriods = await getBarberWorkingPeriods(appointment.barberId, getShopDateParts(startTime).weekday);
      const scheduleError = getScheduleValidationError(startTime, duration, workingPeriods);
      if (scheduleError) {
        return res.status(400).json({ message: scheduleError });
      }

      const dateStr = getShopDateParts(startTime).dateKey;
      const existingAppointments = await storage.getAppointments(appointment.barberId, dateStr);
      const endTime = new Date(startTime.getTime() + duration * 60000);
      if (
        hasAppointmentConflict(
          existingAppointments,
          appointment.barberId,
          startTime,
          endTime,
          serviceDurations,
          appointment.id,
        )
      ) {
        return res.status(409).json({ message: "Este horário já está reservado." });
      }

      const updated = await storage.updateAppointment(appointment.id, { startTime }, "booked");
      if (!updated) {
        return res.status(409).json({ message: "Esta marcação já não pode ser reagendada." });
      }

      res.json(updated);
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        return res.status(409).json({ message: "Este horário já está reservado." });
      }
      throw error;
    }
  });

  app.post('/api/appointments/cancel/:token', async (req, res) => {
    const appointment = await storage.getAppointmentByToken(req.params.token);
    if (!appointment) {
      return res.status(404).json({ message: "Marcação não encontrada" });
    }
    
    if (appointment.status === "cancelled" || appointment.status === "late_cancelled") {
      return res.json({
        message: "Esta marcação já estava cancelada.",
        status: appointment.status,
        alreadyCancelled: true,
        notificationChannel: "none" satisfies NotificationChannel,
        notificationSent: false,
      });
    }

    if (appointment.status !== 'booked') {
      return res.status(409).json({ message: "Esta marcação já não pode ser cancelada." });
    }

    const lateCancellation = isLateCancellation(appointment.startTime);
    const status = lateCancellation ? "late_cancelled" : "cancelled";
    const cancelledAppointment = await storage.updateAppointmentStatusIfCurrent(appointment.id, "booked", status);
    if (!cancelledAppointment) {
      const latestAppointment = await storage.getAppointment(appointment.id);
      if (latestAppointment?.status === "cancelled" || latestAppointment?.status === "late_cancelled") {
        return res.json({
          message: "Esta marcação já estava cancelada.",
          status: latestAppointment.status,
          alreadyCancelled: true,
          notificationChannel: "none" satisfies NotificationChannel,
          notificationSent: false,
        });
      }
      return res.status(409).json({ message: "Esta marcação já não pode ser cancelada." });
    }

    runNotificationJob("Booking cancellation", async () => {
      const [barber, service] = await Promise.all([
        storage.getBarber(appointment.barberId),
        appointment.serviceId ? storage.getService(appointment.serviceId) : Promise.resolve(undefined),
      ]);

      return sendBookingCancelledNotification({
        customerName: appointment.customerName,
        customerEmail: appointment.customerEmail,
        customerPhone: appointment.customerPhone,
        barberName: barber?.name,
        serviceName: service?.name || "Serviço indisponível",
        startTime: toDate(appointment.startTime),
        lateCancellation,
      });
    });

    res.json({
      message: lateCancellation
        ? `Cancelamento registado como tardio por estar a menos de ${CANCELLATION_POLICY_HOURS} horas da marcação.`
        : "Marcação cancelada com sucesso.",
      status,
      lateCancellation,
      policyHours: CANCELLATION_POLICY_HOURS,
    });
  });

  app.get("/api/admin/dashboard", requireAuth, async (req, res) => {
    const appSession = getAppSession(req);
    const requestedDays = Number(req.query.days || 30);
    const rangeDays = Number.isFinite(requestedDays)
      ? Math.min(Math.max(Math.round(requestedDays), 7), 180)
      : 30;

    const end = req.query.endDate
      ? endOfDay(parseISO(String(req.query.endDate)))
      : endOfDay(new Date());
    const start = req.query.startDate
      ? startOfDay(parseISO(String(req.query.startDate)))
      : startOfDay(addCalendarDays(end, -(rangeDays - 1)));

    if (!isValid(start) || !isValid(end) || start > end) {
      return res.status(400).json({ message: "Intervalo de datas inválido." });
    }

    const requestedBarberId = req.query.barberId && req.query.barberId !== "all"
      ? Number(req.query.barberId)
      : undefined;
    const barberId = appSession.role === "barber"
      ? Number(appSession.barberId)
      : requestedBarberId;

    const [allAppointments, allBarbers, allServices] = await Promise.all([
      storage.getAppointments(barberId),
      storage.getBarbers(),
      storage.getServices(),
    ]);

    const visibleBarbers = appSession.role === "barber"
      ? allBarbers.filter((barber) => barber.id === barberId)
      : allBarbers;
    const servicePrices = new Map(allServices.map((service) => [service.id, service.price]));
    const servicesById = new Map(allServices.map((service) => [service.id, service]));
    const barbersById = new Map(visibleBarbers.map((barber) => [barber.id, barber]));
    const now = new Date();

    const businessAppointments = allAppointments.filter(isOperationalAppointment);
    const rangeAppointments = businessAppointments.filter((appointment) => {
      const date = new Date(appointment.startTime);
      return date >= start && date <= end;
    });

    const completedAppointments = rangeAppointments.filter((appointment) => appointment.status === "completed");
    const bookedAppointments = rangeAppointments.filter((appointment) => appointment.status === "booked");
    const cancelledAppointments = rangeAppointments.filter((appointment) => appointment.status === "cancelled");
    const lateCancelledAppointments = rangeAppointments.filter((appointment) => appointment.status === "late_cancelled");
    const noShowAppointments = rangeAppointments.filter((appointment) => appointment.status === "no_show");

    const revenueCents = completedAppointments.reduce(
      (total, appointment) => total + getServicePriceCents(appointment.serviceId, servicePrices),
      0,
    );
    const projectedRevenueCents = bookedAppointments.reduce(
      (total, appointment) => total + getServicePriceCents(appointment.serviceId, servicePrices),
      0,
    );
    const riskCount = noShowAppointments.length + lateCancelledAppointments.length;
    const completedOrMissed = completedAppointments.length + noShowAppointments.length + lateCancelledAppointments.length;

    const dailyMap = new Map(
      createDashboardDays(start, end).map((day) => [
        day.key,
        {
          date: day.key,
          label: day.label,
          appointments: 0,
          completed: 0,
          booked: 0,
          cancelled: 0,
          noShows: 0,
          revenueCents: 0,
        },
      ]),
    );

    const barberMap = new Map(
      visibleBarbers.map((barber) => [
        barber.id,
        {
          id: barber.id,
          name: barber.name,
          appointments: 0,
          completed: 0,
          booked: 0,
          noShows: 0,
          revenueCents: 0,
        },
      ]),
    );
    const serviceMap = new Map<number, {
      id: number;
      name: string;
      count: number;
      revenueCents: number;
    }>();
    const hourMap = new Map<string, number>();

    rangeAppointments.forEach((appointment) => {
      const date = new Date(appointment.startTime);
      const day = dailyMap.get(format(date, "yyyy-MM-dd"));
      const price = getServicePriceCents(appointment.serviceId, servicePrices);

      if (day) {
        day.appointments += 1;
        if (appointment.status === "completed") {
          day.completed += 1;
          day.revenueCents += price;
        }
        if (appointment.status === "booked") day.booked += 1;
        if (appointment.status === "cancelled" || appointment.status === "late_cancelled") day.cancelled += 1;
        if (appointment.status === "no_show") day.noShows += 1;
      }

      const barber = barberMap.get(appointment.barberId);
      if (barber) {
        barber.appointments += 1;
        if (appointment.status === "completed") {
          barber.completed += 1;
          barber.revenueCents += price;
        }
        if (appointment.status === "booked") barber.booked += 1;
        if (appointment.status === "no_show" || appointment.status === "late_cancelled") barber.noShows += 1;
      }

      if (appointment.serviceId) {
        const service = servicesById.get(appointment.serviceId);
        const serviceSummary = serviceMap.get(appointment.serviceId) || {
          id: appointment.serviceId,
          name: service?.name || "Serviço indisponível",
          count: 0,
          revenueCents: 0,
        };
        serviceSummary.count += 1;
        if (appointment.status === "completed") serviceSummary.revenueCents += price;
        serviceMap.set(appointment.serviceId, serviceSummary);
      }

      if (appointment.status === "completed" || appointment.status === "booked") {
        const hour = format(date, "HH:00");
        hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
      }
    });

    const inactiveCutoff = addCalendarDays(now, -45);
    const futureBookedIdentities = new Set(
      businessAppointments
        .filter((appointment) => appointment.status === "booked" && new Date(appointment.startTime) >= now)
        .map(getCustomerIdentity)
        .filter(Boolean),
    );
    const inactiveCustomerMap = new Map<string, {
      name: string;
      phone: string;
      email: string;
      lastVisit: Date;
      totalVisits: number;
    }>();

    businessAppointments
      .filter((appointment) => appointment.status === "completed")
      .forEach((appointment) => {
        const identity = getCustomerIdentity(appointment);
        if (!identity || futureBookedIdentities.has(identity)) return;
        const lastVisit = new Date(appointment.startTime);
        const current = inactiveCustomerMap.get(identity);
        inactiveCustomerMap.set(identity, {
          name: appointment.customerName,
          phone: appointment.customerPhone,
          email: appointment.customerEmail || "",
          lastVisit: current && current.lastVisit > lastVisit ? current.lastVisit : lastVisit,
          totalVisits: (current?.totalVisits || 0) + 1,
        });
      });

    const inactiveCustomers = Array.from(inactiveCustomerMap.values())
      .filter((customer) => customer.lastVisit < inactiveCutoff)
      .sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime())
      .slice(0, 6)
      .map((customer) => ({
        ...customer,
        lastVisit: customer.lastVisit,
        daysSinceLastVisit: Math.floor((now.getTime() - customer.lastVisit.getTime()) / 86400000),
      }));

    const busiestHour = Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1])[0] || null;

    res.json({
      range: {
        startDate: start,
        endDate: end,
        days: rangeDays,
        barberId: barberId || "all",
      },
      summary: {
        appointments: rangeAppointments.length,
        completed: completedAppointments.length,
        booked: bookedAppointments.length,
        cancellations: cancelledAppointments.length + lateCancelledAppointments.length,
        noShows: noShowAppointments.length,
        revenueCents,
        projectedRevenueCents,
        averageTicketCents: completedAppointments.length ? Math.round(revenueCents / completedAppointments.length) : 0,
        completionRate: rangeAppointments.length ? Math.round((completedAppointments.length / rangeAppointments.length) * 100) : 0,
        noShowRate: completedOrMissed ? Math.round((riskCount / completedOrMissed) * 100) : 0,
        upcomingWeek: businessAppointments.filter((appointment) => {
          const date = new Date(appointment.startTime);
          return appointment.status === "booked" && date >= now && date <= addCalendarDays(now, 7);
        }).length,
        inactiveCustomers: inactiveCustomers.length,
        busiestHour: busiestHour ? busiestHour[0] : null,
      },
      daily: Array.from(dailyMap.values()),
      barbers: Array.from(barberMap.values()).sort((a, b) => b.revenueCents - a.revenueCents),
      services: Array.from(serviceMap.values()).sort((a, b) => b.count - a.count).slice(0, 6),
      inactiveCustomers,
    });
  });

  // === BLACKLIST ===
  app.get("/api/admin/blacklist", requireAdmin, async (req, res) => {
    const list = await storage.getBlacklist();
    res.json(list);
  });

  app.post("/api/admin/blacklist", requireAdmin, async (req, res) => {
    try {
      const input = blacklistInputSchema.parse(req.body);
      await withBlacklistMutationLock(async () => {
        const existingEntry = (await storage.getBlacklist()).find((entry) =>
          supportedPhonesMatch(entry.phone, input.phone) ||
          Boolean(input.email && normalizeEmail(entry.email) === input.email),
        );
        if (existingEntry) {
          return res.status(200).json({
            ...existingEntry,
            alreadyBlacklisted: true,
            futureAppointments: [],
            cancelledAppointments: [],
          });
        }

        const futureAppointments = await getFutureBookedCustomerAppointments(input.phone, input.email || undefined);

        if (futureAppointments.length > 0 && input.cancelFutureAppointments === undefined) {
          return res.status(409).json({
            code: "CUSTOMER_HAS_FUTURE_APPOINTMENTS",
            message: "Este cliente tem marcações futuras.",
            futureAppointments: await getBlacklistAppointmentSummaries(futureAppointments),
          });
        }

        const entry = await storage.addToBlacklist({
          phone: input.phone,
          email: input.email || null,
          reason: input.reason || undefined,
        });
        const cancelledAppointments: Appointment[] = [];

        if (input.cancelFutureAppointments === true && futureAppointments.length > 0) {
          for (const appointment of futureAppointments) {
            const updated = await storage.updateAppointment(appointment.id, getStatusPatch("cancelled"));
            if (updated) cancelledAppointments.push(updated);
          }
        }

        await recordAuditLog(req, {
          action: "customer.blocked",
          entityType: "blacklist",
          entityId: entry.id,
          summary: cancelledAppointments.length > 0
            ? `Cliente bloqueado e ${cancelledAppointments.length} marcação(ões) futura(s) cancelada(s): ${entry.phone}`
            : `Cliente bloqueado: ${entry.phone}`,
          metadata: {
            email: entry.email,
            reason: entry.reason,
            futureAppointmentIds: futureAppointments.map((appointment) => appointment.id),
            cancelledAppointmentIds: cancelledAppointments.map((appointment) => appointment.id),
          },
        });
        return res.status(201).json({
          ...entry,
          alreadyBlacklisted: false,
          futureAppointments: await getBlacklistAppointmentSummaries(futureAppointments),
          cancelledAppointments: await getBlacklistAppointmentSummaries(cancelledAppointments),
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Erro ao adicionar à lista de bloqueio" });
    }
  });

  const removeBlacklistEntry = async (req: Request, res: Response) => {
    const entryId = Number(req.params.id);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return res.status(400).json({ message: "Entrada da lista de bloqueio inválida." });
    }
    const entry = (await storage.getBlacklist()).find((item) => item.id === entryId);
    if (!entry) {
      return res.status(404).json({ message: "Cliente não encontrado na lista de bloqueio." });
    }
    await storage.removeFromBlacklist(entryId);
    await recordAuditLog(req, {
      action: "customer.unblocked",
      entityType: "blacklist",
      entityId: entryId,
      summary: `Cliente desbloqueado: ${entry?.phone || entryId}`,
      metadata: { email: entry?.email || null },
    });
    res.json({ message: "Removido da lista de bloqueio" });
  };

  app.post("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);
  app.delete("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);

  const canManageCustomer = async (req: Request, phone: string, email?: string, customerNameKey?: string) => {
    const appSession = getAppSession(req);
    if (appSession.role === "admin") return true;
    if (appSession.role !== "barber" || !appSession.barberId) return false;

    const barberAppointments = await storage.getAppointments(Number(appSession.barberId));
    return barberAppointments.some((appointment) =>
      customerIdentityMatches(appointment, phone, email, customerNameKey),
    );
  };

  app.get("/api/admin/customers/:phone/history", requireAuth, async (req, res) => {
    const phone = normalizePhone(req.params.phone);
    const email = String(req.query.email || "").trim().toLowerCase();
    const requestedCustomerName = String(req.query.name || "").trim();
    const customerNameKey = normalizeCustomerName(requestedCustomerName);
    if (!phone && !email) {
      return res.status(400).json({ message: "Indique um telemóvel ou email." });
    }

    const appSession = getAppSession(req);
    const barberId = appSession.role === "barber" ? Number(appSession.barberId) : undefined;
    const [allAppointments, allBarbers, allServices] = await Promise.all([
      storage.getAppointments(barberId),
      storage.getBarbers(),
      storage.getServices(),
    ]);

    const matchingAppointments = allAppointments
      .filter((appointment) => customerIdentityMatches(appointment, phone, email, customerNameKey))
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    const appointmentsWithDetails = matchingAppointments.map((appointment) => {
      const barber = allBarbers.find((item) => item.id === appointment.barberId);
      const service = allServices.find((item) => item.id === appointment.serviceId);

      return {
        ...appointment,
        barberName: barber?.name || "Desconhecido",
        serviceName: service?.name || "Serviço indisponível",
        servicePrice: service?.price || 0,
      };
    });
    const metrics = getCustomerMetrics(matchingAppointments, req.params.phone, email);
    const customerNote = phone && (appSession.role === "admin" || matchingAppointments.length > 0)
      ? await storage.getCustomerNoteByIdentity(phone, customerNameKey) ??
        (customerNameKey ? await storage.getCustomerNoteByIdentity(phone, "") : undefined)
      : undefined;

    res.json({
      customer: {
        name: matchingAppointments[0]?.customerName || requestedCustomerName,
        phone: matchingAppointments[0]?.customerPhone || req.params.phone,
        email: matchingAppointments.find((appointment) => appointment.customerEmail)?.customerEmail || email,
      },
      notes: customerNote
        ? {
            notes: customerNote.notes,
            updatedAt: customerNote.updatedAt,
          }
        : {
            notes: "",
            updatedAt: null,
          },
      stats: {
        total: metrics.total,
        booked: metrics.booked,
        completed: metrics.completed,
        cancelled: metrics.cancelled,
        lateCancelled: metrics.lateCancelled,
        noShows: metrics.noShows,
        lastPresence: metrics.lastPresence,
        lastVisit: metrics.lastPresence,
        depositRecommended: false,
      },
      appointments: appointmentsWithDetails,
    });
  });

  app.patch("/api/admin/customers/:phone/notes", requireAuth, async (req, res) => {
    const phone = normalizePhone(req.params.phone);
    if (!phone) {
      return res.status(400).json({ message: "Indique um telemóvel válido." });
    }

    const parsed = customerNotesInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Notas inválidas." });
    }

    const email = (parsed.data.email || "").trim().toLowerCase();
    const customerNameKey = normalizeCustomerName(parsed.data.customerName);
    if (!(await canManageCustomer(req, phone, email, customerNameKey))) {
      return res.status(403).json({ message: "Não autorizado" });
    }

    const note = await storage.upsertCustomerNote({
      phone,
      customerNameKey,
      email: email || undefined,
      notes: parsed.data.notes.trim(),
    });
    await recordAuditLog(req, {
      action: "customer_note.updated",
      entityType: "customer_note",
      entityId: note.id,
      summary: `Notas do cliente atualizadas: ${parsed.data.customerName || phone}`,
      metadata: { phone, customerNameKey },
    });

    res.json(note);
  });

  // === EXPORT RELATÓRIOS ===
  app.get("/api/admin/export", requireAdmin, async (req, res) => {
    const { startDate, endDate, barberId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Datas de início e fim são obrigatórias" });
    }

    const start = startOfDay(parseISO(startDate as string));
    const end = endOfDay(parseISO(endDate as string));

    if (!isValid(start) || !isValid(end)) {
      return res.status(400).json({ message: "Datas inválidas" });
    }

    if (start > end) {
      return res.status(400).json({ message: "A data de início não pode ser posterior à data de fim" });
    }

    const selectedBarberId = barberId && barberId !== "all" ? Number(barberId) : undefined;
    if (selectedBarberId !== undefined && !Number.isInteger(selectedBarberId)) {
      return res.status(400).json({ message: "Barbeiro inválido" });
    }

    try {
      const [allBarbers, allServices, allAppointments] = await Promise.all([
        storage.getBarbers(),
        storage.getServices(),
        storage.getAppointments(selectedBarberId),
      ]);

      const barbersById = new Map(allBarbers.map((barber) => [barber.id, barber]));
      const servicesById = new Map(allServices.map((service) => [service.id, service]));
      const servicePrices = new Map(allServices.map((service) => [service.id, service.price]));
      const selectedBarber = selectedBarberId ? barbersById.get(selectedBarberId) : undefined;

      type ExportSummaryRow = {
        name: string;
        appointments: number;
        completed: number;
        booked: number;
        cancelled: number;
        lateCancelled: number;
        noShows: number;
        realizedCents: number;
        projectedCents: number;
      };

      type ExportDailyRow = ExportSummaryRow & {
        date: Date;
        key: string;
      };

      const createSummaryRow = (name: string): ExportSummaryRow => ({
        name,
        appointments: 0,
        completed: 0,
        booked: 0,
        cancelled: 0,
        lateCancelled: 0,
        noShows: 0,
        realizedCents: 0,
        projectedCents: 0,
      });

      const addAppointmentToSummary = (
        summary: ExportSummaryRow,
        appointment: Appointment,
        priceCents: number,
      ) => {
        summary.appointments += 1;
        if (appointment.status === "completed") {
          summary.completed += 1;
          summary.realizedCents += priceCents;
        }
        if (appointment.status === "booked") {
          summary.booked += 1;
          summary.projectedCents += priceCents;
        }
        if (appointment.status === "cancelled") summary.cancelled += 1;
        if (appointment.status === "late_cancelled") summary.lateCancelled += 1;
        if (appointment.status === "no_show") summary.noShows += 1;
      };

      const rangeAppointments = allAppointments
        .filter(isOperationalAppointment)
        .filter((appointment) => {
          const appointmentDate = new Date(appointment.startTime);
          return appointmentDate >= start && appointmentDate <= end;
        })
        .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());

      const totalSummary = createSummaryRow("Total geral");
      const barberSummaryMap = new Map<number, ExportSummaryRow>();
      const serviceSummaryMap = new Map<number | "unknown", ExportSummaryRow>();
      const dailySummaryMap = new Map<string, ExportDailyRow>();

      createDashboardDays(start, end).forEach((day) => {
        dailySummaryMap.set(day.key, {
          ...createSummaryRow(day.label),
          date: parseISO(day.key),
          key: day.key,
        });
      });

      rangeAppointments.forEach((appointment) => {
        const priceCents = getServicePriceCents(appointment.serviceId, servicePrices);
        const barber = barbersById.get(appointment.barberId);
        const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
        const serviceKey = appointment.serviceId ?? "unknown";
        const dateKey = format(new Date(appointment.startTime), "yyyy-MM-dd");
        const barberSummary = barberSummaryMap.get(appointment.barberId) || createSummaryRow(barber?.name || "Barbeiro desconhecido");
        const serviceSummary = serviceSummaryMap.get(serviceKey) || createSummaryRow(service?.name || "Serviço desconhecido");
        const dailySummary = dailySummaryMap.get(dateKey);

        addAppointmentToSummary(totalSummary, appointment, priceCents);
        addAppointmentToSummary(barberSummary, appointment, priceCents);
        addAppointmentToSummary(serviceSummary, appointment, priceCents);
        if (dailySummary) addAppointmentToSummary(dailySummary, appointment, priceCents);

        barberSummaryMap.set(appointment.barberId, barberSummary);
        serviceSummaryMap.set(serviceKey, serviceSummary);
      });

      const averageTicketEuros = totalSummary.completed
        ? centsToEuros(Math.round(totalSummary.realizedCents / totalSummary.completed))
        : 0;
      const completionRate = totalSummary.appointments
        ? totalSummary.completed / totalSummary.appointments
        : 0;
      const riskRate = totalSummary.appointments
        ? (totalSummary.noShows + totalSummary.lateCancelled) / totalSummary.appointments
        : 0;

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Baptista Barber Shop";
      workbook.created = new Date();
      workbook.modified = new Date();

      const currencyFormat = '€ #,##0.00;[Red]-€ #,##0.00';
      const percentFormat = "0.0%";
      const dateFormat = "dd/mm/yyyy";
      const dateTimeFormat = "dd/mm/yyyy hh:mm";
      const headerFill: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF111827" },
      };

      const styleHeaderRow = (sheet: ExcelJS.Worksheet, rowNumber = 1) => {
        const row = sheet.getRow(rowNumber);
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = headerFill;
        row.alignment = { vertical: "middle" };
        row.height = 22;
      };

      const finishTableSheet = (
        sheet: ExcelJS.Worksheet,
        widths: number[],
        numberFormats: Record<number, string> = {},
      ) => {
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        styleHeaderRow(sheet);
        widths.forEach((width, index) => {
          sheet.getColumn(index + 1).width = width;
        });
        Object.entries(numberFormats).forEach(([columnIndex, numberFormat]) => {
          sheet.getColumn(Number(columnIndex)).numFmt = numberFormat;
        });
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: "thin", color: { argb: "FFE5E7EB" } },
              left: { style: "thin", color: { argb: "FFE5E7EB" } },
              bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
              right: { style: "thin", color: { argb: "FFE5E7EB" } },
            };
            cell.alignment = { vertical: "middle" };
          });
        });
      };

      const addTable = (
        sheet: ExcelJS.Worksheet,
        name: string,
        headers: string[],
        rows: Array<Array<string | number | Date | null>>,
      ) => {
        sheet.addTable({
          name,
          ref: "A1",
          headerRow: true,
          totalsRow: false,
          style: {
            theme: "TableStyleMedium2",
            showRowStripes: true,
          },
          columns: headers.map((header) => ({ name: header, filterButton: true })),
          rows,
        });
      };

      const summarySheet = workbook.addWorksheet("Resumo Geral");
      summarySheet.mergeCells("A1:B1");
      summarySheet.getCell("A1").value = "Relatório de gestão";
      summarySheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      summarySheet.getCell("A1").fill = headerFill;
      summarySheet.getCell("A1").alignment = { vertical: "middle" };
      summarySheet.getRow(1).height = 28;
      summarySheet.addRows([
        ["Período", `${format(start, "dd/MM/yyyy")} a ${format(end, "dd/MM/yyyy")}`],
        ["Barbeiro", selectedBarber?.name || "Todos os barbeiros"],
        ["Marcações no período", totalSummary.appointments],
        ["Concluídas", totalSummary.completed],
        ["Marcadas", totalSummary.booked],
        ["Canceladas", totalSummary.cancelled],
        ["Cancelamentos tardios", totalSummary.lateCancelled],
        ["Faltas", totalSummary.noShows],
        ["Receita realizada", centsToEuros(totalSummary.realizedCents)],
        ["Receita prevista em agenda", centsToEuros(totalSummary.projectedCents)],
        ["Ticket médio realizado", averageTicketEuros],
        ["Taxa de conclusão", completionRate],
        ["Taxa de risco", riskRate],
        ["Nota", "Receita realizada considera apenas marcações concluídas. Marcações marcadas contam como previsão."],
      ]);
      summarySheet.getColumn(1).width = 28;
      summarySheet.getColumn(2).width = 58;
      [10, 11, 12].forEach((rowNumber) => {
        summarySheet.getCell(rowNumber, 2).numFmt = currencyFormat;
      });
      [13, 14].forEach((rowNumber) => {
        summarySheet.getCell(rowNumber, 2).numFmt = percentFormat;
      });
      summarySheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.getCell(1).font = { bold: true };
          row.eachCell((cell) => {
            cell.border = {
              top: { style: "thin", color: { argb: "FFE5E7EB" } },
              left: { style: "thin", color: { argb: "FFE5E7EB" } },
              bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
              right: { style: "thin", color: { argb: "FFE5E7EB" } },
            };
            cell.alignment = { vertical: "middle", wrapText: rowNumber === 15 };
          });
        }
      });

      const summaryHeaders = [
        "Nome",
        "Total marcações",
        "Concluídas",
        "Marcadas",
        "Canceladas",
        "Cancelamentos tardios",
        "Faltas",
        "Receita realizada (€)",
        "Receita prevista (€)",
        "Ticket médio (€)",
        "Taxa conclusão",
      ];
      const summaryToRow = (item: ExportSummaryRow) => [
        item.name,
        item.appointments,
        item.completed,
        item.booked,
        item.cancelled,
        item.lateCancelled,
        item.noShows,
        centsToEuros(item.realizedCents),
        centsToEuros(item.projectedCents),
        item.completed ? centsToEuros(Math.round(item.realizedCents / item.completed)) : 0,
        item.appointments ? item.completed / item.appointments : 0,
      ];

      const barberSheet = workbook.addWorksheet("Resumo por Barbeiro");
      addTable(
        barberSheet,
        "ResumoPorBarbeiro",
        summaryHeaders,
        Array.from(barberSummaryMap.values())
          .sort((left, right) => right.realizedCents - left.realizedCents || right.appointments - left.appointments)
          .map(summaryToRow),
      );
      finishTableSheet(barberSheet, [26, 17, 13, 12, 12, 22, 10, 20, 20, 16, 16], {
        8: currencyFormat,
        9: currencyFormat,
        10: currencyFormat,
        11: percentFormat,
      });

      const serviceSheet = workbook.addWorksheet("Resumo por Serviço");
      addTable(
        serviceSheet,
        "ResumoPorServico",
        summaryHeaders,
        Array.from(serviceSummaryMap.values())
          .sort((left, right) => right.realizedCents - left.realizedCents || right.appointments - left.appointments)
          .map(summaryToRow),
      );
      finishTableSheet(serviceSheet, [28, 17, 13, 12, 12, 22, 10, 20, 20, 16, 16], {
        8: currencyFormat,
        9: currencyFormat,
        10: currencyFormat,
        11: percentFormat,
      });

      const dailySheet = workbook.addWorksheet("Resumo diário");
      addTable(
        dailySheet,
        "ResumoDiario",
        ["Data", ...summaryHeaders.slice(1)],
        Array.from(dailySummaryMap.values()).map((item) => [
          item.date,
          item.appointments,
          item.completed,
          item.booked,
          item.cancelled,
          item.lateCancelled,
          item.noShows,
          centsToEuros(item.realizedCents),
          centsToEuros(item.projectedCents),
          item.completed ? centsToEuros(Math.round(item.realizedCents / item.completed)) : 0,
          item.appointments ? item.completed / item.appointments : 0,
        ]),
      );
      finishTableSheet(dailySheet, [14, 17, 13, 12, 12, 22, 10, 20, 20, 16, 16], {
        1: dateFormat,
        8: currencyFormat,
        9: currencyFormat,
        10: currencyFormat,
        11: percentFormat,
      });

      const detailSheet = workbook.addWorksheet("Detalhe Completo");
      const detailHeaders = [
        "Data",
        "Dia da semana",
        "Hora",
        "Fim",
        "Barbeiro",
        "Cliente",
        "Telemóvel",
        "Email",
        "Serviço",
        "Duração (min)",
        "Estado",
        "Valor serviço (€)",
        "Receita realizada (€)",
        "Receita prevista (€)",
        "Criada em",
      ];
      addTable(
        detailSheet,
        "DetalheCompleto",
        detailHeaders,
        rangeAppointments.map((appointment) => {
          const startTime = new Date(appointment.startTime);
          const service = appointment.serviceId ? servicesById.get(appointment.serviceId) : undefined;
          const barber = barbersById.get(appointment.barberId);
          const priceCents = getServicePriceCents(appointment.serviceId, servicePrices);
          const realizedCents = appointment.status === "completed" ? priceCents : 0;
          const projectedCents = appointment.status === "booked" ? priceCents : 0;

          return [
            startTime,
            format(startTime, "EEEE", { locale: pt }),
            format(startTime, "HH:mm"),
            format(new Date(startTime.getTime() + appointment.durationMinutes * 60000), "HH:mm"),
            barber?.name || "Barbeiro desconhecido",
            appointment.customerName,
            appointment.customerPhone,
            appointment.customerEmail || "",
            service?.name || "Serviço desconhecido",
            appointment.durationMinutes,
            getAppointmentStatusLabel(appointment.status),
            centsToEuros(priceCents),
            centsToEuros(realizedCents),
            centsToEuros(projectedCents),
            appointment.createdAt ? new Date(appointment.createdAt) : null,
          ];
        }),
      );
      finishTableSheet(detailSheet, [14, 18, 10, 10, 24, 26, 18, 28, 28, 14, 22, 18, 22, 20, 18], {
        1: dateFormat,
        12: currencyFormat,
        13: currencyFormat,
        14: currencyFormat,
        15: dateTimeFormat,
      });

      const fileName = `Relatório_de_${format(start, "dd-MM-yyyy")}_a_${format(end, "dd-MM-yyyy")}.xlsx`;
      const fallbackFileName = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ message: "Erro ao gerar relatório" });
    }
  });

  // === SEED DATA ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  if (await storage.hasData()) {
    // Check if admin exists, if not create one
    const admin = await storage.getAdminByUsername("admin");
    if (!admin) {
      const hashedPassword = await bcrypt.hash("baptista2026", 10);
      await storage.createAdmin({ username: "admin", password: hashedPassword });
    }
    await ensureDefaultShopAvailability();
    return;
  }

  console.log("Seeding database...");

  const barber1 = await storage.createBarber({
    name: "Fábio Baptista",
    specialty: "Cortes Clássicos e Barba",
    bio: "Especialista em cortes tradicionais na Barbearia Baptista.",
    color: "#38BDF8",
    isVisible: true
  });

  const barber2 = await storage.createBarber({
    name: "Bruno Santos",
    specialty: "Degradê e Freestyle",
    bio: "Mestre em designs modernos e cortes urbanos.",
    color: "#22C55E",
    isVisible: true
  });

  await storage.createService({
    name: "Corte de Cabelo (Degradê)",
    description: "Corte moderno com acabamento preciso e estilo personalizado.",
    price: 1200,
    duration: 60,
    isVisible: true
  });

  await storage.createService({
    name: "Corte simples",
    description: "Corte clássico e prático para o dia a dia.",
    price: 1000,
    duration: 60,
    isVisible: true
  });

  await storage.createService({
    name: "Barba",
    description: "Desenho, alinhamento e acabamento profissional da barba.",
    price: 500,
    duration: 30,
    isVisible: true
  });

  await storage.createService({
    name: "Corte Degradê + Barba",
    description: "Corte degradê com desenho e acabamento profissional da barba.",
    price: 1500,
    duration: 60,
    isVisible: true
  });

  await storage.createService({
    name: "Corte Simples + Barba",
    description: "Corte simples com desenho e acabamento profissional da barba.",
    price: 1200,
    duration: 60,
    isVisible: true
  });

  const hashedPassword = await bcrypt.hash("baptista2026", 10);
  await storage.createAdmin({ username: "admin", password: hashedPassword });
  await ensureDefaultShopAvailability();

  console.log("Database seeded!");
}
