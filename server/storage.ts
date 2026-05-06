import { db } from "./db";
import {
  barbers,
  services,
  appointments,
  admins,
  blacklist,
  verificationCodes,
  barberAvailability,
  barberInvites,
  customerNotes,
  type Barber,
  type Service,
  type Appointment,
  type AppointmentStatus,
  type Admin,
  type Blacklist,
  type BarberAvailability,
  type BarberInvite,
  type CustomerNote,
  type CreateBarberRequest,
  type CreateServiceRequest,
  type CreateAppointmentRequest,
  type CreateAdminRequest,
  type InsertBlacklist,
  type CreateBarberAvailabilityRequest,
  type CreateBarberInviteRequest,
  type CreateCustomerNoteRequest
} from "@shared/schema";
import { eq, and, gte, lte, sql, type SQL } from "drizzle-orm";

type CreateAppointmentStorageRequest = CreateAppointmentRequest & {
  cancelToken: string;
  status?: AppointmentStatus;
  depositRequired?: boolean;
  depositReason?: string | null;
};

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
  createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment>;
  updateAppointmentStatus(id: number, status: AppointmentStatus): Promise<Appointment | undefined>;
  
  // Admins
  getAdminByUsername(username: string): Promise<Admin | undefined>;
  createAdmin(admin: CreateAdminRequest): Promise<Admin>;

  // Blacklist
  getBlacklist(): Promise<Blacklist[]>;
  addToBlacklist(data: InsertBlacklist): Promise<Blacklist>;
  removeFromBlacklist(id: number): Promise<void>;
  isBlacklisted(email?: string, phone?: string): Promise<boolean>;

  // Barber availability
  getBarberAvailability(barberId: number): Promise<BarberAvailability[]>;
  getAllBarberAvailability(): Promise<BarberAvailability[]>;
  replaceBarberAvailability(barberId: number, rows: Omit<CreateBarberAvailabilityRequest, "barberId">[]): Promise<BarberAvailability[]>;

  // Barber invites
  createBarberInvite(invite: CreateBarberInviteRequest): Promise<BarberInvite>;
  getBarberInviteByToken(token: string): Promise<BarberInvite | undefined>;
  markBarberInviteUsed(id: number): Promise<BarberInvite | undefined>;

  // Customer notes
  getCustomerNoteByPhone(phone: string): Promise<CustomerNote | undefined>;
  upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote>;

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
    const conditions: SQL[] = [];
    if (barberId !== undefined) {
      conditions.push(eq(appointments.barberId, barberId));
    }
    
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      conditions.push(gte(appointments.startTime, start), lte(appointments.startTime, end));
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

  async getAppointmentByToken(token: string): Promise<Appointment | undefined> {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.cancelToken, token));
    return appointment;
  }

  async createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment> {
    const [newAppointment] = await db.insert(appointments).values(appointment).returning();
    return newAppointment;
  }

  async updateAppointmentStatus(id: number, status: AppointmentStatus): Promise<Appointment | undefined> {
    const updateData: { status: AppointmentStatus; cancelledAt?: Date | null } = { status };
    if (status === "cancelled" || status === "late_cancelled") {
      updateData.cancelledAt = new Date();
    }
    if (status === "booked" || status === "completed") {
      updateData.cancelledAt = null;
    }

    const [updated] = await db.update(appointments).set(updateData).where(eq(appointments.id, id)).returning();
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

  async getBarberAvailability(barberId: number): Promise<BarberAvailability[]> {
    return await db
      .select()
      .from(barberAvailability)
      .where(eq(barberAvailability.barberId, barberId))
      .orderBy(barberAvailability.dayOfWeek, barberAvailability.startTime);
  }

  async getAllBarberAvailability(): Promise<BarberAvailability[]> {
    return await db
      .select()
      .from(barberAvailability)
      .orderBy(barberAvailability.barberId, barberAvailability.dayOfWeek, barberAvailability.startTime);
  }

  async replaceBarberAvailability(
    barberId: number,
    rows: Omit<CreateBarberAvailabilityRequest, "barberId">[],
  ): Promise<BarberAvailability[]> {
    await db.delete(barberAvailability).where(eq(barberAvailability.barberId, barberId));

    if (rows.length === 0) {
      return [];
    }

    return await db
      .insert(barberAvailability)
      .values(rows.map((row) => ({ ...row, barberId })))
      .returning();
  }

  async createBarberInvite(invite: CreateBarberInviteRequest): Promise<BarberInvite> {
    const [newInvite] = await db.insert(barberInvites).values(invite).returning();
    return newInvite;
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

  async getCustomerNoteByPhone(phone: string): Promise<CustomerNote | undefined> {
    const [note] = await db.select().from(customerNotes).where(eq(customerNotes.phone, phone));
    return note;
  }

  async upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote> {
    const now = new Date();
    const [savedNote] = await db
      .insert(customerNotes)
      .values({
        phone: note.phone,
        email: note.email || null,
        notes: note.notes || "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: customerNotes.phone,
        set: {
          email: note.email || null,
          notes: note.notes || "",
          updatedAt: now,
        },
      })
      .returning();

    return savedNote;
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
