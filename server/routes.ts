import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { randomUUID } from "crypto";
import { sendBookingConfirmation } from "./email";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { db } from "./db";
import { parseISO, format, isValid, startOfDay, endOfDay } from "date-fns";
import ExcelJS from 'exceljs';
import { appointments as appointmentsTable, barbers as barbersTable, verificationCodes } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const PostgresSessionStore = connectPg(session);

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const isProduction = process.env.NODE_ENV === "production";
const databaseSchema = process.env.DATABASE_SCHEMA?.trim();
const sessionSchemaName =
  databaseSchema && databaseSchema !== "public" ? databaseSchema : undefined;

function getSessionSameSite(): "lax" | "strict" | "none" {
  const value = (process.env.SESSION_SAME_SITE || "lax").toLowerCase();

  if (value === "strict" || value === "none") {
    return value;
  }

  return "lax";
}

type AppointmentLike = {
  id?: number;
  barberId: number;
  serviceId: number | null;
  startTime: Date | string;
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
  const durationMinutes = getAppointmentDurationMinutes(appointment.serviceId, serviceDurations);
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
    if (appointment.status === "cancelled") return false;
    if (ignoreAppointmentId !== undefined && appointment.id === ignoreAppointmentId) return false;

    const appointmentStart = toDate(appointment.startTime);
    const appointmentEnd = getAppointmentEndTime(appointment, serviceDurations);

    return startTime < appointmentEnd && endTime > appointmentStart;
  });
}

export async function registerRoutes(
  app: Express,
  httpServer: Server
): Promise<Server> {
  // Session middleware
  app.use(session({
    store: new PostgresSessionStore({
      conObject: { connectionString: process.env.DATABASE_URL },
      schemaName: sessionSchemaName,
      createTableIfMissing: true,
    }),
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
  }));

  // === AUTH ===
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Try admin login first
      const admin = await storage.getAdminByUsername(username);
      if (admin && (await bcrypt.compare(password, admin.password))) {
        // @ts-ignore
        req.session.adminId = admin.id;
        // @ts-ignore
        req.session.role = "admin";
        return res.json({ message: "Login efetuado com sucesso", role: "admin" });
      }

      // Try barber login if admin fails
      const barber = await storage.getBarberByEmail(username);
      if (barber) {
        // If password is not set, this is the first login
        if (!barber.password) {
          // Set the provided password as their new password
          const hashedPassword = await bcrypt.hash(password, 10);
          await storage.updateBarber(barber.id, { password: hashedPassword });
          // @ts-ignore
          req.session.barberId = barber.id;
          // @ts-ignore
          req.session.role = "barber";
          return res.json({ message: "Palavra-passe definida e login efetuado", role: "barber" });
        }
        
        if (await bcrypt.compare(password, barber.password)) {
          // @ts-ignore
          req.session.barberId = barber.id;
          // @ts-ignore
          req.session.role = "barber";
          return res.json({ message: "Login efetuado com sucesso", role: "barber" });
        }
      }

      return res.status(401).json({ message: "Utilizador ou senha incorretos" });
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
    // @ts-ignore
    if (!req.session.adminId && !req.session.barberId) {
      return res.json({ authorized: false, role: "" });
    }
    // @ts-ignore
    const role = req.session.role;
    // @ts-ignore
    const id = req.session.adminId || req.session.barberId;
    
    let userDetails = {};
    if (role === "barber") {
      // @ts-ignore
      const barber = await storage.getBarber(req.session.barberId);
      userDetails = { name: barber?.name, email: barber?.email };
    }
    
    return res.json({ authorized: true, role, id, ...userDetails });
  });

  // Auth Middleware for admin routes
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.session.role !== "admin") return res.status(401).json({ message: "NÃ£o autorizado" });
    next();
  };

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.adminId && !req.session.barberId) return res.status(401).json({ message: "NÃ£o autorizado" });
    next();
  };

  // === BARBERS MGMT ===
  app.post("/api/barbers", requireAdmin, async (req, res) => {
    try {
      const barber = await storage.createBarber(req.body);
      res.status(201).json(barber);
    } catch (error) {
      res.status(500).json({ message: "Erro ao criar barbeiro" });
    }
  });

  app.patch("/api/barbers/:id", requireAdmin, async (req, res) => {
    try {
      const barber = await storage.updateBarber(Number(req.params.id), req.body);
      if (!barber) return res.status(404).json({ message: "Barbeiro nÃ£o encontrado" });
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
        return res.status(409).json({ message: "NÃ£o Ã© possÃ­vel remover um barbeiro com marcaÃ§Ãµes associadas." });
      }
      res.status(500).json({ message: "Erro ao remover barbeiro" });
    }
  });

  app.patch("/api/barbers/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const [updated] = await db.update(barbersTable)
        .set({ password: null })
        .where(eq(barbersTable.id, Number(req.params.id)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Barbeiro nÃ£o encontrado" });
      res.json({ message: "Password removida" });
    } catch (error) {
      res.status(500).json({ message: "Erro ao repor password" });
    }
  });

  // === SERVICES MGMT ===
  app.post("/api/services", requireAdmin, async (req, res) => {
    try {
      const service = await storage.createService(req.body);
      res.status(201).json(service);
    } catch (error) {
      res.status(500).json({ message: "Erro ao criar serviÃ§o" });
    }
  });

  app.patch("/api/services/:id", requireAdmin, async (req, res) => {
    try {
      const service = await storage.updateService(Number(req.params.id), req.body);
      if (!service) return res.status(404).json({ message: "ServiÃ§o nÃ£o encontrado" });
      res.json(service);
    } catch (error) {
      res.status(500).json({ message: "Erro ao atualizar serviÃ§o" });
    }
  });

  app.delete("/api/services/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteService(Number(req.params.id));
      res.json({ message: "ServiÃ§o removido" });
    } catch (error) {
      res.status(500).json({ message: "Erro ao remover serviÃ§o" });
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
    const includeHidden = req.query.includeHidden === "true" &&
      Boolean((req.session as any).adminId || (req.session as any).barberId);

    res.json(includeHidden ? barbers : barbers.filter((barber) => barber.isVisible));
  });

  app.get(api.barbers.get.path, async (req, res) => {
    const barber = await storage.getBarber(Number(req.params.id));
    if (!barber) {
      return res.status(404).json({ message: "Barbeiro nÃ£o encontrado" });
    }
    res.json(barber);
  });

  app.post(api.barbers.create.path, async (req, res) => {
    try {
      const input = api.barbers.create.input.parse(req.body);
      const barber = await storage.createBarber(input);
      res.status(201).json(barber);
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

  // === SERVICES ===
  app.get(api.services.list.path, async (req, res) => {
    const services = await storage.getServices();
    const includeHidden = req.query.includeHidden === "true" &&
      Boolean((req.session as any).adminId || (req.session as any).barberId);

    res.json(includeHidden ? services : services.filter((service) => service.isVisible));
  });

  app.post(api.services.create.path, async (req, res) => {
    try {
      const input = api.services.create.input.parse(req.body);
      const service = await storage.createService(input);
      res.status(201).json(service);
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

  // === APPOINTMENTS ===
  app.get(api.appointments.list.path, requireAuth, async (req, res) => {
    // @ts-ignore
    const barberId = req.session.role === "barber"
      // @ts-ignore
      ? Number(req.session.barberId)
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
      const requestedEndTime = new Date(
        input.startTime.getTime() +
          getAppointmentDurationMinutes(input.serviceId, serviceDurations) * 60000,
      );
      const dateStr = input.startTime.toISOString().split('T')[0];

      // Check for blacklist
      const isBlacklisted = await storage.isBlacklisted(input.customerEmail || undefined, input.customerPhone);
      if (isBlacklisted) {
        return res.status(403).json({ message: "NÃ£o Ã© possÃ­vel realizar a marcaÃ§Ã£o online. Por favor, contacte a barbearia." });
      }



      const cancelToken = randomUUID();
      
      // Handle "Any Barber" selection
      let finalBarberId = input.barberId;
      if (finalBarberId === 0) {
        const barbers = await storage.getBarbers();
        const existingAppointments = await storage.getAppointments(undefined, dateStr);
        
        const visibleBarbers = barbers.filter((barber) => barber.isVisible);
        const availableBarber = visibleBarbers.find((barber) =>
          !hasAppointmentConflict(
            existingAppointments,
            barber.id,
            input.startTime,
            requestedEndTime,
            serviceDurations,
          ),
        );
        if (!availableBarber) {
          return res.status(409).json({ message: "Nenhum barbeiro disponÃ­vel para este horÃ¡rio." });
        }
        finalBarberId = availableBarber.id;
      } else {
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
          return res.status(409).json({ message: "Este horÃƒÂ¡rio jÃƒÂ¡ estÃƒÂ¡ reservado." });
        }
      }

      const appointment = await storage.createAppointment({ ...input, barberId: finalBarberId, cancelToken });

      // Send email if address is provided
      if (input.customerEmail) {
        const barber = await storage.getBarber(finalBarberId);
        const service = services.find(s => s.id === input.serviceId);
        
        if (barber && service) {
          // Fire and forget email sending
          sendBookingConfirmation({
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            barberName: barber.name,
            serviceName: service.name,
            startTime: input.startTime,
            cancelToken
          }).catch(console.error);
        }
      }

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
      const appointments = [];
      const conflicts = [];
      const services = await storage.getServices();
      const serviceDurations = new Map(services.map((service) => [service.id, service.duration]));
      const duration = serviceId
        ? getAppointmentDurationMinutes(Number(serviceId), serviceDurations)
        : DEFAULT_APPOINTMENT_DURATION_MINUTES;

      // Determine how many occurrences
      const occurrences = (isRecurring && recurringWeeks && recurringMonths) 
        ? Math.floor((Number(recurringMonths) * 4.33) / Number(recurringWeeks)) 
        : 1;

      for (let i = 0; i < occurrences; i++) {
        const currentStart = new Date(start);
        currentStart.setDate(start.getDate() + (i * Number(recurringWeeks || 0) * 7));
        const currentEnd = new Date(currentStart.getTime() + duration * 60000);

        const existingAppointments = await storage.getAppointments(
          Number(barberId),
          currentStart.toISOString().split('T')[0],
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
          status: "booked",
          cancelToken: randomUUID()
        });
      }

      if (conflicts.length > 0 && occurrences > 1) {
        return res.status(400).json({ 
          message: "Conflitos detetados em algumas datas", 
          conflicts 
        });
      } else if (conflicts.length > 0) {
        return res.status(400).json({ message: "HorÃ¡rio indisponÃ­vel para este barbeiro." });
      }

      for (const app of appointments) {
        await storage.createAppointment(app as any);
      }

      res.status(201).json({ message: `${appointments.length} marcaÃ§Ãµes criadas.` });
    } catch (error) {
      console.error("Block error:", error);
      res.status(500).json({ message: "Erro ao bloquear horÃ¡rio" });
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
      .filter((app) => app.status !== 'cancelled' && visibleBarberIds.has(app.barberId))
      .map((app) => ({
        startTime: app.startTime,
        barberId: app.barberId,
        serviceId: app.serviceId,
        duration: getAppointmentDurationMinutes(app.serviceId, serviceDurations),
      }));
    res.json(publicAppointments);
  });
  
  app.patch("/api/appointments/:id", requireAdmin, async (req, res) => {
    try {
      const { startTime, barberId, status } = req.body;
      const appointmentId = Number(req.params.id);
      const currentApp = await db.query.appointments.findFirst({
        where: eq(appointmentsTable.id, appointmentId)
      });

      if (!currentApp) return res.status(404).json({ message: "MarcaÃ§Ã£o nÃ£o encontrada" });

      const newStartTime = startTime ? new Date(startTime) : new Date(currentApp.startTime);
      const newBarberId = barberId ? Number(barberId) : currentApp.barberId;
      const serviceDurations = new Map(
        (await storage.getServices()).map((service) => [service.id, service.duration]),
      );

      // Conflict check for re-scheduling
      if (startTime || barberId) {
        const dateStr = newStartTime.toISOString().split('T')[0];
        const existingAppointments = await storage.getAppointments(newBarberId, dateStr);
        const newEndTime = new Date(
          newStartTime.getTime() +
            getAppointmentDurationMinutes(currentApp.serviceId, serviceDurations) * 60000,
        );

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
          return res.status(409).json({ message: "Este barbeiro jÃ¡ tem uma marcaÃ§Ã£o para este horÃ¡rio." });
        }
      }

      const updateData: any = {};
      if (startTime) updateData.startTime = newStartTime;
      if (barberId) updateData.barberId = newBarberId;
      if (status) updateData.status = status;

      const [updated] = await db.update(appointmentsTable)
        .set(updateData)
        .where(eq(appointmentsTable.id, appointmentId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update appointment error:", error);
      res.status(500).json({ message: "Erro ao atualizar marcaÃ§Ã£o" });
    }
  });

  app.patch(api.appointments.updateStatus.path, requireAdmin, async (req, res) => {
     const status = req.body.status;
     const updated = await storage.updateAppointmentStatus(Number(req.params.id), status);
     if (!updated) return res.status(404).json({ message: "MarcaÃ§Ã£o nÃ£o encontrada" });
     res.json(updated);
  });

  app.post('/api/appointments/cancel/:token', async (req, res) => {
    const appointment = await storage.getAppointmentByToken(req.params.token);
    if (!appointment) {
      return res.status(404).json({ message: "MarcaÃ§Ã£o nÃ£o encontrada" });
    }
    
    if (appointment.status !== 'booked') {
      return res.status(409).json({ message: "Esta marcaÃƒÂ§ÃƒÂ£o jÃƒÂ¡ nÃƒÂ£o pode ser cancelada." });
    }

    await storage.updateAppointmentStatus(appointment.id, 'cancelled');
    res.json({ message: "MarcaÃ§Ã£o cancelada com sucesso" });
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
      res.status(500).json({ message: "Erro ao adicionar Ã  blacklist" });
    }
  });

  const removeBlacklistEntry = async (req: any, res: any) => {
    await storage.removeFromBlacklist(Number(req.params.id));
    res.json({ message: "Removido da blacklist" });
  };

  app.post("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);
  app.delete("/api/admin/blacklist/:id", requireAdmin, removeBlacklistEntry);

  // === EXPORT RELATÃ“RIOS ===
  app.get("/api/admin/export", requireAdmin, async (req, res) => {
    const { startDate, endDate, barberId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: "Datas de inÃ­cio e fim sÃ£o obrigatÃ³rias" });
    }

    const start = startOfDay(parseISO(startDate as string));
    const end = endOfDay(parseISO(endDate as string));

    if (!isValid(start) || !isValid(end)) {
      return res.status(400).json({ message: "Datas invÃ¡lidas" });
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
               !app.customerName.includes("AUSÃŠNCIA") &&
               !app.customerName.includes("FÃ‰RIAS");
      });

      const workbook = new ExcelJS.Workbook();
      const summarySheet = workbook.addWorksheet("Resumo por Barbeiro");
      const detailSheet = workbook.addWorksheet("Detalhe Completo");

      // Folha 1: Resumo
      summarySheet.columns = [
        { header: "Nome do Barbeiro", key: "barberName", width: 25 },
        { header: "NÃºmero Total de ServiÃ§os", key: "totalServices", width: 25 },
        { header: "Total Faturado (â‚¬)", key: "totalRevenue", width: 20 },
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
        { header: "ServiÃ§o Realizado", key: "serviceName", width: 25 },
        { header: "Valor (â‚¬)", key: "price", width: 15 },
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
      res.status(500).json({ message: "Erro ao gerar relatÃ³rio" });
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
    return;
  }

  console.log("Seeding database...");

  const barber1 = await storage.createBarber({
    name: "FÃ¡bio Baptista",
    specialty: "Cortes ClÃ¡ssicos e Barba",
    bio: "Especialista em cortes tradicionais na Barbearia Baptista.",
    isVisible: true
  });

  const barber2 = await storage.createBarber({
    name: "Bruno Santos",
    specialty: "DegradÃª e Freestyle",
    bio: "Mestre em designs modernos e cortes urbanos.",
    isVisible: true
  });

  await storage.createService({
    name: "Corte de Cabelo",
    description: "Corte completo com lavagem e finalizaÃ§Ã£o.",
    price: 1500, // 15.00
    duration: 30,
    isVisible: true
  });

  await storage.createService({
    name: "Barba Completa",
    description: "Barba modelada com toalha quente.",
    price: 1200, // 12.00
    duration: 20,
    isVisible: true
  });

  await storage.createService({
    name: "Combo Corte + Barba",
    description: "ServiÃ§o completo para o visual perfeito.",
    price: 2500, // 25.00
    duration: 50,
    isVisible: true
  });

  const hashedPassword = await bcrypt.hash("baptista2026", 10);
  await storage.createAdmin({ username: "admin", password: hashedPassword });

  console.log("Database seeded!");
}
