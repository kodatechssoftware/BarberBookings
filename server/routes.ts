import type { Express } from "express";
import type { Server } from "http";
import type { NextFunction, Request, Response } from "express";
import { storage } from "./storage";
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
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { parseISO, format, isValid, startOfDay, endOfDay } from "date-fns";
import ExcelJS from 'exceljs';
import { appointmentStatuses, type Appointment } from "@shared/schema";

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

const weekdays: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const appointmentStatusSet = new Set<string>(appointmentStatuses);

type AppSession = session.Session & Partial<session.SessionData> & {
  adminId?: number;
  barberId?: number;
  role?: "admin" | "barber";
};

const customerNotesInputSchema = z.object({
  email: z.string().email().or(z.literal("")).optional(),
  notes: z.string().max(1200, "As notas não podem ter mais de 1200 caracteres."),
});

function getAppSession(req: Request) {
  return req.session as AppSession;
}

function getSessionSameSite(): "lax" | "strict" | "none" {
  const value = (process.env.SESSION_SAME_SITE || "lax").toLowerCase();

  if (value === "strict" || value === "none") {
    return value;
  }

  return "lax";
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
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
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
  return (value || "").replace(/\D/g, "");
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

  if (whatsappSent || !params.customerEmail) return;

  await sendBookingConfirmation({
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

  if (whatsappSent || !params.customerEmail) return;

  await sendBookingCancellationConfirmation({
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    barberName: params.barberName || "Barbeiro indisponível",
    serviceName: params.serviceName,
    startTime: params.startTime,
    lateCancellation: params.lateCancellation,
    cancellationPolicyHours: CANCELLATION_POLICY_HOURS,
  });
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

function getAppointmentEndTime(
  appointment: AppointmentLike,
  serviceDurations: Map<number, number>,
) {
  const startTime = toDate(appointment.startTime);
  const durationMinutes = appointment.durationMinutes ??
    getAppointmentDurationMinutes(appointment.serviceId, serviceDurations);
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

function getServicePriceCents(serviceId: number | null, servicePrices: Map<number, number>) {
  return serviceId ? servicePrices.get(serviceId) ?? 0 : 0;
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
  return phone || email;
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
    sessionConfig.store = new PostgresSessionStore({
      conObject: { connectionString: process.env.DATABASE_URL },
      schemaName: sessionSchemaName,
      createTableIfMissing: true,
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
        appSession.role = "admin";
        return res.json({ message: "Login efetuado com sucesso", role: "admin" });
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
          appSession.role = "barber";
          return res.json({ message: "Login efetuado com sucesso", role: "barber" });
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

  // === BARBERS MGMT ===
  app.post("/api/barbers", requireAdmin, async (req, res) => {
    try {
      const input = api.barbers.create.input.parse(req.body);
      const barber = await storage.createBarber(input);
      res.status(201).json(barber);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: error.errors[0].message,
          field: error.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "Erro ao criar barbeiro" });
    }
  });

  app.patch("/api/barbers/:id", requireAdmin, async (req, res) => {
    try {
      const barber = await storage.updateBarber(Number(req.params.id), req.body);
      if (!barber) return res.status(404).json({ message: "Barbeiro não encontrado" });
      res.json(barber);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar barbeiro" });
    }
  });

  app.delete("/api/barbers/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteBarber(Number(req.params.id));
      res.json({ message: "Barbeiro removido" });
    } catch (error: any) {
      if (error?.code === "23503") {
        return res.status(409).json({ message: "Não é possível remover um barbeiro com marcações associadas." });
      }
      res.status(500).json({ message: "Erro ao remover barbeiro" });
    }
  });

  app.patch("/api/barbers/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateBarber(Number(req.params.id), { password: null });
      if (!updated) return res.status(404).json({ message: "Barbeiro não encontrado" });
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
      const input = api.services.create.input.parse(req.body);
      const service = await storage.createService(input);
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
      const service = await storage.updateService(Number(req.params.id), req.body);
      if (!service) return res.status(404).json({ message: "Serviço não encontrado" });
      res.json(service);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar serviço" });
    }
  });

  app.delete("/api/services/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteService(Number(req.params.id));
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
    const barbers = await storage.getBarbers();
    const appSession = getAppSession(req);
    const includeHidden = req.query.includeHidden === "true" &&
      Boolean(appSession.adminId || appSession.barberId);

    res.json(includeHidden ? barbers : barbers.filter((barber) => barber.isVisible));
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
    res.json(availability);
  });

  app.get(api.barbers.get.path, async (req, res) => {
    const barber = await storage.getBarber(Number(req.params.id));
    if (!barber) {
      return res.status(404).json({ message: "Barbeiro não encontrado" });
    }
    res.json(barber);
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
      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const requestedDuration = getAppointmentDurationMinutes(input.serviceId, serviceDurations);
      const requestedEndTime = new Date(input.startTime.getTime() + requestedDuration * 60000);
      const dateStr = getShopDateParts(input.startTime).dateKey;
      const previousAppointments = await storage.getAppointments();
      const depositRecommendation = getDepositRecommendation({
        previousAppointments,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        serviceDurationMinutes: requestedDuration,
      });

      // Check for blacklist
      const isBlacklisted = await storage.isBlacklisted(input.customerEmail || undefined, input.customerPhone);
      if (isBlacklisted) {
        return res.status(403).json({ message: "Não é possível realizar a marcação online. Por favor, contacte a barbearia." });
      }



      const cancelToken = randomUUID();
      
      // Handle "Any Barber" selection
      let finalBarberId = input.barberId;
      if (finalBarberId === 0) {
        const barbers = await storage.getBarbers();
        const existingAppointments = await storage.getAppointments(undefined, dateStr);
        
        const visibleBarbers = barbers.filter((barber) => barber.isVisible);
        let availableBarber: (typeof visibleBarbers)[number] | null = null;

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
            availableBarber = barber;
            break;
          }
        }

        if (!availableBarber) {
          return res.status(409).json({ message: "Nenhum barbeiro disponível para este horário." });
        }
        finalBarberId = availableBarber.id;
      } else {
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
        cancelToken,
        durationMinutes: requestedDuration,
        depositRequired: depositRecommendation.required,
        depositReason: depositRecommendation.reason,
      });

      const barber = await storage.getBarber(finalBarberId);
      const service = services.find(s => s.id === input.serviceId);

      sendBookingCreatedNotification({
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        barberName: barber?.name,
        serviceName: service?.name || "Serviço indisponível",
        startTime: input.startTime,
        cancelToken,
        durationMinutes: appointment.durationMinutes,
        depositRequired: appointment.depositRequired,
        depositReason: appointment.depositReason,
      }).catch(console.error);

      res.status(201).json(appointment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.post("/api/appointments/block", requireAdmin, async (req, res) => {
    try {
      const { barberId, startTime, name, phone, serviceId, isManualBooking, isRecurring, recurringWeeks, recurringMonths } = req.body;
      const start = new Date(startTime);
      const appointments: Array<Parameters<typeof storage.createAppointment>[0]> = [];
      const conflicts = [];
      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const duration = serviceId
        ? getAppointmentDurationMinutes(Number(serviceId), serviceDurations)
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;
      const depositRecommendation = isManualBooking
        ? getDepositRecommendation({
            previousAppointments: await storage.getAppointments(),
            customerPhone: phone,
            customerEmail: null,
            serviceDurationMinutes: duration,
          })
        : { required: false, reason: null };

      // Determine how many occurrences
      const occurrences = (isRecurring && recurringWeeks && recurringMonths) 
        ? Math.floor((Number(recurringMonths) * 4.33) / Number(recurringWeeks)) 
        : 1;

      for (let i = 0; i < occurrences; i++) {
        const currentStart = new Date(start);
        currentStart.setDate(start.getDate() + (i * Number(recurringWeeks || 0) * 7));
        const currentEnd = new Date(currentStart.getTime() + duration * 60000);
        const workingPeriods = await getBarberWorkingPeriods(Number(barberId), getShopDateParts(currentStart).weekday);
        const scheduleError = getScheduleValidationError(currentStart, duration, workingPeriods);
        if (scheduleError) {
          return res.status(400).json({ message: scheduleError });
        }

        const existingAppointments = await storage.getAppointments(
          Number(barberId),
          getShopDateParts(currentStart).dateKey,
        );

        if (
          hasAppointmentConflict(
            existingAppointments,
            Number(barberId),
            currentStart,
            currentEnd,
            serviceDurations,
          )
        ) {
          conflicts.push(format(currentStart, "dd/MM/yyyy HH:mm"));
          continue;
        }

        appointments.push({
          barberId: Number(barberId),
          serviceId: serviceId ? Number(serviceId) : null,
          startTime: currentStart,
          customerName: isManualBooking ? name : (occurrences > 1 ? `RECORRENTE: ${name}` : (name || "BLOQUEIO MANUAL")),
          customerPhone: phone || "",
          customerEmail: "",
          durationMinutes: duration,
          status: "booked",
          cancelToken: randomUUID(),
          depositRequired: depositRecommendation.required,
          depositReason: depositRecommendation.reason,
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

      for (const app of appointments) {
        await storage.createAppointment(app);
      }

      res.status(201).json({ message: `${appointments.length} marcações criadas.` });
    } catch (error) {
      console.error("Block error:", error);
      res.status(500).json({ message: "Erro ao bloquear horário" });
    }
  });

  app.get("/api/appointments/public", async (req, res) => {
    const barberId = req.query.barberId ? Number(req.query.barberId) : undefined;
    const date = req.query.date as string | undefined;
    const effectiveBarberId = barberId === 0 ? undefined : barberId;
    const appointments = await storage.getAppointments(effectiveBarberId, date);
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
        duration: app.durationMinutes ?? getAppointmentDurationMinutes(app.serviceId, serviceDurations),
      }));
    res.json(publicAppointments);
  });
  
  app.patch("/api/appointments/:id", requireAdmin, async (req, res) => {
    try {
      const { startTime, barberId, status } = req.body;
      const appointmentId = Number(req.params.id);
      const currentApp = await storage.getAppointment(appointmentId);

      if (!currentApp) return res.status(404).json({ message: "Marcação não encontrada" });

      const newStartTime = startTime ? new Date(startTime) : new Date(currentApp.startTime);
      const newBarberId = barberId ? Number(barberId) : currentApp.barberId;
      const serviceDurations = new Map(
        (await storage.getServices()).map((service) => [service.id, service.duration]),
      );

      // Conflict check for re-scheduling
      if (startTime || barberId) {
        const duration = currentApp.durationMinutes ?? getAppointmentDurationMinutes(currentApp.serviceId, serviceDurations);
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
      if (status) {
        if (!isKnownAppointmentStatus(status)) {
          return res.status(400).json({ message: "Estado de marcação inválido." });
        }
        Object.assign(updateData, getStatusPatch(status));
      }

      const updated = await storage.updateAppointment(appointmentId, updateData);

      res.json(updated);
    } catch (error) {
      console.error("Update appointment error:", error);
      res.status(500).json({ message: "Erro ao atualizar marcação" });
    }
  });

  app.patch(api.appointments.updateStatus.path, requireAuth, async (req, res) => {
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
     res.json(updated);
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
      duration: appointment.durationMinutes ?? service?.duration ?? DEFAULT_APPOINTMENT_DURATION_MINUTES,
      price: service?.price || 0,
    });
  });

  app.post("/api/appointments/reschedule/:token", async (req, res) => {
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

    const services = await storage.getServices();
    const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
    const duration = appointment.durationMinutes ?? getAppointmentDurationMinutes(appointment.serviceId, serviceDurations);
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

    const updated = await storage.updateAppointment(appointment.id, { startTime });

    res.json(updated);
  });

  app.post('/api/appointments/cancel/:token', async (req, res) => {
    const appointment = await storage.getAppointmentByToken(req.params.token);
    if (!appointment) {
      return res.status(404).json({ message: "Marcação não encontrada" });
    }
    
    if (appointment.status !== 'booked') {
      return res.status(409).json({ message: "Esta marcação já não pode ser cancelada." });
    }

    const lateCancellation = isLateCancellation(appointment.startTime);
    const status = lateCancellation ? "late_cancelled" : "cancelled";
    await storage.updateAppointmentStatus(appointment.id, status);

    const [barber, service] = await Promise.all([
      storage.getBarber(appointment.barberId),
      appointment.serviceId ? storage.getService(appointment.serviceId) : Promise.resolve(undefined),
    ]);
    sendBookingCancelledNotification({
      customerName: appointment.customerName,
      customerEmail: appointment.customerEmail,
      customerPhone: appointment.customerPhone,
      barberName: barber?.name,
      serviceName: service?.name || "Serviço indisponível",
      startTime: toDate(appointment.startTime),
      lateCancellation,
    }).catch(console.error);

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
      const entry = await storage.addToBlacklist(req.body);
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ message: "Erro ao adicionar à lista de bloqueio" });
    }
  });

  const removeBlacklistEntry = async (req: Request, res: Response) => {
    await storage.removeFromBlacklist(Number(req.params.id));
    res.json({ message: "Removido da lista de bloqueio" });
  };

  app.post("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);
  app.delete("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);

  const canManageCustomer = async (req: Request, phone: string, email?: string) => {
    const appSession = getAppSession(req);
    if (appSession.role === "admin") return true;
    if (appSession.role !== "barber" || !appSession.barberId) return false;

    const barberAppointments = await storage.getAppointments(Number(appSession.barberId));
    return barberAppointments.some((appointment) => {
      const samePhone = phone && normalizePhone(appointment.customerPhone) === phone;
      const sameEmail = email && appointment.customerEmail?.toLowerCase() === email;
      return samePhone || sameEmail;
    });
  };

  app.get("/api/admin/customers/:phone/history", requireAuth, async (req, res) => {
    const phone = normalizePhone(req.params.phone);
    const email = String(req.query.email || "").trim().toLowerCase();
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
      .filter((appointment) => {
        const samePhone = phone && normalizePhone(appointment.customerPhone) === phone;
        const sameEmail = email && appointment.customerEmail?.toLowerCase() === email;
        return samePhone || sameEmail;
      })
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
      ? await storage.getCustomerNoteByPhone(phone)
      : undefined;

    res.json({
      customer: {
        name: matchingAppointments[0]?.customerName || "",
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
        depositRecommended: metrics.noShows + metrics.lateCancelled >= DEPOSIT_RISK_THRESHOLD,
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
    if (!(await canManageCustomer(req, phone, email))) {
      return res.status(403).json({ message: "Não autorizado" });
    }

    const note = await storage.upsertCustomerNote({
      phone,
      email: email || undefined,
      notes: parsed.data.notes.trim(),
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

    try {
      const allBarbers = await storage.getBarbers();
      const allServices = await storage.getServices();
      const allAppointments = await storage.getAppointments(
        barberId && barberId !== "all" ? Number(barberId) : undefined
      );

      const filteredAppointments = allAppointments.filter(app => {
        const appDate = new Date(app.startTime);
        const isPastOrToday = appDate <= end;
        return (app.status === "completed" || (app.status === "booked" && isPastOrToday)) && 
               appDate >= start && appDate <= end && 
               app.customerName !== "BLOQUEIO MANUAL" &&
               !app.customerName.includes("AUSÊNCIA") &&
               !app.customerName.includes("FÉRIAS");
      });

      const workbook = new ExcelJS.Workbook();
      const summarySheet = workbook.addWorksheet("Resumo por Barbeiro");
      const detailSheet = workbook.addWorksheet("Detalhe Completo");

      // Folha 1: Resumo
      summarySheet.columns = [
        { header: "Nome do Barbeiro", key: "barberName", width: 25 },
        { header: "Número Total de Serviços", key: "totalServices", width: 25 },
        { header: "Total Faturado (€)", key: "totalRevenue", width: 20 },
      ];

      const summaryData: Record<number, { name: string; count: number; revenue: number }> = {};
      
      filteredAppointments.forEach(app => {
        const service = allServices.find(s => s.id === app.serviceId);
        const barber = allBarbers.find(b => b.id === app.barberId);
        if (!barber) return;

        if (!summaryData[barber.id]) {
          summaryData[barber.id] = { name: barber.name, count: 0, revenue: 0 };
        }
        summaryData[barber.id].count++;
        summaryData[barber.id].revenue += (service?.price || 0) / 100;
      });

      const sortedSummary = Object.values(summaryData).sort((a, b) => b.revenue - a.revenue);
      let grandTotalServices = 0;
      let grandTotalRevenue = 0;

      sortedSummary.forEach(item => {
        summarySheet.addRow({
          barberName: item.name,
          totalServices: item.count,
          totalRevenue: item.revenue.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
        });
        grandTotalServices += item.count;
        grandTotalRevenue += item.revenue;
      });

      summarySheet.addRow({});
      summarySheet.addRow({
        barberName: "Total Geral",
        totalServices: grandTotalServices,
        totalRevenue: grandTotalRevenue.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
      });

      summarySheet.getRow(1).font = { bold: true };
      summarySheet.getRow(summarySheet.rowCount).font = { bold: true };

      // Folha 2: Detalhe
      detailSheet.columns = [
        { header: "Data", key: "date", width: 20 },
        { header: "Nome do Barbeiro", key: "barberName", width: 25 },
        { header: "Nome do Cliente", key: "customerName", width: 25 },
        { header: "Serviço Realizado", key: "serviceName", width: 25 },
        { header: "Valor (€)", key: "price", width: 15 },
      ];

      filteredAppointments
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .forEach(app => {
          const service = allServices.find(s => s.id === app.serviceId);
          const barber = allBarbers.find(b => b.id === app.barberId);
          detailSheet.addRow({
            date: format(new Date(app.startTime), "dd/MM/yyyy HH:mm"),
            barberName: barber?.name || "Desconhecido",
            customerName: app.customerName,
            serviceName: service?.name || "Desconhecido",
            price: ((service?.price || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })
          });
        });

      detailSheet.getRow(1).font = { bold: true };

      const fileName = `relatorio_${format(start, "dd-MM-yyyy")}_a_${format(end, "dd-MM-yyyy")}.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

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
    isVisible: true
  });

  const barber2 = await storage.createBarber({
    name: "Bruno Santos",
    specialty: "Degradê e Freestyle",
    bio: "Mestre em designs modernos e cortes urbanos.",
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
