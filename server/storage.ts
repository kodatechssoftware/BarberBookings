import { db } from "./db";
import {
  barbers,
  services,
  appointments,
  appointmentSeries,
  admins,
  blacklist,
  verificationCodes,
  shopAvailability,
  barberAvailability,
  barberServices,
  barberInvites,
  customerNotes,
  auditLogs,
  barberCompensationRules,
  businessExpenses,
  whatsappMessages,
  appointmentNotificationEvents,
  metaWebhookReceipts,
  type Barber,
  type Service,
  type Appointment,
  type AppointmentSeries,
  type RecurringNotificationSnapshot,
  type AppointmentPaymentMethod,
  type AppointmentStatus,
  type Admin,
  type Blacklist,
  type ShopAvailability,
  type BarberAvailability,
  type BarberService,
  type BarberInvite,
  type CustomerNote,
  type AuditLog,
  type BarberCompensationRule,
  type BusinessExpense,
  type WhatsappMessage,
  type AppointmentNotificationEvent,
  type MetaWebhookReceipt,
  type WhatsappMessageStatus,
  type CreateBarberRequest,
  type CreateServiceRequest,
  type CreateAppointmentRequest,
  type CreateAdminRequest,
  type InsertBlacklist,
  type CreateShopAvailabilityRequest,
  type CreateBarberAvailabilityRequest,
  type CreateBarberServiceRequest,
  type CreateBarberInviteRequest,
  type CreateCustomerNoteRequest,
  type CreateAuditLogRequest,
  type CreateBarberCompensationRuleRequest,
  type CreateBusinessExpenseRequest,
  type CreateWhatsappMessageRequest
} from "@shared/schema";
import { eq, and, gte, gt, lt, isNull, sql, desc, type SQL } from "drizzle-orm";
import { normalizeEmail } from "@shared/customer-validation";
import { supportedPhonesMatch } from "@shared/phone-countries";

export type AppointmentNotificationEventType =
  | "appointment_confirmation"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "appointment_recurring_confirmation";

type CreateAppointmentStorageRequest = Omit<CreateAppointmentRequest, "whatsappOptIn"> & {
  whatsappOptIn?: boolean;
  locationId?: number;
  cancelToken: string;
  durationMinutes: number;
  status?: AppointmentStatus;
  paymentMethod?: AppointmentPaymentMethod;
  depositRequired?: boolean;
  depositReason?: string | null;
  whatsappOptInAt?: Date | null;
  notificationEventType?: "appointment_confirmation";
  seriesId?: string | null;
  seriesOccurrenceIndex?: number | null;
};

export type CreateRecurringAppointmentSeriesRequest = {
  series: {
    id: string;
    locationId: number;
    barberId: number;
    serviceId: number;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string;
    whatsappOptIn: boolean;
    whatsappOptInAt: Date | null;
    intervalWeeks: number;
    durationMonths: number;
    occurrenceCount: number;
    firstStartTime: Date;
  };
  appointments: CreateAppointmentStorageRequest[];
  notificationSnapshot: Omit<RecurringNotificationSnapshot, "seriesId" | "occurrences">;
};

export type CreateRecurringAppointmentSeriesResult = {
  series: AppointmentSeries;
  appointments: Appointment[];
  notificationEvent: AppointmentNotificationEvent;
};

function validateRecurringAppointmentSeriesRequest(request: CreateRecurringAppointmentSeriesRequest) {
  const { series, appointments: occurrences, notificationSnapshot: snapshot } = request;
  if (occurrences.length < 2 || series.occurrenceCount !== occurrences.length
    || series.intervalWeeks <= 0 || series.durationMonths <= 0) {
    throw new Error("A recurring appointment series requires at least two matching occurrences.");
  }
  if (snapshot.location.id !== series.locationId || snapshot.barber.id !== series.barberId
    || snapshot.service.id !== series.serviceId || snapshot.customerName !== series.customerName
    || snapshot.customerEmail !== series.customerEmail || snapshot.customerPhone !== series.customerPhone
    || snapshot.whatsappOptIn !== series.whatsappOptIn
    || snapshot.recurrence.intervalWeeks !== series.intervalWeeks
    || snapshot.recurrence.durationMonths !== series.durationMonths
    || snapshot.recurrence.occurrenceCount !== series.occurrenceCount) {
    throw new Error("Recurring notification snapshot does not match its series.");
  }
  let previousStart = -Infinity;
  const cancelTokens = new Set<string>();
  for (const occurrence of occurrences) {
    const start = toAppointmentDate(occurrence.startTime).getTime();
    if (occurrence.locationId !== series.locationId || occurrence.barberId !== series.barberId
      || occurrence.serviceId !== series.serviceId || occurrence.customerName !== series.customerName
      || (occurrence.customerEmail ?? null) !== series.customerEmail
      || occurrence.customerPhone !== series.customerPhone
      || (occurrence.whatsappOptIn ?? false) !== series.whatsappOptIn
      || (occurrence.status ?? "booked") !== "booked" || occurrence.notificationEventType
      || cancelTokens.has(occurrence.cancelToken)
      || !Number.isFinite(start) || start <= previousStart) {
      throw new Error("Recurring appointment occurrences do not match their series.");
    }
    cancelTokens.add(occurrence.cancelToken);
    previousStart = start;
  }
  if (toAppointmentDate(occurrences[0].startTime).getTime() !== series.firstStartTime.getTime()) {
    throw new Error("Recurring series first occurrence does not match its start time.");
  }
}

function buildRecurringNotificationSnapshot(
  request: CreateRecurringAppointmentSeriesRequest,
  createdAppointments: Appointment[],
): RecurringNotificationSnapshot {
  return {
    ...request.notificationSnapshot,
    seriesId: request.series.id,
    location: { ...request.notificationSnapshot.location },
    service: { ...request.notificationSnapshot.service },
    barber: { ...request.notificationSnapshot.barber },
    recurrence: { ...request.notificationSnapshot.recurrence },
    occurrences: createdAppointments.map((appointment) => ({
      appointmentId: appointment.id,
      occurrenceIndex: appointment.seriesOccurrenceIndex!,
      startTime: toAppointmentDate(appointment.startTime).toISOString(),
    })),
  };
}

export type RescheduleAppointmentResult = {
  appointment: Appointment;
  notificationEvent: AppointmentNotificationEvent;
};

export type CancelAppointmentResult = RescheduleAppointmentResult;

export type CreateMetaWebhookReceiptRequest = Omit<MetaWebhookReceipt, "id" | "createdAt">;

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const appointmentConflictCode = "APPOINTMENT_CONFLICT";
const SHOP_TIME_ZONE = process.env.SHOP_TIME_ZONE || "Europe/Lisbon";
const shopDateTimePartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function shopCalendarDateToInstant(year: number, month: number, day: number) {
  const targetTimestamp = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidateTimestamp = targetTimestamp;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      shopDateTimePartsFormatter
        .formatToParts(new Date(candidateTimestamp))
        .map((part) => [part.type, part.value]),
    );
    const representedTimestamp = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const difference = representedTimestamp - targetTimestamp;
    if (difference === 0) break;
    candidateTimestamp -= difference;
  }

  return new Date(candidateTimestamp);
}

export function getShopDateBounds(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: shopCalendarDateToInstant(year, month, day),
    endExclusive: shopCalendarDateToInstant(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
    ),
  };
}

export class AppointmentConflictError extends Error {
  code = appointmentConflictCode;
  status = 409;

  constructor(message = "Este horário já está reservado.") {
    super(message);
    this.name = "AppointmentConflictError";
  }
}

export function isAppointmentConflictError(error: unknown) {
  return Boolean(
    error instanceof AppointmentConflictError ||
    (error && typeof error === "object" && "code" in error && (
      (error as { code?: unknown }).code === appointmentConflictCode ||
      (error as { code?: unknown }).code === "23P01"
    )),
  );
}

function toAppointmentDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function getDurationMinutes(duration?: number | null) {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0
    ? duration
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
}

function getAppointmentEndTime(startTime: Date | string, durationMinutes?: number | null) {
  const start = toAppointmentDate(startTime);
  return new Date(start.getTime() + getDurationMinutes(durationMinutes) * 60000);
}

function getAppointmentLockDayKey(date: Date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

function shouldProtectAppointment(status?: string | null) {
  return (status || "booked") === "booked";
}

export interface IStorage {
  // Barbers
  getBarbers(): Promise<Barber[]>;
  getBarber(id: number): Promise<Barber | undefined>;
  getBarberByEmail(email: string): Promise<Barber | undefined>;
  createBarber(barber: CreateBarberRequest): Promise<Barber>;
  updateBarber(id: number, barber: Partial<CreateBarberRequest>): Promise<Barber | undefined>;
  deleteBarber(id: number): Promise<"deleted" | "hidden">;

  // Services
  getServices(): Promise<Service[]>;
  getService(id: number): Promise<Service | undefined>;
  createService(service: CreateServiceRequest): Promise<Service>;
  updateService(id: number, service: Partial<CreateServiceRequest>): Promise<Service | undefined>;
  deleteService(id: number): Promise<void>;

  // Appointments
  getAppointments(barberId?: number, date?: string, locationId?: number): Promise<Appointment[]>;
  getAppointmentsRange(barberId?: number, startDate?: string, endDate?: string, locationId?: number): Promise<Appointment[]>;
  getAppointment(id: number): Promise<Appointment | undefined>;
  getAppointmentByToken(token: string): Promise<Appointment | undefined>;
  createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment>;
  createAppointments(appointments: CreateAppointmentStorageRequest[]): Promise<Appointment[]>;
  createRecurringAppointmentSeries(request: CreateRecurringAppointmentSeriesRequest): Promise<CreateRecurringAppointmentSeriesResult>;
  getAppointmentSeries(id: string): Promise<AppointmentSeries | undefined>;
  getAppointmentSeriesAppointments(id: string): Promise<Appointment[]>;
  updateAppointment(
    id: number,
    appointment: Partial<Omit<Appointment, "id">>,
    expectedStatus?: AppointmentStatus,
  ): Promise<Appointment | undefined>;
  rescheduleAppointment(
    id: number,
    expectedRevision: number,
    startTime: Date,
  ): Promise<RescheduleAppointmentResult | undefined>;
  cancelAppointment(
    id: number,
    expectedStatus: "booked",
    status: "cancelled" | "late_cancelled",
  ): Promise<CancelAppointmentResult | undefined>;
  updateAppointmentStatus(
    id: number,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined>;
  updateAppointmentStatusIfCurrent(
    id: number,
    currentStatus: AppointmentStatus,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined>;
  
  // Admins
  getAdminByUsername(username: string): Promise<Admin | undefined>;
  createAdmin(admin: CreateAdminRequest): Promise<Admin>;
  updateAdminPassword(id: number, password: string): Promise<void>;

  // Blacklist
  getBlacklist(): Promise<Blacklist[]>;
  addToBlacklist(data: InsertBlacklist): Promise<Blacklist>;
  removeFromBlacklist(id: number): Promise<void>;
  isBlacklisted(email?: string, phone?: string): Promise<boolean>;

  // Barber availability
  getShopAvailability(locationId?: number): Promise<ShopAvailability[]>;
  replaceShopAvailability(rows: CreateShopAvailabilityRequest[], locationId?: number): Promise<ShopAvailability[]>;
  getBarberAvailability(barberId: number, locationId?: number): Promise<BarberAvailability[]>;
  getAllBarberAvailability(locationId?: number): Promise<BarberAvailability[]>;
  replaceBarberAvailability(barberId: number, rows: Omit<CreateBarberAvailabilityRequest, "barberId">[], locationId?: number): Promise<BarberAvailability[]>;
  getAllBarberServices(): Promise<BarberService[]>;
  getBarberServiceIds(barberId: number): Promise<number[]>;
  replaceBarberServices(barberId: number, serviceIds: number[]): Promise<BarberService[]>;

  // Barber invites
  createBarberInvite(invite: CreateBarberInviteRequest): Promise<BarberInvite>;
  createBarberInviteReplacingActive(invite: CreateBarberInviteRequest): Promise<BarberInvite>;
  getBarberInviteByToken(token: string): Promise<BarberInvite | undefined>;
  markBarberInviteUsed(id: number): Promise<BarberInvite | undefined>;
  invalidateBarberInvites(barberId: number): Promise<void>;
  acceptBarberInvite(inviteId: number, barberId: number, password: string): Promise<Barber | undefined>;

  // Customer notes
  getCustomerNoteByIdentity(phone: string, customerNameKey: string): Promise<CustomerNote | undefined>;
  upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote>;

  // Audit log
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  createAuditLog(log: CreateAuditLogRequest): Promise<AuditLog>;

  // Barber compensation
  getBarberCompensationRules(barberId?: number): Promise<BarberCompensationRule[]>;
  createBarberCompensationRule(rule: CreateBarberCompensationRuleRequest): Promise<BarberCompensationRule>;

  // Business expenses
  getBusinessExpenses(filters?: {
    startDate?: string;
    endDate?: string;
    category?: string;
    locationId?: number;
  }): Promise<BusinessExpense[]>;
  createBusinessExpense(expense: CreateBusinessExpenseRequest): Promise<BusinessExpense>;
  updateBusinessExpense(id: number, expense: Partial<CreateBusinessExpenseRequest>): Promise<BusinessExpense | undefined>;
  deleteBusinessExpense(id: number): Promise<void>;

  // WhatsApp deliveries
  getWhatsappMessage(id: number): Promise<WhatsappMessage | undefined>;
  createWhatsappMessage(message: CreateWhatsappMessageRequest): Promise<WhatsappMessage>;
  updateWhatsappMessageStatusByProviderId(
    providerMessageId: string,
    status: WhatsappMessageStatus,
    providerStatus?: string | null,
    webhookPayload?: string | null,
  ): Promise<WhatsappMessage | undefined>;

  // Transactional notification outbox
  getAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined>;
  getAppointmentNotificationEvents(appointmentId: number): Promise<AppointmentNotificationEvent[]>;
  getAppointmentNotificationEventByProviderId(providerMessageId: string): Promise<AppointmentNotificationEvent | undefined>;
  claimAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined>;
  claimNextAppointmentNotificationEvent(leaseBefore: Date, includeUnattemptedWhatsappOptIn?: boolean): Promise<AppointmentNotificationEvent | undefined>;
  claimAppointmentNotificationWhatsappAttempt(id: number): Promise<AppointmentNotificationEvent | undefined>;
  updateAppointmentNotificationEvent(
    id: number,
    patch: Partial<Omit<AppointmentNotificationEvent, "id" | "appointmentId" | "seriesId" | "eventKey" | "eventType" | "eventRevision" | "createdAt">>,
  ): Promise<AppointmentNotificationEvent | undefined>;
  createMetaWebhookReceipt(receipt: CreateMetaWebhookReceiptRequest): Promise<{ receipt: MetaWebhookReceipt; created: boolean }>;
  getMetaWebhookReceipts(providerMessageId: string): Promise<MetaWebhookReceipt[]>;
  reconcileMetaWebhookReceipts(providerMessageId: string, eventId: number): Promise<void>;

  // Verification
  createVerificationCode(phone: string, code: string): Promise<void>;
  getVerificationCode(phone: string, code: string): Promise<boolean>;

  // Seed check
  hasData(): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private async lockAppointmentDay(
    tx: Pick<typeof db, "execute">,
    barberId: number,
    startTime: Date | string,
  ) {
    const date = toAppointmentDate(startTime);
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(${barberId}, ${getAppointmentLockDayKey(date)})
    `);
  }

  private async assertNoAppointmentConflict(
    tx: Pick<typeof db, "select">,
    candidate: {
      barberId: number;
      startTime: Date | string;
      durationMinutes?: number | null;
      status?: string | null;
    },
    ignoreAppointmentId?: number,
  ) {
    if (!shouldProtectAppointment(candidate.status)) return;

    const startTime = toAppointmentDate(candidate.startTime);
    const endTime = getAppointmentEndTime(startTime, candidate.durationMinutes);
    const conflictConditions: SQL[] = [
      eq(appointments.barberId, candidate.barberId),
      eq(appointments.status, "booked"),
      sql`${appointments.startTime} < ${endTime}`,
      sql`${appointments.startTime} + make_interval(mins => ${appointments.durationMinutes}) > ${startTime}`,
    ];

    if (ignoreAppointmentId !== undefined) {
      conflictConditions.push(sql`${appointments.id} <> ${ignoreAppointmentId}`);
    }

    const [conflictingAppointment] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(...conflictConditions))
      .limit(1);

    if (conflictingAppointment) {
      throw new AppointmentConflictError();
    }
  }

  async getBarbers(): Promise<Barber[]> {
    return await db.select().from(barbers).orderBy(barbers.id);
  }

  async getBarber(id: number): Promise<Barber | undefined> {
    const [barber] = await db.select().from(barbers).where(eq(barbers.id, id));
    return barber;
  }

  async getBarberByEmail(email: string): Promise<Barber | undefined> {
    const [barber] = await db.select().from(barbers).where(eq(barbers.email, email));
    return barber;
  }

  async createBarber(barber: CreateBarberRequest): Promise<Barber> {
    const [newBarber] = await db.insert(barbers).values(barber).returning();
    return newBarber;
  }

  async updateBarber(id: number, barber: Partial<CreateBarberRequest>): Promise<Barber | undefined> {
    const [updated] = await db.update(barbers).set(barber).where(eq(barbers.id, id)).returning();
    return updated;
  }

  async deleteBarber(id: number): Promise<"deleted" | "hidden"> {
    const [futureAppointment] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(
        eq(appointments.barberId, id),
        eq(appointments.status, "booked"),
        gte(appointments.startTime, new Date()),
      ))
      .limit(1);

    if (futureAppointment) {
      const error = new Error("Barber has future appointments") as Error & { code?: string };
      error.code = "BARBER_HAS_FUTURE_APPOINTMENTS";
      throw error;
    }

    const [historicalAppointment] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.barberId, id))
      .limit(1);

    if (historicalAppointment) {
      await db.update(barbers).set({ isVisible: false }).where(eq(barbers.id, id));
      return "hidden";
    }

    await db.delete(barberServices).where(eq(barberServices.barberId, id));
    await db.delete(barberAvailability).where(eq(barberAvailability.barberId, id));
    await db.delete(barbers).where(eq(barbers.id, id));
    return "deleted";
  }

  async getServices(): Promise<Service[]> {
    return await db.select().from(services).orderBy(services.id);
  }

  async getService(id: number): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  async createService(service: CreateServiceRequest): Promise<Service> {
    const [newService] = await db.insert(services).values(service).returning();
    return newService;
  }

  async updateService(id: number, service: Partial<CreateServiceRequest>): Promise<Service | undefined> {
    const [updated] = await db.update(services).set(service).where(eq(services.id, id)).returning();
    return updated;
  }

  async deleteService(id: number): Promise<void> {
    const [futureAppointment] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(
        eq(appointments.serviceId, id),
        eq(appointments.status, "booked"),
        gte(appointments.startTime, new Date()),
      ))
      .limit(1);

    if (futureAppointment) {
      const error = new Error("Service has future appointments") as Error & { code?: string };
      error.code = "SERVICE_HAS_FUTURE_APPOINTMENTS";
      throw error;
    }

    await db.delete(barberServices).where(eq(barberServices.serviceId, id));
    // Set serviceId to null for all appointments linked to this service
    await db.update(appointments).set({ serviceId: null }).where(eq(appointments.serviceId, id));
    // Now we can safely delete the service
    await db.delete(services).where(eq(services.id, id));
  }

  async getAppointments(barberId?: number, date?: string, locationId?: number): Promise<Appointment[]> {
    const conditions: SQL[] = [];
    if (barberId !== undefined) {
      conditions.push(eq(appointments.barberId, barberId));
    }
    if (locationId !== undefined) conditions.push(eq(appointments.locationId, locationId));
    
    if (date) {
      const { start, endExclusive } = getShopDateBounds(date);
      conditions.push(gte(appointments.startTime, start), lt(appointments.startTime, endExclusive));
    }

    if (conditions.length > 0) {
      return await db
        .select()
        .from(appointments)
        .where(and(...conditions))
        .orderBy(appointments.startTime);
    }

    return await db.select().from(appointments).orderBy(appointments.startTime);
  }

  async getAppointmentsRange(barberId?: number, startDate?: string, endDate?: string, locationId?: number): Promise<Appointment[]> {
    const conditions: SQL[] = [];
    if (barberId !== undefined) {
      conditions.push(eq(appointments.barberId, barberId));
    }
    if (locationId !== undefined) conditions.push(eq(appointments.locationId, locationId));

    if (startDate) {
      const { start } = getShopDateBounds(startDate);
      conditions.push(gte(appointments.startTime, start));
    }

    if (endDate) {
      const { endExclusive } = getShopDateBounds(endDate);
      conditions.push(lt(appointments.startTime, endExclusive));
    }

    if (conditions.length === 0) {
      return this.getAppointments();
    }

    return await db
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(appointments.startTime);
  }

  async getAppointmentByToken(token: string): Promise<Appointment | undefined> {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.cancelToken, token));
    return appointment;
  }

  async getAppointment(id: number): Promise<Appointment | undefined> {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.id, id));
    return appointment;
  }

  async createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment> {
    const [createdAppointment] = await this.createAppointments([appointment]);
    return createdAppointment;
  }

  async createAppointments(appointmentInputs: CreateAppointmentStorageRequest[]): Promise<Appointment[]> {
    if (appointmentInputs.length === 0) return [];

    try {
      return await db.transaction(async (tx) => {
        const lockTargets = new Map<string, CreateAppointmentStorageRequest>();
        for (const appointment of appointmentInputs) {
          const dayKey = getAppointmentLockDayKey(toAppointmentDate(appointment.startTime));
          lockTargets.set(`${appointment.barberId}:${dayKey}`, appointment);
        }

        const sortedLockTargets = Array.from(lockTargets.values()).sort((left, right) => {
          if (left.barberId !== right.barberId) return left.barberId - right.barberId;
          return toAppointmentDate(left.startTime).getTime() - toAppointmentDate(right.startTime).getTime();
        });
        for (const appointment of sortedLockTargets) {
          await this.lockAppointmentDay(tx, appointment.barberId, appointment.startTime);
        }

        const createdAppointments: Appointment[] = [];
        for (const appointment of appointmentInputs) {
          await this.assertNoAppointmentConflict(tx, appointment);
          const { notificationEventType, ...appointmentValues } = appointment;
          const notificationRevision = notificationEventType ? 1 : 0;
          const [newAppointment] = await tx.insert(appointments).values({
            ...appointmentValues,
            notificationRevision,
            whatsappOptInAt: appointment.whatsappOptIn
              ? appointment.whatsappOptInAt ?? new Date()
              : null,
          }).returning();
          if (notificationEventType) {
            await tx.insert(appointmentNotificationEvents).values({
              appointmentId: newAppointment.id,
              eventType: notificationEventType,
              eventRevision: notificationRevision,
              eventKey: `appointment:${newAppointment.id}:confirmation:${notificationRevision}`,
              appointmentStartTime: toAppointmentDate(newAppointment.startTime),
              newStartTime: toAppointmentDate(newAppointment.startTime),
            });
          }
          createdAppointments.push(newAppointment);
        }

        return createdAppointments;
      });
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        throw new AppointmentConflictError();
      }
      throw error;
    }
  }

  async updateAppointment(
    id: number,
    appointment: Partial<Omit<Appointment, "id">>,
    expectedStatus?: AppointmentStatus,
  ): Promise<Appointment | undefined> {
    try {
      return await db.transaction(async (tx) => {
        const appointmentConditions = [eq(appointments.id, id)];
        if (expectedStatus) {
          appointmentConditions.push(eq(appointments.status, expectedStatus));
        }
        const [current] = await tx
          .select()
          .from(appointments)
          .where(and(...appointmentConditions))
          .limit(1);

        if (!current) return undefined;

        const candidate = {
          ...current,
          ...appointment,
        };

        if (shouldProtectAppointment(candidate.status)) {
          await this.lockAppointmentDay(tx, candidate.barberId, candidate.startTime);
          await this.assertNoAppointmentConflict(tx, candidate, id);
        }

        const [updated] = await tx
          .update(appointments)
          .set(appointment)
          .where(and(...appointmentConditions))
          .returning();
        if (updated && current.seriesId) {
          await tx.update(appointmentSeries).set({
            notificationRevision: sql`${appointmentSeries.notificationRevision} + 1`,
            updatedAt: new Date(),
          }).where(eq(appointmentSeries.id, current.seriesId));
        }
        return updated;
      });
    } catch (error) {
      if (isAppointmentConflictError(error)) {
        throw new AppointmentConflictError();
      }
      throw error;
    }
  }

  async updateAppointmentStatus(
    id: number,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined> {
    const updateData: {
      status: AppointmentStatus;
      cancelledAt?: Date | null;
      paymentMethod?: AppointmentPaymentMethod;
    } = { status };
    if (status === "cancelled" || status === "late_cancelled") {
      updateData.cancelledAt = new Date();
    }
    if (status === "booked" || status === "completed") {
      updateData.cancelledAt = null;
    }
    updateData.paymentMethod = status === "completed" ? (paymentMethod || "pending") : "pending";

    const current = await this.getAppointment(id);
    if (!current) return undefined;
    return this.updateAppointment(id, { ...updateData, notificationRevision: current.notificationRevision + 1 });
  }

  async updateAppointmentStatusIfCurrent(
    id: number,
    currentStatus: AppointmentStatus,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined> {
    const updateData: {
      status: AppointmentStatus;
      cancelledAt?: Date | null;
      paymentMethod?: AppointmentPaymentMethod;
    } = { status };
    if (status === "cancelled" || status === "late_cancelled") {
      updateData.cancelledAt = new Date();
    }
    if (status === "booked" || status === "completed") {
      updateData.cancelledAt = null;
    }
    updateData.paymentMethod = status === "completed" ? (paymentMethod || "pending") : "pending";

    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.status, currentStatus))).limit(1);
      if (!current) return undefined;
      const [updated] = await tx
        .update(appointments)
        .set({ ...updateData, notificationRevision: sql`${appointments.notificationRevision} + 1` })
        .where(and(eq(appointments.id, id), eq(appointments.status, currentStatus)))
        .returning();
      if (updated && current.seriesId) {
        await tx.update(appointmentSeries).set({
          notificationRevision: sql`${appointmentSeries.notificationRevision} + 1`,
          updatedAt: new Date(),
        }).where(eq(appointmentSeries.id, current.seriesId));
      }
      return updated;
    });
  }

  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    const [admin] = await db.select().from(admins).where(eq(admins.username, username));
    return admin;
  }

  async createAdmin(admin: CreateAdminRequest): Promise<Admin> {
    const [newAdmin] = await db.insert(admins).values(admin).returning();
    return newAdmin;
  }

  async rescheduleAppointment(
    id: number,
    expectedRevision: number,
    startTime: Date,
  ): Promise<RescheduleAppointmentResult | undefined> {
    try {
      return await db.transaction(async (tx) => {
        // Serialize changes to the same appointment, including requests targeting different days.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(-2, ${id})`);
        const [current] = await tx
          .select()
          .from(appointments)
          .where(and(
            eq(appointments.id, id),
            eq(appointments.status, "booked"),
            eq(appointments.rescheduleRevision, expectedRevision),
          ))
          .limit(1);
        if (!current) return undefined;

        const candidate = { ...current, startTime };
        await this.lockAppointmentDay(tx, candidate.barberId, candidate.startTime);
        await this.assertNoAppointmentConflict(tx, candidate, id);

        const nextRescheduleRevision = current.rescheduleRevision + 1;
        const nextRevision = current.notificationRevision + 1;
        const [updated] = await tx
          .update(appointments)
          .set({ startTime, rescheduleRevision: nextRescheduleRevision, notificationRevision: nextRevision })
          .where(and(
            eq(appointments.id, id),
            eq(appointments.status, "booked"),
            eq(appointments.rescheduleRevision, expectedRevision),
          ))
          .returning();
        if (!updated) return undefined;
        if (current.seriesId) {
          await tx.update(appointmentSeries).set({
            notificationRevision: sql`${appointmentSeries.notificationRevision} + 1`,
            updatedAt: new Date(),
          }).where(eq(appointmentSeries.id, current.seriesId));
        }

        const eventKey = `appointment:${id}:rescheduled:${nextRevision}`;
        const [notificationEvent] = await tx
          .insert(appointmentNotificationEvents)
          .values({
            appointmentId: id,
            eventType: "appointment_rescheduled",
            eventRevision: nextRevision,
            eventKey,
            appointmentStartTime: startTime,
            previousStartTime: toAppointmentDate(current.startTime),
            newStartTime: startTime,
          })
          .returning();

        return { appointment: updated, notificationEvent };
      });
    } catch (error) {
      if (isAppointmentConflictError(error)) throw new AppointmentConflictError();
      throw error;
    }
  }

  async createRecurringAppointmentSeries(
    request: CreateRecurringAppointmentSeriesRequest,
  ): Promise<CreateRecurringAppointmentSeriesResult> {
    validateRecurringAppointmentSeriesRequest(request);
    try {
      return await db.transaction(async (tx) => {
        const lockTargets = new Map<string, CreateAppointmentStorageRequest>();
        for (const appointment of request.appointments) {
          const dayKey = getAppointmentLockDayKey(toAppointmentDate(appointment.startTime));
          lockTargets.set(`${appointment.barberId}:${dayKey}`, appointment);
        }
        for (const appointment of Array.from(lockTargets.values()).sort((left, right) =>
          left.barberId - right.barberId || toAppointmentDate(left.startTime).getTime() - toAppointmentDate(right.startTime).getTime())) {
          await this.lockAppointmentDay(tx, appointment.barberId, appointment.startTime);
        }

        const [series] = await tx.insert(appointmentSeries).values({
          ...request.series,
          notificationRevision: 1,
          status: "active",
        }).returning();
        const createdAppointments: Appointment[] = [];
        for (let occurrenceIndex = 0; occurrenceIndex < request.appointments.length; occurrenceIndex += 1) {
          const appointment = request.appointments[occurrenceIndex];
          await this.assertNoAppointmentConflict(tx, appointment);
          const { notificationEventType: _notificationEventType, ...values } = appointment;
          const [created] = await tx.insert(appointments).values({
            ...values,
            notificationRevision: 0,
            whatsappOptInAt: values.whatsappOptIn ? values.whatsappOptInAt ?? new Date() : null,
            seriesId: series.id,
            seriesOccurrenceIndex: occurrenceIndex,
          }).returning();
          createdAppointments.push(created);
        }
        const payloadSnapshot = buildRecurringNotificationSnapshot(request, createdAppointments);
        const [notificationEvent] = await tx.insert(appointmentNotificationEvents).values({
          appointmentId: null,
          seriesId: series.id,
          eventType: "appointment_recurring_confirmation",
          eventRevision: series.notificationRevision,
          eventKey: `series:${series.id}:recurring_confirmation:${series.notificationRevision}`,
          appointmentStartTime: request.series.firstStartTime,
          payloadSnapshot,
        }).returning();
        return { series, appointments: createdAppointments, notificationEvent };
      });
    } catch (error) {
      if (isAppointmentConflictError(error)) throw new AppointmentConflictError();
      throw error;
    }
  }

  async getAppointmentSeries(id: string): Promise<AppointmentSeries | undefined> {
    const [series] = await db.select().from(appointmentSeries).where(eq(appointmentSeries.id, id)).limit(1);
    return series;
  }

  async getAppointmentSeriesAppointments(id: string): Promise<Appointment[]> {
    return db.select().from(appointments).where(eq(appointments.seriesId, id)).orderBy(appointments.seriesOccurrenceIndex);
  }

  async cancelAppointment(
    id: number,
    expectedStatus: "booked",
    status: "cancelled" | "late_cancelled",
  ): Promise<CancelAppointmentResult | undefined> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(-2, ${id})`);
      const [current] = await tx.select().from(appointments).where(and(
        eq(appointments.id, id),
        eq(appointments.status, expectedStatus),
      )).limit(1);
      if (!current) return undefined;

      const nextRevision = current.notificationRevision + 1;
      const [updated] = await tx.update(appointments).set({
        status,
        cancelledAt: new Date(),
        paymentMethod: "pending",
        notificationRevision: nextRevision,
      }).where(and(eq(appointments.id, id), eq(appointments.status, expectedStatus))).returning();
      if (!updated) return undefined;
      if (current.seriesId) {
        await tx.update(appointmentSeries).set({
          notificationRevision: sql`${appointmentSeries.notificationRevision} + 1`,
          updatedAt: new Date(),
        }).where(eq(appointmentSeries.id, current.seriesId));
      }

      const [notificationEvent] = await tx.insert(appointmentNotificationEvents).values({
        appointmentId: id,
        eventType: "appointment_cancelled",
        eventRevision: nextRevision,
        eventKey: `appointment:${id}:cancelled:${nextRevision}`,
        appointmentStartTime: toAppointmentDate(current.startTime),
        previousStartTime: toAppointmentDate(current.startTime),
      }).returning();
      return { appointment: updated, notificationEvent };
    });
  }

  async updateAdminPassword(id: number, password: string): Promise<void> {
    await db.update(admins).set({ password }).where(eq(admins.id, id));
  }

  async getBlacklist(): Promise<Blacklist[]> {
    return await db.select().from(blacklist).orderBy(blacklist.createdAt);
  }

  async addToBlacklist(data: InsertBlacklist): Promise<Blacklist> {
    const [entry] = await db.insert(blacklist).values(data).returning();
    return entry;
  }

  async removeFromBlacklist(id: number): Promise<void> {
    await db.delete(blacklist).where(eq(blacklist.id, id));
  }

  async isBlacklisted(email?: string, phone?: string): Promise<boolean> {
    const hasPhone = Boolean(phone?.replace(/\D/g, ""));
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail && !hasPhone) return false;

    const entries = await db.select().from(blacklist);
    return entries.some((entry) =>
      (hasPhone && supportedPhonesMatch(entry.phone, phone)) ||
      (normalizedEmail && normalizeEmail(entry.email) === normalizedEmail),
    );
  }

  async getShopAvailability(locationId?: number): Promise<ShopAvailability[]> {
    return await db
      .select()
      .from(shopAvailability)
      .where(locationId === undefined ? undefined : eq(shopAvailability.locationId, locationId))
      .orderBy(shopAvailability.dayOfWeek, shopAvailability.startTime);
  }

  async replaceShopAvailability(rows: CreateShopAvailabilityRequest[], locationId = 1): Promise<ShopAvailability[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(shopAvailability).where(eq(shopAvailability.locationId, locationId));

      if (rows.length === 0) {
        return [];
      }

      return await tx.insert(shopAvailability).values(rows.map((row) => ({ ...row, locationId }))).returning();
    });
  }

  async getBarberAvailability(barberId: number, locationId?: number): Promise<BarberAvailability[]> {
    return await db
      .select()
      .from(barberAvailability)
      .where(and(
        eq(barberAvailability.barberId, barberId),
        ...(locationId === undefined ? [] : [eq(barberAvailability.locationId, locationId)]),
      ))
      .orderBy(barberAvailability.dayOfWeek, barberAvailability.startTime);
  }

  async getAllBarberAvailability(locationId?: number): Promise<BarberAvailability[]> {
    return await db
      .select()
      .from(barberAvailability)
      .where(locationId === undefined ? undefined : eq(barberAvailability.locationId, locationId))
      .orderBy(barberAvailability.barberId, barberAvailability.dayOfWeek, barberAvailability.startTime);
  }

  async replaceBarberAvailability(
    barberId: number,
    rows: Omit<CreateBarberAvailabilityRequest, "barberId">[],
    locationId = 1,
  ): Promise<BarberAvailability[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(barberAvailability).where(and(
        eq(barberAvailability.barberId, barberId),
        eq(barberAvailability.locationId, locationId),
      ));

      if (rows.length === 0) {
        return [];
      }

      return await tx
        .insert(barberAvailability)
        .values(rows.map((row) => ({ ...row, barberId, locationId })))
        .returning();
    });
  }

  async getAllBarberServices(): Promise<BarberService[]> {
    return await db
      .select()
      .from(barberServices)
      .orderBy(barberServices.barberId, barberServices.serviceId);
  }

  async getBarberServiceIds(barberId: number): Promise<number[]> {
    const rows = await db
      .select({ serviceId: barberServices.serviceId })
      .from(barberServices)
      .where(eq(barberServices.barberId, barberId))
      .orderBy(barberServices.serviceId);

    return rows.map((row) => row.serviceId);
  }

  async replaceBarberServices(barberId: number, serviceIds: number[]): Promise<BarberService[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(barberServices).where(eq(barberServices.barberId, barberId));

      const uniqueServiceIds = Array.from(new Set(serviceIds));
      if (uniqueServiceIds.length === 0) {
        return [];
      }

      return await tx
        .insert(barberServices)
        .values(uniqueServiceIds.map((serviceId) => ({ barberId, serviceId } satisfies CreateBarberServiceRequest)))
        .returning();
    });
  }

  async createBarberInvite(invite: CreateBarberInviteRequest): Promise<BarberInvite> {
    const [newInvite] = await db.insert(barberInvites).values(invite).returning();
    return newInvite;
  }

  async createBarberInviteReplacingActive(invite: CreateBarberInviteRequest): Promise<BarberInvite> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${invite.barberId}, -1)`);
      await tx
        .update(barberInvites)
        .set({ usedAt: new Date() })
        .where(and(eq(barberInvites.barberId, invite.barberId), isNull(barberInvites.usedAt)));
      const [newInvite] = await tx.insert(barberInvites).values(invite).returning();
      return newInvite;
    });
  }

  async getBarberInviteByToken(token: string): Promise<BarberInvite | undefined> {
    const [invite] = await db.select().from(barberInvites).where(eq(barberInvites.token, token));
    return invite;
  }

  async markBarberInviteUsed(id: number): Promise<BarberInvite | undefined> {
    const [updated] = await db
      .update(barberInvites)
      .set({ usedAt: new Date() })
      .where(eq(barberInvites.id, id))
      .returning();
    return updated;
  }

  async invalidateBarberInvites(barberId: number): Promise<void> {
    await db
      .update(barberInvites)
      .set({ usedAt: new Date() })
      .where(and(eq(barberInvites.barberId, barberId), isNull(barberInvites.usedAt)));
  }

  async acceptBarberInvite(inviteId: number, barberId: number, password: string): Promise<Barber | undefined> {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const [claimedInvite] = await tx
        .update(barberInvites)
        .set({ usedAt: now })
        .where(and(
          eq(barberInvites.id, inviteId),
          eq(barberInvites.barberId, barberId),
          isNull(barberInvites.usedAt),
          gt(barberInvites.expiresAt, now),
        ))
        .returning();
      if (!claimedInvite) return undefined;

      const [updatedBarber] = await tx
        .update(barbers)
        .set({ password })
        .where(eq(barbers.id, barberId))
        .returning();
      if (!updatedBarber) {
        throw new Error("Barber not found while accepting invite");
      }
      return updatedBarber;
    });
  }

  async getCustomerNoteByIdentity(phone: string, customerNameKey: string): Promise<CustomerNote | undefined> {
    const [note] = await db
      .select()
      .from(customerNotes)
      .where(and(eq(customerNotes.phone, phone), eq(customerNotes.customerNameKey, customerNameKey)));
    return note;
  }

  async upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote> {
    const now = new Date();
    const [savedNote] = await db
      .insert(customerNotes)
      .values({
        phone: note.phone,
        customerNameKey: note.customerNameKey || "",
        email: note.email || null,
        notes: note.notes || "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [customerNotes.phone, customerNotes.customerNameKey],
        set: {
          email: note.email || null,
          notes: note.notes || "",
          updatedAt: now,
        },
      })
      .returning();

    return savedNote;
  }

  async getAuditLogs(limit = 50): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
  }

  async createAuditLog(log: CreateAuditLogRequest): Promise<AuditLog> {
    const [entry] = await db.insert(auditLogs).values(log).returning();
    return entry;
  }

  async getBarberCompensationRules(barberId?: number): Promise<BarberCompensationRule[]> {
    const query = db
      .select()
      .from(barberCompensationRules)
      .orderBy(barberCompensationRules.barberId, desc(barberCompensationRules.effectiveFrom), desc(barberCompensationRules.id));

    if (barberId === undefined) return await query;

    return await db
      .select()
      .from(barberCompensationRules)
      .where(eq(barberCompensationRules.barberId, barberId))
      .orderBy(desc(barberCompensationRules.effectiveFrom), desc(barberCompensationRules.id));
  }

  async createBarberCompensationRule(rule: CreateBarberCompensationRuleRequest): Promise<BarberCompensationRule> {
    const [created] = await db.insert(barberCompensationRules).values(rule).returning();
    return created;
  }

  async getBusinessExpenses(filters: {
    startDate?: string;
    endDate?: string;
    category?: string;
    locationId?: number;
  } = {}): Promise<BusinessExpense[]> {
    const conditions: SQL[] = [];
    if (filters.locationId !== undefined) conditions.push(eq(businessExpenses.locationId, filters.locationId));

    if (filters.startDate) {
      const { start } = getShopDateBounds(filters.startDate);
      conditions.push(gte(businessExpenses.expenseDate, start));
    }

    if (filters.endDate) {
      const { endExclusive } = getShopDateBounds(filters.endDate);
      conditions.push(lt(businessExpenses.expenseDate, endExclusive));
    }

    if (filters.category && filters.category !== "all") {
      conditions.push(eq(businessExpenses.category, filters.category as any));
    }

    const query = db
      .select()
      .from(businessExpenses)
      .orderBy(desc(businessExpenses.expenseDate), desc(businessExpenses.id));

    if (conditions.length === 0) return await query;

    return await db
      .select()
      .from(businessExpenses)
      .where(and(...conditions))
      .orderBy(desc(businessExpenses.expenseDate), desc(businessExpenses.id));
  }

  async createBusinessExpense(expense: CreateBusinessExpenseRequest): Promise<BusinessExpense> {
    const [created] = await db.insert(businessExpenses).values(expense).returning();
    return created;
  }

  async updateBusinessExpense(id: number, expense: Partial<CreateBusinessExpenseRequest>): Promise<BusinessExpense | undefined> {
    const [updated] = await db
      .update(businessExpenses)
      .set({ ...expense, updatedAt: new Date() })
      .where(eq(businessExpenses.id, id))
      .returning();
    return updated;
  }

  async deleteBusinessExpense(id: number): Promise<void> {
    await db.delete(businessExpenses).where(eq(businessExpenses.id, id));
  }

  async createWhatsappMessage(message: CreateWhatsappMessageRequest): Promise<WhatsappMessage> {
    const [created] = await db.insert(whatsappMessages).values(message).returning();
    return created;
  }

  async getAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined> {
    const [event] = await db
      .select()
      .from(appointmentNotificationEvents)
      .where(eq(appointmentNotificationEvents.id, id))
      .limit(1);
    return event;
  }

  async getAppointmentNotificationEvents(appointmentId: number): Promise<AppointmentNotificationEvent[]> {
    return db.select().from(appointmentNotificationEvents)
      .where(eq(appointmentNotificationEvents.appointmentId, appointmentId))
      .orderBy(appointmentNotificationEvents.eventRevision, appointmentNotificationEvents.id);
  }

  async getAppointmentNotificationEventByProviderId(providerMessageId: string): Promise<AppointmentNotificationEvent | undefined> {
    const [event] = await db.select().from(appointmentNotificationEvents)
      .where(eq(appointmentNotificationEvents.providerMessageId, providerMessageId)).limit(1);
    return event;
  }

  async claimAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined> {
    const [event] = await db
      .update(appointmentNotificationEvents)
      .set({ processingStartedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(appointmentNotificationEvents.id, id),
        isNull(appointmentNotificationEvents.processingStartedAt),
      ))
      .returning();
    return event;
  }

  async claimNextAppointmentNotificationEvent(leaseBefore: Date, includeUnattemptedWhatsappOptIn = true): Promise<AppointmentNotificationEvent | undefined> {
    return db.transaction(async (tx) => {
      const candidates = await tx.execute(sql`
        SELECT ane.id FROM ${appointmentNotificationEvents} AS ane
        LEFT JOIN ${appointments} AS appt ON appt.id = ane.appointment_id
        WHERE ane.processing_completed_at IS NULL
          AND (ane.processing_started_at IS NULL OR ane.processing_started_at < ${leaseBefore})
          AND (ane.series_id IS NOT NULL OR ${includeUnattemptedWhatsappOptIn} OR appt.whatsapp_opt_in = false OR ane.whatsapp_attempted_at IS NOT NULL)
        ORDER BY ane.id
        FOR UPDATE OF ane SKIP LOCKED
        LIMIT 1
      `);
      const row = candidates.rows[0] as { id?: number } | undefined;
      if (!row?.id) return undefined;
      const [event] = await tx.update(appointmentNotificationEvents)
        .set({ processingStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(appointmentNotificationEvents.id, Number(row.id))).returning();
      return event;
    });
  }

  async claimAppointmentNotificationWhatsappAttempt(id: number): Promise<AppointmentNotificationEvent | undefined> {
    const [event] = await db.update(appointmentNotificationEvents)
      .set({ whatsappAttemptedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(appointmentNotificationEvents.id, id),
        isNull(appointmentNotificationEvents.whatsappAttemptedAt),
      ))
      .returning();
    return event;
  }

  async updateAppointmentNotificationEvent(
    id: number,
    patch: Partial<Omit<AppointmentNotificationEvent, "id" | "appointmentId" | "seriesId" | "eventKey" | "eventType" | "eventRevision" | "createdAt">>,
  ): Promise<AppointmentNotificationEvent | undefined> {
    const [event] = await db
      .update(appointmentNotificationEvents)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(appointmentNotificationEvents.id, id))
      .returning();
    return event;
  }

  async createMetaWebhookReceipt(receipt: CreateMetaWebhookReceiptRequest): Promise<{ receipt: MetaWebhookReceipt; created: boolean }> {
    const [created] = await db.insert(metaWebhookReceipts).values(receipt)
      .onConflictDoNothing({ target: metaWebhookReceipts.receiptKey }).returning();
    if (created) return { receipt: created, created: true };
    const [existing] = await db.select().from(metaWebhookReceipts)
      .where(eq(metaWebhookReceipts.receiptKey, receipt.receiptKey)).limit(1);
    return { receipt: existing, created: false };
  }

  async getMetaWebhookReceipts(providerMessageId: string): Promise<MetaWebhookReceipt[]> {
    return db.select().from(metaWebhookReceipts)
      .where(eq(metaWebhookReceipts.providerMessageId, providerMessageId))
      .orderBy(metaWebhookReceipts.providerTimestamp, metaWebhookReceipts.id);
  }

  async reconcileMetaWebhookReceipts(providerMessageId: string, eventId: number): Promise<void> {
    await db.update(metaWebhookReceipts).set({ notificationEventId: eventId })
      .where(and(
        eq(metaWebhookReceipts.providerMessageId, providerMessageId),
        isNull(metaWebhookReceipts.notificationEventId),
      ));
  }

  async getWhatsappMessage(id: number): Promise<WhatsappMessage | undefined> {
    const [message] = await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.id, id))
      .limit(1);
    return message;
  }

  async updateWhatsappMessageStatusByProviderId(
    providerMessageId: string,
    status: WhatsappMessageStatus,
    providerStatus?: string | null,
    webhookPayload?: string | null,
  ): Promise<WhatsappMessage | undefined> {
    const [updated] = await db
      .update(whatsappMessages)
      .set({
        status,
        providerStatus: providerStatus ?? null,
        webhookPayload: webhookPayload ?? null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappMessages.providerMessageId, providerMessageId))
      .returning();

    return updated;
  }

  async hasData(): Promise<boolean> {
      const [barber] = await db.select().from(barbers).limit(1);
      return !!barber;
  }

  async createVerificationCode(phone: string, code: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);
    await db.insert(verificationCodes).values({
      phone,
      code,
      expiresAt,
    });
  }

  async getVerificationCode(phone: string, code: string): Promise<boolean> {
    const [result] = await db.select()
      .from(verificationCodes)
      .where(and(
        eq(verificationCodes.phone, phone),
        eq(verificationCodes.code, code),
        eq(verificationCodes.used, false),
        gte(verificationCodes.expiresAt, new Date())
      ));
    
    if (result) {
      await db.update(verificationCodes)
        .set({ used: true })
        .where(eq(verificationCodes.id, result.id));
      return true;
    }
    return false;
  }
}

type VerificationCodeRecord = {
  id: number;
  phone: string;
  code: string;
  expiresAt: Date;
  used: boolean;
};

export class MemoryStorage implements IStorage {
  private barbers: Barber[] = [];
  private services: Service[] = [];
  private appointments: Appointment[] = [];
  private appointmentSeries: AppointmentSeries[] = [];
  private admins: Admin[] = [];
  private blacklist: Blacklist[] = [];
  private shopAvailability: ShopAvailability[] = [];
  private barberAvailability: BarberAvailability[] = [];
  private barberServices: BarberService[] = [];
  private barberInvites: BarberInvite[] = [];
  private customerNotes: CustomerNote[] = [];
  private auditLogs: AuditLog[] = [];
  private barberCompensationRules: BarberCompensationRule[] = [];
  private businessExpenses: BusinessExpense[] = [];
  private whatsappMessages: WhatsappMessage[] = [];
  private appointmentNotificationEvents: AppointmentNotificationEvent[] = [];
  private metaWebhookReceipts: MetaWebhookReceipt[] = [];
  private verificationCodes: VerificationCodeRecord[] = [];

  private nextIds = {
    barber: 1,
    service: 1,
    appointment: 1,
    admin: 1,
    blacklist: 1,
    shopAvailability: 1,
    availability: 1,
    invite: 1,
    customerNote: 1,
    auditLog: 1,
    verificationCode: 1,
    barberCompensationRule: 1,
    businessExpense: 1,
    whatsappMessage: 1,
    appointmentNotificationEvent: 1,
    metaWebhookReceipt: 1,
  };

  private assertNoAppointmentConflict(
    candidate: {
      id?: number;
      barberId: number;
      startTime: Date | string;
      durationMinutes?: number | null;
      status?: string | null;
    },
    ignoreAppointmentId?: number,
  ) {
    if (!shouldProtectAppointment(candidate.status)) return;

    const startTime = toAppointmentDate(candidate.startTime);
    const endTime = getAppointmentEndTime(startTime, candidate.durationMinutes);
    const conflictingAppointment = this.appointments.find((appointment) => {
      if (appointment.status !== "booked") return false;
      if (appointment.barberId !== candidate.barberId) return false;
      if (ignoreAppointmentId !== undefined && appointment.id === ignoreAppointmentId) return false;

      const appointmentStart = toAppointmentDate(appointment.startTime);
      const appointmentEnd = getAppointmentEndTime(appointmentStart, appointment.durationMinutes);
      return startTime < appointmentEnd && endTime > appointmentStart;
    });

    if (conflictingAppointment) {
      throw new AppointmentConflictError();
    }
  }

  async getBarbers(): Promise<Barber[]> {
    return [...this.barbers].sort((a, b) => a.id - b.id);
  }

  async getBarber(id: number): Promise<Barber | undefined> {
    return this.barbers.find((barber) => barber.id === id);
  }

  async getBarberByEmail(email: string): Promise<Barber | undefined> {
    return this.barbers.find((barber) => barber.email === email);
  }

  async createBarber(barber: CreateBarberRequest): Promise<Barber> {
    if (
      barber.email &&
      this.barbers.some((existing) => existing.email?.toLowerCase() === barber.email?.toLowerCase())
    ) {
      const error = new Error("Duplicate barber email") as Error & { code?: string };
      error.code = "23505";
      throw error;
    }
    const newBarber: Barber = {
      id: this.nextIds.barber++,
      name: barber.name,
      specialty: barber.specialty,
      bio: barber.bio ?? null,
      avatar: barber.avatar ?? null,
      email: barber.email ?? null,
      password: barber.password ?? null,
      color: barber.color ?? "#D4AF37",
      isVisible: barber.isVisible ?? true,
    };
    this.barbers.push(newBarber);
    return newBarber;
  }

  async updateBarber(id: number, barber: Partial<CreateBarberRequest>): Promise<Barber | undefined> {
    const index = this.barbers.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    if (
      barber.email &&
      this.barbers.some((existing) =>
        existing.id !== id && existing.email?.toLowerCase() === barber.email?.toLowerCase(),
      )
    ) {
      const error = new Error("Duplicate barber email") as Error & { code?: string };
      error.code = "23505";
      throw error;
    }
    this.barbers[index] = { ...this.barbers[index], ...barber };
    return this.barbers[index];
  }

  async deleteBarber(id: number): Promise<"deleted" | "hidden"> {
    const now = new Date();
    if (this.appointments.some((appointment) =>
      appointment.barberId === id &&
      shouldProtectAppointment(appointment.status) &&
      new Date(appointment.startTime) >= now
    )) {
      const error = new Error("Barber has future appointments") as Error & { code?: string };
      error.code = "BARBER_HAS_FUTURE_APPOINTMENTS";
      throw error;
    }
    if (this.appointments.some((appointment) => appointment.barberId === id)) {
      this.barbers = this.barbers.map((barber) =>
        barber.id === id ? { ...barber, isVisible: false } : barber,
      );
      return "hidden";
    }
    this.barbers = this.barbers.filter((barber) => barber.id !== id);
    this.barberAvailability = this.barberAvailability.filter((row) => row.barberId !== id);
    this.barberServices = this.barberServices.filter((row) => row.barberId !== id);
    return "deleted";
  }

  async getServices(): Promise<Service[]> {
    return [...this.services].sort((a, b) => a.id - b.id);
  }

  async getService(id: number): Promise<Service | undefined> {
    return this.services.find((service) => service.id === id);
  }

  async createService(service: CreateServiceRequest): Promise<Service> {
    const newService: Service = {
      id: this.nextIds.service++,
      name: service.name,
      description: service.description ?? null,
      agendaLabel: service.agendaLabel ?? null,
      price: service.price,
      duration: service.duration,
      isVisible: service.isVisible ?? true,
    };
    this.services.push(newService);
    return newService;
  }

  async updateService(id: number, service: Partial<CreateServiceRequest>): Promise<Service | undefined> {
    const index = this.services.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    this.services[index] = { ...this.services[index], ...service };
    return this.services[index];
  }

  async deleteService(id: number): Promise<void> {
    const now = new Date();
    if (this.appointments.some((appointment) =>
      appointment.serviceId === id &&
      shouldProtectAppointment(appointment.status) &&
      new Date(appointment.startTime) >= now
    )) {
      const error = new Error("Service has future appointments") as Error & { code?: string };
      error.code = "SERVICE_HAS_FUTURE_APPOINTMENTS";
      throw error;
    }

    this.appointments = this.appointments.map((appointment) =>
      appointment.serviceId === id ? { ...appointment, serviceId: null } : appointment,
    );
    this.barberServices = this.barberServices.filter((row) => row.serviceId !== id);
    this.services = this.services.filter((service) => service.id !== id);
  }

  async getAppointments(barberId?: number, date?: string, locationId?: number): Promise<Appointment[]> {
    const bounds = date ? getShopDateBounds(date) : null;

    return this.appointments
      .filter((appointment) => barberId === undefined || appointment.barberId === barberId)
      .filter((appointment) => locationId === undefined || appointment.locationId === locationId)
      .filter((appointment) => {
        if (!bounds) return true;
        const appointmentDate = new Date(appointment.startTime);
        return appointmentDate >= bounds.start && appointmentDate < bounds.endExclusive;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  async getAppointmentsRange(barberId?: number, startDate?: string, endDate?: string, locationId?: number): Promise<Appointment[]> {
    const start = startDate ? getShopDateBounds(startDate).start : null;
    const endExclusive = endDate ? getShopDateBounds(endDate).endExclusive : null;

    return this.appointments
      .filter((appointment) => barberId === undefined || appointment.barberId === barberId)
      .filter((appointment) => locationId === undefined || appointment.locationId === locationId)
      .filter((appointment) => {
        const appointmentDate = new Date(appointment.startTime);
        return (!start || appointmentDate >= start) && (!endExclusive || appointmentDate < endExclusive);
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }

  async getAppointment(id: number): Promise<Appointment | undefined> {
    return this.appointments.find((appointment) => appointment.id === id);
  }

  async getAppointmentByToken(token: string): Promise<Appointment | undefined> {
    return this.appointments.find((appointment) => appointment.cancelToken === token);
  }

  async createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment> {
    const [createdAppointment] = await this.createAppointments([appointment]);
    return createdAppointment;
  }

  async createAppointments(appointmentInputs: CreateAppointmentStorageRequest[]): Promise<Appointment[]> {
    if (appointmentInputs.length === 0) return [];

    const originalLength = this.appointments.length;
    const originalNextId = this.nextIds.appointment;
    const originalEventLength = this.appointmentNotificationEvents.length;
    const originalNextEventId = this.nextIds.appointmentNotificationEvent;
    const createdAppointments: Appointment[] = [];

    try {
      for (const appointment of appointmentInputs) {
        const notificationRevision = appointment.notificationEventType ? 1 : 0;
        const newAppointment: Appointment = {
          id: this.nextIds.appointment++,
          locationId: appointment.locationId ?? 1,
          barberId: appointment.barberId,
          serviceId: appointment.serviceId ?? null,
          startTime: appointment.startTime,
          customerName: appointment.customerName,
          customerEmail: appointment.customerEmail ?? null,
          customerPhone: appointment.customerPhone,
          durationMinutes: appointment.durationMinutes,
          status: appointment.status ?? "booked",
          paymentMethod: appointment.paymentMethod ?? "pending",
          cancelToken: appointment.cancelToken,
          cancelledAt: null,
          depositRequired: appointment.depositRequired ?? false,
          depositReason: appointment.depositReason ?? null,
          rescheduleRevision: 0,
          notificationRevision,
          whatsappOptIn: appointment.whatsappOptIn ?? false,
          whatsappOptInAt: appointment.whatsappOptIn
            ? appointment.whatsappOptInAt ?? new Date()
            : null,
          seriesId: appointment.seriesId ?? null,
          seriesOccurrenceIndex: appointment.seriesOccurrenceIndex ?? null,
          createdAt: new Date(),
        };
        this.assertNoAppointmentConflict(newAppointment);
        this.appointments.push(newAppointment);
        if (appointment.notificationEventType) {
          const now = new Date();
          this.appointmentNotificationEvents.push({
            id: this.nextIds.appointmentNotificationEvent++,
            appointmentId: newAppointment.id,
            seriesId: null,
            eventType: appointment.notificationEventType,
            eventRevision: notificationRevision,
            eventKey: `appointment:${newAppointment.id}:confirmation:${notificationRevision}`,
            appointmentStartTime: toAppointmentDate(newAppointment.startTime),
            previousStartTime: null,
            newStartTime: toAppointmentDate(newAppointment.startTime),
            provider: null, templateName: null, whatsappStatus: "pending",
            providerMessageId: null, providerStatus: null, responseStatus: null, errorCode: null,
            processingStartedAt: null, processingCompletedAt: null, whatsappAttemptedAt: null, whatsappAcceptedAt: null,
            sentAt: null, deliveredAt: null, readAt: null, failedAt: null,
            lastProviderTimestamp: null, webhookFallbackClaimedAt: null,
            payloadSnapshot: null,
            emailStatus: "not_needed", emailProviderMessageId: null, emailErrorCode: null,
            emailAttemptedAt: null, emailSentAt: null, createdAt: now, updatedAt: now,
          });
        }
        createdAppointments.push(newAppointment);
      }
      return createdAppointments;
    } catch (error) {
      this.appointments.splice(originalLength);
      this.nextIds.appointment = originalNextId;
      this.appointmentNotificationEvents.splice(originalEventLength);
      this.nextIds.appointmentNotificationEvent = originalNextEventId;
      throw error;
    }
  }

  async createRecurringAppointmentSeries(
    request: CreateRecurringAppointmentSeriesRequest,
  ): Promise<CreateRecurringAppointmentSeriesResult> {
    validateRecurringAppointmentSeriesRequest(request);
    if (this.appointmentSeries.some((series) => series.id === request.series.id)) {
      throw new Error("Duplicate appointment series id.");
    }
    const originalAppointmentLength = this.appointments.length;
    const originalEventLength = this.appointmentNotificationEvents.length;
    const originalAppointmentId = this.nextIds.appointment;
    const originalEventId = this.nextIds.appointmentNotificationEvent;
    const now = new Date();
    const series: AppointmentSeries = {
      ...request.series, notificationRevision: 1, status: "active", createdAt: now, updatedAt: now,
    };
    try {
      const createdAppointments: Appointment[] = [];
      for (let occurrenceIndex = 0; occurrenceIndex < request.appointments.length; occurrenceIndex += 1) {
        const appointment = request.appointments[occurrenceIndex];
        const created: Appointment = {
          id: this.nextIds.appointment++, locationId: appointment.locationId ?? 1,
          barberId: appointment.barberId, serviceId: appointment.serviceId ?? null,
          startTime: appointment.startTime, customerName: appointment.customerName,
          customerEmail: appointment.customerEmail ?? null, customerPhone: appointment.customerPhone,
          durationMinutes: appointment.durationMinutes, status: appointment.status ?? "booked",
          paymentMethod: appointment.paymentMethod ?? "pending", cancelToken: appointment.cancelToken,
          cancelledAt: null, depositRequired: appointment.depositRequired ?? false,
          depositReason: appointment.depositReason ?? null, rescheduleRevision: 0, notificationRevision: 0,
          whatsappOptIn: appointment.whatsappOptIn ?? false,
          whatsappOptInAt: appointment.whatsappOptIn ? appointment.whatsappOptInAt ?? now : null,
          seriesId: series.id, seriesOccurrenceIndex: occurrenceIndex, createdAt: now,
        };
        this.assertNoAppointmentConflict(created);
        this.appointments.push(created);
        createdAppointments.push(created);
      }
      const payloadSnapshot = buildRecurringNotificationSnapshot(request, createdAppointments);
      const notificationEvent: AppointmentNotificationEvent = {
        id: this.nextIds.appointmentNotificationEvent++, appointmentId: null, seriesId: series.id,
        eventType: "appointment_recurring_confirmation", eventRevision: 1,
        eventKey: `series:${series.id}:recurring_confirmation:1`, appointmentStartTime: request.series.firstStartTime,
        previousStartTime: null, newStartTime: null, provider: null, templateName: null, whatsappStatus: "pending",
        providerMessageId: null, providerStatus: null, responseStatus: null, errorCode: null,
        processingStartedAt: null, processingCompletedAt: null, whatsappAttemptedAt: null, whatsappAcceptedAt: null,
        sentAt: null, deliveredAt: null, readAt: null, failedAt: null,
        lastProviderTimestamp: null, webhookFallbackClaimedAt: null, payloadSnapshot,
        emailStatus: "not_needed", emailProviderMessageId: null, emailErrorCode: null,
        emailAttemptedAt: null, emailSentAt: null, createdAt: now, updatedAt: now,
      };
      this.appointmentSeries.push(series);
      this.appointmentNotificationEvents.push(notificationEvent);
      return { series, appointments: createdAppointments, notificationEvent };
    } catch (error) {
      this.appointments.splice(originalAppointmentLength);
      this.appointmentNotificationEvents.splice(originalEventLength);
      this.nextIds.appointment = originalAppointmentId;
      this.nextIds.appointmentNotificationEvent = originalEventId;
      throw error;
    }
  }

  async getAppointmentSeries(id: string): Promise<AppointmentSeries | undefined> {
    return this.appointmentSeries.find((series) => series.id === id);
  }

  async getAppointmentSeriesAppointments(id: string): Promise<Appointment[]> {
    return this.appointments.filter((appointment) => appointment.seriesId === id)
      .sort((left, right) => (left.seriesOccurrenceIndex ?? 0) - (right.seriesOccurrenceIndex ?? 0));
  }

  async updateAppointment(
    id: number,
    appointment: Partial<Omit<Appointment, "id">>,
    expectedStatus?: AppointmentStatus,
  ): Promise<Appointment | undefined> {
    const index = this.appointments.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    if (expectedStatus && this.appointments[index].status !== expectedStatus) return undefined;
    const current = this.appointments[index];
    const updatedAppointment = { ...current, ...appointment };
    this.assertNoAppointmentConflict(updatedAppointment, id);
    this.appointments[index] = updatedAppointment;
    if (current.seriesId) {
      const series = this.appointmentSeries.find((item) => item.id === current.seriesId);
      if (series) { series.notificationRevision += 1; series.updatedAt = new Date(); }
    }
    return this.appointments[index];
  }

  async rescheduleAppointment(
    id: number,
    expectedRevision: number,
    startTime: Date,
  ): Promise<RescheduleAppointmentResult | undefined> {
    const index = this.appointments.findIndex((appointment) => appointment.id === id);
    if (index === -1) return undefined;
    const current = this.appointments[index];
    if (current.status !== "booked" || current.rescheduleRevision !== expectedRevision) return undefined;

    const updated: Appointment = {
      ...current,
      startTime,
      rescheduleRevision: current.rescheduleRevision + 1,
      notificationRevision: current.notificationRevision + 1,
    };
    this.assertNoAppointmentConflict(updated, id);
    this.appointments[index] = updated;
    if (current.seriesId) {
      const series = this.appointmentSeries.find((item) => item.id === current.seriesId);
      if (series) { series.notificationRevision += 1; series.updatedAt = new Date(); }
    }

    const now = new Date();
    const notificationEvent: AppointmentNotificationEvent = {
      id: this.nextIds.appointmentNotificationEvent++,
      appointmentId: id,
      seriesId: null,
      eventType: "appointment_rescheduled",
      eventRevision: updated.notificationRevision,
      eventKey: `appointment:${id}:rescheduled:${updated.notificationRevision}`,
      appointmentStartTime: startTime,
      previousStartTime: toAppointmentDate(current.startTime),
      newStartTime: startTime,
      provider: null,
      templateName: null,
      whatsappStatus: "pending",
      providerMessageId: null,
      providerStatus: null,
      responseStatus: null,
      errorCode: null,
      processingStartedAt: null,
      processingCompletedAt: null,
      whatsappAttemptedAt: null,
      whatsappAcceptedAt: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      lastProviderTimestamp: null,
      webhookFallbackClaimedAt: null,
      payloadSnapshot: null,
      emailStatus: "not_needed",
      emailProviderMessageId: null,
      emailErrorCode: null,
      emailAttemptedAt: null,
      emailSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.appointmentNotificationEvents.push(notificationEvent);
    return { appointment: updated, notificationEvent };
  }

  async cancelAppointment(
    id: number,
    expectedStatus: "booked",
    status: "cancelled" | "late_cancelled",
  ): Promise<CancelAppointmentResult | undefined> {
    const index = this.appointments.findIndex((appointment) => appointment.id === id);
    if (index === -1 || this.appointments[index].status !== expectedStatus) return undefined;
    const current = this.appointments[index];
    const now = new Date();
    const revision = current.notificationRevision + 1;
    const updated: Appointment = {
      ...current, status, cancelledAt: now, paymentMethod: "pending", notificationRevision: revision,
    };
    this.appointments[index] = updated;
    if (current.seriesId) {
      const series = this.appointmentSeries.find((item) => item.id === current.seriesId);
      if (series) { series.notificationRevision += 1; series.updatedAt = now; }
    }
    const notificationEvent: AppointmentNotificationEvent = {
      id: this.nextIds.appointmentNotificationEvent++, appointmentId: id, seriesId: null,
      eventType: "appointment_cancelled", eventRevision: revision,
      eventKey: `appointment:${id}:cancelled:${revision}`,
      appointmentStartTime: toAppointmentDate(current.startTime),
      previousStartTime: toAppointmentDate(current.startTime), newStartTime: null,
      provider: null, templateName: null, whatsappStatus: "pending",
      providerMessageId: null, providerStatus: null, responseStatus: null, errorCode: null,
      processingStartedAt: null, processingCompletedAt: null, whatsappAttemptedAt: null, whatsappAcceptedAt: null,
      sentAt: null, deliveredAt: null, readAt: null, failedAt: null,
      lastProviderTimestamp: null, webhookFallbackClaimedAt: null,
      payloadSnapshot: null,
      emailStatus: "not_needed", emailProviderMessageId: null, emailErrorCode: null,
      emailAttemptedAt: null, emailSentAt: null, createdAt: now, updatedAt: now,
    };
    this.appointmentNotificationEvents.push(notificationEvent);
    return { appointment: updated, notificationEvent };
  }

  async updateAppointmentStatus(
    id: number,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined> {
    const patch: Partial<Omit<Appointment, "id">> = {
      status,
      paymentMethod: status === "completed" ? (paymentMethod || "pending") : "pending",
      notificationRevision: (this.appointments.find((appointment) => appointment.id === id)?.notificationRevision || 0) + 1,
    };
    if (status === "cancelled" || status === "late_cancelled") {
      patch.cancelledAt = new Date();
    }
    if (status === "booked" || status === "completed") {
      patch.cancelledAt = null;
    }
    return this.updateAppointment(id, patch);
  }

  async updateAppointmentStatusIfCurrent(
    id: number,
    currentStatus: AppointmentStatus,
    status: AppointmentStatus,
    paymentMethod?: AppointmentPaymentMethod,
  ): Promise<Appointment | undefined> {
    const current = this.appointments.find((appointment) => appointment.id === id);
    if (!current || current.status !== currentStatus) return undefined;
    return this.updateAppointmentStatus(id, status, paymentMethod);
  }

  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    return this.admins.find((admin) => admin.username === username);
  }

  async createAdmin(admin: CreateAdminRequest): Promise<Admin> {
    if (this.admins.some((existing) => existing.username.toLowerCase() === admin.username.toLowerCase())) {
      const error = new Error("Duplicate admin username") as Error & { code?: string };
      error.code = "23505";
      throw error;
    }
    const newAdmin: Admin = {
      id: this.nextIds.admin++,
      username: admin.username,
      email: admin.email ?? null,
      password: admin.password,
    };
    this.admins.push(newAdmin);
    return newAdmin;
  }

  async updateAdminPassword(id: number, password: string): Promise<void> {
    const admin = this.admins.find((candidate) => candidate.id === id);
    if (admin) admin.password = password;
  }

  async getBlacklist(): Promise<Blacklist[]> {
    return [...this.blacklist].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  async addToBlacklist(data: InsertBlacklist): Promise<Blacklist> {
    const entry: Blacklist = {
      id: this.nextIds.blacklist++,
      phone: data.phone,
      email: data.email ?? null,
      reason: data.reason ?? null,
      createdAt: new Date(),
    };
    this.blacklist.push(entry);
    return entry;
  }

  async removeFromBlacklist(id: number): Promise<void> {
    this.blacklist = this.blacklist.filter((entry) => entry.id !== id);
  }

  async isBlacklisted(email?: string, phone?: string): Promise<boolean> {
    const hasPhone = Boolean(phone?.replace(/\D/g, ""));
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail && !hasPhone) return false;

    return this.blacklist.some((entry) =>
      (hasPhone && supportedPhonesMatch(entry.phone, phone)) ||
      (normalizedEmail && normalizeEmail(entry.email) === normalizedEmail),
    );
  }

  async getShopAvailability(locationId?: number): Promise<ShopAvailability[]> {
    return this.shopAvailability.filter((row) => locationId === undefined || row.locationId === locationId).sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  }

  async replaceShopAvailability(rows: CreateShopAvailabilityRequest[], locationId = 1): Promise<ShopAvailability[]> {
    this.shopAvailability = this.shopAvailability.filter((row) => row.locationId !== locationId);
    const createdRows = rows.map((row) => ({
      id: this.nextIds.shopAvailability++,
      locationId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      isOpen: row.isOpen ?? true,
    }));
    this.shopAvailability.push(...createdRows);
    return createdRows;
  }

  async getBarberAvailability(barberId: number, locationId?: number): Promise<BarberAvailability[]> {
    return this.barberAvailability
      .filter((row) => row.barberId === barberId)
      .filter((row) => locationId === undefined || row.locationId === locationId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  }

  async getAllBarberAvailability(locationId?: number): Promise<BarberAvailability[]> {
    return this.barberAvailability.filter((row) => locationId === undefined || row.locationId === locationId).sort(
      (a, b) => a.barberId - b.barberId || a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  }

  async replaceBarberAvailability(
    barberId: number,
    rows: Omit<CreateBarberAvailabilityRequest, "barberId">[],
    locationId = 1,
  ): Promise<BarberAvailability[]> {
    this.barberAvailability = this.barberAvailability.filter((row) => row.barberId !== barberId || row.locationId !== locationId);
    const createdRows = rows.map((row) => ({
      id: this.nextIds.availability++,
      locationId,
      barberId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      isWorking: row.isWorking ?? true,
    }));
    this.barberAvailability.push(...createdRows);
    return createdRows;
  }

  async getAllBarberServices(): Promise<BarberService[]> {
    return [...this.barberServices].sort(
      (a, b) => a.barberId - b.barberId || a.serviceId - b.serviceId,
    );
  }

  async getBarberServiceIds(barberId: number): Promise<number[]> {
    return this.barberServices
      .filter((row) => row.barberId === barberId)
      .map((row) => row.serviceId)
      .sort((a, b) => a - b);
  }

  async replaceBarberServices(barberId: number, serviceIds: number[]): Promise<BarberService[]> {
    this.barberServices = this.barberServices.filter((row) => row.barberId !== barberId);
    const createdRows = Array.from(new Set(serviceIds)).map((serviceId) => ({ barberId, serviceId }));
    this.barberServices.push(...createdRows);
    return createdRows;
  }

  async createBarberInvite(invite: CreateBarberInviteRequest): Promise<BarberInvite> {
    const newInvite: BarberInvite = {
      id: this.nextIds.invite++,
      barberId: invite.barberId,
      token: invite.token,
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt ?? null,
      createdAt: new Date(),
    };
    this.barberInvites.push(newInvite);
    return newInvite;
  }

  async createBarberInviteReplacingActive(invite: CreateBarberInviteRequest): Promise<BarberInvite> {
    await this.invalidateBarberInvites(invite.barberId);
    return this.createBarberInvite(invite);
  }

  async getBarberInviteByToken(token: string): Promise<BarberInvite | undefined> {
    return this.barberInvites.find((invite) => invite.token === token);
  }

  async markBarberInviteUsed(id: number): Promise<BarberInvite | undefined> {
    const index = this.barberInvites.findIndex((invite) => invite.id === id);
    if (index === -1) return undefined;
    this.barberInvites[index] = { ...this.barberInvites[index], usedAt: new Date() };
    return this.barberInvites[index];
  }

  async invalidateBarberInvites(barberId: number): Promise<void> {
    const now = new Date();
    this.barberInvites = this.barberInvites.map((invite) =>
      invite.barberId === barberId && !invite.usedAt ? { ...invite, usedAt: now } : invite,
    );
  }

  async acceptBarberInvite(inviteId: number, barberId: number, password: string): Promise<Barber | undefined> {
    const inviteIndex = this.barberInvites.findIndex((invite) =>
      invite.id === inviteId &&
      invite.barberId === barberId &&
      !invite.usedAt &&
      invite.expiresAt > new Date(),
    );
    const barberIndex = this.barbers.findIndex((barber) => barber.id === barberId);
    if (inviteIndex === -1 || barberIndex === -1) return undefined;

    this.barberInvites[inviteIndex] = { ...this.barberInvites[inviteIndex], usedAt: new Date() };
    this.barbers[barberIndex] = { ...this.barbers[barberIndex], password };
    return this.barbers[barberIndex];
  }

  async getCustomerNoteByIdentity(phone: string, customerNameKey: string): Promise<CustomerNote | undefined> {
    return this.customerNotes.find((note) => note.phone === phone && note.customerNameKey === customerNameKey);
  }

  async upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote> {
    const now = new Date();
    const customerNameKey = note.customerNameKey || "";
    const existingIndex = this.customerNotes.findIndex((item) =>
      item.phone === note.phone && item.customerNameKey === customerNameKey,
    );
    if (existingIndex !== -1) {
      this.customerNotes[existingIndex] = {
        ...this.customerNotes[existingIndex],
        email: note.email || null,
        notes: note.notes || "",
        updatedAt: now,
      };
      return this.customerNotes[existingIndex];
    }

    const savedNote: CustomerNote = {
      id: this.nextIds.customerNote++,
      phone: note.phone,
      customerNameKey,
      email: note.email || null,
      notes: note.notes || "",
      createdAt: now,
      updatedAt: now,
    };
    this.customerNotes.push(savedNote);
    return savedNote;
  }

  async getAuditLogs(limit = 50): Promise<AuditLog[]> {
    return [...this.auditLogs]
      .sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id,
      )
      .slice(0, limit);
  }

  async createAuditLog(log: CreateAuditLogRequest): Promise<AuditLog> {
    const entry: AuditLog = {
      id: this.nextIds.auditLog++,
      actorType: log.actorType,
      actorId: log.actorId ?? null,
      actorName: log.actorName ?? null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId ?? null,
      summary: log.summary,
      metadata: log.metadata ?? null,
      createdAt: new Date(),
    };
    this.auditLogs.push(entry);
    return entry;
  }

  async getBarberCompensationRules(barberId?: number): Promise<BarberCompensationRule[]> {
    return this.barberCompensationRules
      .filter((rule) => barberId === undefined || rule.barberId === barberId)
      .sort((a, b) =>
        a.barberId - b.barberId ||
        new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime() ||
        b.id - a.id,
      );
  }

  async createBarberCompensationRule(rule: CreateBarberCompensationRuleRequest): Promise<BarberCompensationRule> {
    const created: BarberCompensationRule = {
      id: this.nextIds.barberCompensationRule++,
      barberId: rule.barberId,
      model: rule.model ?? "none",
      commissionPercent: rule.commissionPercent ?? null,
      chairRentCents: rule.chairRentCents ?? null,
      chairRentPeriod: rule.chairRentPeriod ?? null,
      effectiveFrom: rule.effectiveFrom,
      createdAt: new Date(),
    };
    this.barberCompensationRules.push(created);
    return created;
  }

  async getBusinessExpenses(filters: {
    startDate?: string;
    endDate?: string;
    category?: string;
    locationId?: number;
  } = {}): Promise<BusinessExpense[]> {
    const start = filters.startDate ? getShopDateBounds(filters.startDate).start : undefined;
    const endExclusive = filters.endDate ? getShopDateBounds(filters.endDate).endExclusive : undefined;

    return this.businessExpenses
      .filter((expense) => {
        if (filters.locationId !== undefined && expense.locationId !== filters.locationId) return false;
        const expenseDate = new Date(expense.expenseDate);
        if (start && expenseDate < start) return false;
        if (endExclusive && expenseDate >= endExclusive) return false;
        if (filters.category && filters.category !== "all" && expense.category !== filters.category) return false;
        return true;
      })
      .sort((a, b) =>
        new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime() || b.id - a.id,
      );
  }

  async createBusinessExpense(expense: CreateBusinessExpenseRequest): Promise<BusinessExpense> {
    const now = new Date();
    const created: BusinessExpense = {
      id: this.nextIds.businessExpense++,
      locationId: expense.locationId ?? 1,
      category: expense.category,
      description: expense.description,
      amountCents: expense.amountCents,
      expenseDate: expense.expenseDate,
      recurrence: expense.recurrence ?? "once",
      notes: expense.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.businessExpenses.push(created);
    return created;
  }

  async updateBusinessExpense(id: number, expense: Partial<CreateBusinessExpenseRequest>): Promise<BusinessExpense | undefined> {
    const index = this.businessExpenses.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    this.businessExpenses[index] = {
      ...this.businessExpenses[index],
      ...expense,
      updatedAt: new Date(),
    };
    return this.businessExpenses[index];
  }

  async deleteBusinessExpense(id: number): Promise<void> {
    this.businessExpenses = this.businessExpenses.filter((expense) => expense.id !== id);
  }

  async createWhatsappMessage(message: CreateWhatsappMessageRequest): Promise<WhatsappMessage> {
    const now = new Date();
    const created: WhatsappMessage = {
      id: this.nextIds.whatsappMessage++,
      appointmentId: message.appointmentId ?? null,
      messageType: message.messageType,
      phone: message.phone,
      providerMessageId: message.providerMessageId ?? null,
      status: message.status ?? "pending",
      providerStatus: message.providerStatus ?? null,
      responseStatus: message.responseStatus ?? null,
      responseBody: message.responseBody ?? null,
      webhookPayload: message.webhookPayload ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.whatsappMessages.push(created);
    return created;
  }

  async getAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined> {
    return this.appointmentNotificationEvents.find((event) => event.id === id);
  }

  async getAppointmentNotificationEvents(appointmentId: number): Promise<AppointmentNotificationEvent[]> {
    return this.appointmentNotificationEvents.filter((event) => event.appointmentId === appointmentId)
      .sort((a, b) => a.eventRevision - b.eventRevision || a.id - b.id);
  }

  async getAppointmentNotificationEventByProviderId(providerMessageId: string): Promise<AppointmentNotificationEvent | undefined> {
    return this.appointmentNotificationEvents.find((event) => event.providerMessageId === providerMessageId);
  }

  async claimAppointmentNotificationEvent(id: number): Promise<AppointmentNotificationEvent | undefined> {
    const index = this.appointmentNotificationEvents.findIndex((event) => event.id === id);
    if (index === -1 || this.appointmentNotificationEvents[index].processingStartedAt) return undefined;
    const now = new Date();
    this.appointmentNotificationEvents[index] = {
      ...this.appointmentNotificationEvents[index],
      processingStartedAt: now,
      updatedAt: now,
    };
    return this.appointmentNotificationEvents[index];
  }

  async claimNextAppointmentNotificationEvent(leaseBefore: Date, includeUnattemptedWhatsappOptIn = true): Promise<AppointmentNotificationEvent | undefined> {
    const event = this.appointmentNotificationEvents.find((candidate) =>
      !candidate.processingCompletedAt
      && (!candidate.processingStartedAt || candidate.processingStartedAt < leaseBefore)
      && (candidate.seriesId !== null || includeUnattemptedWhatsappOptIn
        || !this.appointments.find((appointment) => appointment.id === candidate.appointmentId)?.whatsappOptIn
        || candidate.whatsappAttemptedAt !== null));
    if (!event) return undefined;
    event.processingStartedAt = new Date();
    event.updatedAt = new Date();
    return event;
  }

  async claimAppointmentNotificationWhatsappAttempt(id: number): Promise<AppointmentNotificationEvent | undefined> {
    const event = this.appointmentNotificationEvents.find((candidate) => candidate.id === id);
    if (!event || event.whatsappAttemptedAt) return undefined;
    event.whatsappAttemptedAt = new Date();
    event.updatedAt = new Date();
    return event;
  }

  async updateAppointmentNotificationEvent(
    id: number,
    patch: Partial<Omit<AppointmentNotificationEvent, "id" | "appointmentId" | "seriesId" | "eventKey" | "eventType" | "eventRevision" | "createdAt">>,
  ): Promise<AppointmentNotificationEvent | undefined> {
    const index = this.appointmentNotificationEvents.findIndex((event) => event.id === id);
    if (index === -1) return undefined;
    this.appointmentNotificationEvents[index] = {
      ...this.appointmentNotificationEvents[index],
      ...patch,
      updatedAt: new Date(),
    };
    return this.appointmentNotificationEvents[index];
  }

  async createMetaWebhookReceipt(receipt: CreateMetaWebhookReceiptRequest): Promise<{ receipt: MetaWebhookReceipt; created: boolean }> {
    const existing = this.metaWebhookReceipts.find((item) => item.receiptKey === receipt.receiptKey);
    if (existing) return { receipt: existing, created: false };
    const created: MetaWebhookReceipt = {
      ...receipt, id: this.nextIds.metaWebhookReceipt++, notificationEventId: receipt.notificationEventId ?? null, createdAt: new Date(),
    };
    this.metaWebhookReceipts.push(created);
    return { receipt: created, created: true };
  }

  async getMetaWebhookReceipts(providerMessageId: string): Promise<MetaWebhookReceipt[]> {
    return this.metaWebhookReceipts.filter((receipt) => receipt.providerMessageId === providerMessageId)
      .sort((a, b) => (a.providerTimestamp?.getTime() || 0) - (b.providerTimestamp?.getTime() || 0) || a.id - b.id);
  }

  async reconcileMetaWebhookReceipts(providerMessageId: string, eventId: number): Promise<void> {
    for (const receipt of this.metaWebhookReceipts) {
      if (receipt.providerMessageId === providerMessageId && receipt.notificationEventId === null) {
        receipt.notificationEventId = eventId;
      }
    }
  }

  async getWhatsappMessage(id: number): Promise<WhatsappMessage | undefined> {
    return this.whatsappMessages.find((message) => message.id === id);
  }

  async updateWhatsappMessageStatusByProviderId(
    providerMessageId: string,
    status: WhatsappMessageStatus,
    providerStatus?: string | null,
    webhookPayload?: string | null,
  ): Promise<WhatsappMessage | undefined> {
    const index = this.whatsappMessages.findIndex((message) => message.providerMessageId === providerMessageId);
    if (index === -1) return undefined;
    this.whatsappMessages[index] = {
      ...this.whatsappMessages[index],
      status,
      providerStatus: providerStatus ?? null,
      webhookPayload: webhookPayload ?? null,
      updatedAt: new Date(),
    };
    return this.whatsappMessages[index];
  }

  async createVerificationCode(phone: string, code: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);
    this.verificationCodes.push({
      id: this.nextIds.verificationCode++,
      phone,
      code,
      expiresAt,
      used: false,
    });
  }

  async getVerificationCode(phone: string, code: string): Promise<boolean> {
    const verificationCode = this.verificationCodes.find((item) =>
      item.phone === phone && item.code === code && !item.used && item.expiresAt >= new Date(),
    );
    if (!verificationCode) return false;
    verificationCode.used = true;
    return true;
  }

  async hasData(): Promise<boolean> {
    return this.barbers.length > 0;
  }
}

export const storage: IStorage =
  process.env.USE_MEMORY_STORAGE === "true"
    ? new MemoryStorage()
    : new DatabaseStorage();
