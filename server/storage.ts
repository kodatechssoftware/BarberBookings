import { db } from "./db";
import {
  barbers,
  services,
  appointments,
  admins,
  blacklist,
  verificationCodes,
  type Barber,
  type Service,
  type Appointment,
  type Admin,
  type Blacklist,
  type CreateBarberRequest,
  type CreateServiceRequest,
  type CreateAppointmentRequest,
  type CreateAdminRequest,
  type InsertBlacklist
} from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface IStorage {
  // Barbers
  getBarbers(): Promise<Barber[]>;
  getBarber(id: number): Promise<Barber | undefined>;
  getBarberByEmail(email: string): Promise<Barber | undefined>;
  createBarber(barber: CreateBarberRequest): Promise<Barber>;
  updateBarber(id: number, barber: Partial<CreateBarberRequest>): Promise<Barber | undefined>;
  deleteBarber(id: number): Promise<void>;

  // Services
  getServices(): Promise<Service[]>;
  getService(id: number): Promise<Service | undefined>;
  createService(service: CreateServiceRequest): Promise<Service>;
  updateService(id: number, service: Partial<CreateServiceRequest>): Promise<Service | undefined>;
  deleteService(id: number): Promise<void>;

  // Appointments
  getAppointments(barberId?: number, date?: string): Promise<Appointment[]>;
  getAppointmentByToken(token: string): Promise<Appointment | undefined>;
  createAppointment(appointment: CreateAppointmentRequest & { cancelToken: string }): Promise<Appointment>;
  updateAppointmentStatus(id: number, status: "booked" | "completed" | "cancelled"): Promise<Appointment | undefined>;
  
  // Admins
  getAdminByUsername(username: string): Promise<Admin | undefined>;
  createAdmin(admin: CreateAdminRequest): Promise<Admin>;

  // Blacklist
  getBlacklist(): Promise<Blacklist[]>;
  addToBlacklist(data: InsertBlacklist): Promise<Blacklist>;
  removeFromBlacklist(id: number): Promise<void>;
  isBlacklisted(email?: string, phone?: string): Promise<boolean>;

  // Verification
  createVerificationCode(phone: string, code: string): Promise<void>;
  getVerificationCode(phone: string, code: string): Promise<boolean>;

  // Seed check
  hasData(): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
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

  async deleteBarber(id: number): Promise<void> {
    await db.delete(barbers).where(eq(barbers.id, id));
  }

  async getServices(): Promise<Service[]> {
    return await db.select().from(services).orderBy(services.price);
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
    // Set serviceId to null for all appointments linked to this service
    await db.update(appointments).set({ serviceId: null }).where(eq(appointments.serviceId, id));
    // Now we can safely delete the service
    await db.delete(services).where(eq(services.id, id));
  }

  async getAppointments(barberId?: number, date?: string): Promise<Appointment[]> {
    let query = db.select().from(appointments);
    
    const conditions = [];
    if (barberId !== undefined) {
      conditions.push(eq(appointments.barberId, barberId));
    }
    
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      conditions.push(and(gte(appointments.startTime, start), lte(appointments.startTime, end)));
    }

    if (conditions.length > 0) {
      // @ts-ignore
      query = query.where(and(...conditions));
    }

    return await query.orderBy(appointments.startTime);
  }

  async getAppointmentByToken(token: string): Promise<Appointment | undefined> {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.cancelToken, token));
    return appointment;
  }

  async createAppointment(appointment: CreateAppointmentRequest & { cancelToken: string }): Promise<Appointment> {
    const [newAppointment] = await db.insert(appointments).values(appointment).returning();
    return newAppointment;
  }

  async updateAppointmentStatus(id: number, status: "booked" | "completed" | "cancelled"): Promise<Appointment | undefined> {
    const [updated] = await db.update(appointments).set({ status }).where(eq(appointments.id, id)).returning();
    return updated;
  }

  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    const [admin] = await db.select().from(admins).where(eq(admins.username, username));
    return admin;
  }

  async createAdmin(admin: CreateAdminRequest): Promise<Admin> {
    const [newAdmin] = await db.insert(admins).values(admin).returning();
    return newAdmin;
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
    if (!email && !phone) return false;
    
    // Check phone first (most reliable)
    if (phone) {
      const [phoneEntry] = await db.select().from(blacklist).where(eq(blacklist.phone, phone));
      if (phoneEntry) return true;
    }

    // Check email if provided
    if (email) {
      const [emailEntry] = await db.select().from(blacklist).where(eq(blacklist.email, email));
      if (emailEntry) return true;
    }
    
    return false;
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

export const storage = new DatabaseStorage();
