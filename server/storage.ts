import { db } from "./db";
import {
  barbers,
  services,
  appointments,
  admins,
  blacklist,
  verificationCodes,
  shopAvailability,
  barberAvailability,
  barberInvites,
  customerNotes,
  type Barber,
  type Service,
  type Appointment,
  type AppointmentStatus,
  type Admin,
  type Blacklist,
  type ShopAvailability,
  type BarberAvailability,
  type BarberInvite,
  type CustomerNote,
  type CreateBarberRequest,
  type CreateServiceRequest,
  type CreateAppointmentRequest,
  type CreateAdminRequest,
  type InsertBlacklist,
  type CreateShopAvailabilityRequest,
  type CreateBarberAvailabilityRequest,
  type CreateBarberInviteRequest,
  type CreateCustomerNoteRequest
} from "@shared/schema";
import { eq, and, gte, lte, sql, type SQL } from "drizzle-orm";

type CreateAppointmentStorageRequest = CreateAppointmentRequest & {
  cancelToken: string;
  durationMinutes: number;
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
  getAppointment(id: number): Promise<Appointment | undefined>;
  getAppointmentByToken(token: string): Promise<Appointment | undefined>;
  createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment>;
  updateAppointment(id: number, appointment: Partial<Omit<Appointment, "id">>): Promise<Appointment | undefined>;
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
  getShopAvailability(): Promise<ShopAvailability[]>;
  replaceShopAvailability(rows: CreateShopAvailabilityRequest[]): Promise<ShopAvailability[]>;
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

  async getAppointment(id: number): Promise<Appointment | undefined> {
    const [appointment] = await db.select().from(appointments).where(eq(appointments.id, id));
    return appointment;
  }

  async createAppointment(appointment: CreateAppointmentStorageRequest): Promise<Appointment> {
    const [newAppointment] = await db.insert(appointments).values(appointment).returning();
    return newAppointment;
  }

  async updateAppointment(
    id: number,
    appointment: Partial<Omit<Appointment, "id">>,
  ): Promise<Appointment | undefined> {
    const [updated] = await db.update(appointments).set(appointment).where(eq(appointments.id, id)).returning();
    return updated;
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

  async getShopAvailability(): Promise<ShopAvailability[]> {
    return await db
      .select()
      .from(shopAvailability)
      .orderBy(shopAvailability.dayOfWeek, shopAvailability.startTime);
  }

  async replaceShopAvailability(rows: CreateShopAvailabilityRequest[]): Promise<ShopAvailability[]> {
    await db.delete(shopAvailability);

    if (rows.length === 0) {
      return [];
    }

    return await db.insert(shopAvailability).values(rows).returning();
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
  private admins: Admin[] = [];
  private blacklist: Blacklist[] = [];
  private shopAvailability: ShopAvailability[] = [];
  private barberAvailability: BarberAvailability[] = [];
  private barberInvites: BarberInvite[] = [];
  private customerNotes: CustomerNote[] = [];
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
    verificationCode: 1,
  };

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
    const newBarber: Barber = {
      id: this.nextIds.barber++,
      name: barber.name,
      specialty: barber.specialty,
      bio: barber.bio ?? null,
      avatar: barber.avatar ?? null,
      email: barber.email ?? null,
      password: barber.password ?? null,
      isVisible: barber.isVisible ?? true,
    };
    this.barbers.push(newBarber);
    return newBarber;
  }

  async updateBarber(id: number, barber: Partial<CreateBarberRequest>): Promise<Barber | undefined> {
    const index = this.barbers.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    this.barbers[index] = { ...this.barbers[index], ...barber };
    return this.barbers[index];
  }

  async deleteBarber(id: number): Promise<void> {
    if (this.appointments.some((appointment) => appointment.barberId === id)) {
      const error = new Error("Barber has appointments") as Error & { code?: string };
      error.code = "23503";
      throw error;
    }
    this.barbers = this.barbers.filter((barber) => barber.id !== id);
    this.barberAvailability = this.barberAvailability.filter((row) => row.barberId !== id);
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
    this.appointments = this.appointments.map((appointment) =>
      appointment.serviceId === id ? { ...appointment, serviceId: null } : appointment,
    );
    this.services = this.services.filter((service) => service.id !== id);
  }

  async getAppointments(barberId?: number, date?: string): Promise<Appointment[]> {
    const start = date ? new Date(date) : null;
    if (start) start.setHours(0, 0, 0, 0);
    const end = start ? new Date(start) : null;
    if (end) end.setHours(23, 59, 59, 999);

    return this.appointments
      .filter((appointment) => barberId === undefined || appointment.barberId === barberId)
      .filter((appointment) => {
        if (!start || !end) return true;
        const appointmentDate = new Date(appointment.startTime);
        return appointmentDate >= start && appointmentDate <= end;
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
    const newAppointment: Appointment = {
      id: this.nextIds.appointment++,
      barberId: appointment.barberId,
      serviceId: appointment.serviceId ?? null,
      startTime: appointment.startTime,
      customerName: appointment.customerName,
      customerEmail: appointment.customerEmail ?? null,
      customerPhone: appointment.customerPhone,
      durationMinutes: appointment.durationMinutes,
      status: appointment.status ?? "booked",
      cancelToken: appointment.cancelToken,
      cancelledAt: null,
      depositRequired: appointment.depositRequired ?? false,
      depositReason: appointment.depositReason ?? null,
      createdAt: new Date(),
    };
    this.appointments.push(newAppointment);
    return newAppointment;
  }

  async updateAppointment(
    id: number,
    appointment: Partial<Omit<Appointment, "id">>,
  ): Promise<Appointment | undefined> {
    const index = this.appointments.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    this.appointments[index] = { ...this.appointments[index], ...appointment };
    return this.appointments[index];
  }

  async updateAppointmentStatus(id: number, status: AppointmentStatus): Promise<Appointment | undefined> {
    const patch: Partial<Omit<Appointment, "id">> = { status };
    if (status === "cancelled" || status === "late_cancelled") {
      patch.cancelledAt = new Date();
    }
    if (status === "booked" || status === "completed") {
      patch.cancelledAt = null;
    }
    return this.updateAppointment(id, patch);
  }

  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    return this.admins.find((admin) => admin.username === username);
  }

  async createAdmin(admin: CreateAdminRequest): Promise<Admin> {
    const newAdmin: Admin = {
      id: this.nextIds.admin++,
      username: admin.username,
      email: admin.email ?? null,
      password: admin.password,
    };
    this.admins.push(newAdmin);
    return newAdmin;
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
    return this.blacklist.some((entry) =>
      (phone && entry.phone === phone) || (email && entry.email === email),
    );
  }

  async getShopAvailability(): Promise<ShopAvailability[]> {
    return [...this.shopAvailability].sort(
      (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  }

  async replaceShopAvailability(rows: CreateShopAvailabilityRequest[]): Promise<ShopAvailability[]> {
    this.shopAvailability = [];
    const createdRows = rows.map((row) => ({
      id: this.nextIds.shopAvailability++,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      isOpen: row.isOpen ?? true,
    }));
    this.shopAvailability.push(...createdRows);
    return createdRows;
  }

  async getBarberAvailability(barberId: number): Promise<BarberAvailability[]> {
    return this.barberAvailability
      .filter((row) => row.barberId === barberId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  }

  async getAllBarberAvailability(): Promise<BarberAvailability[]> {
    return [...this.barberAvailability].sort(
      (a, b) => a.barberId - b.barberId || a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime),
    );
  }

  async replaceBarberAvailability(
    barberId: number,
    rows: Omit<CreateBarberAvailabilityRequest, "barberId">[],
  ): Promise<BarberAvailability[]> {
    this.barberAvailability = this.barberAvailability.filter((row) => row.barberId !== barberId);
    const createdRows = rows.map((row) => ({
      id: this.nextIds.availability++,
      barberId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      isWorking: row.isWorking ?? true,
    }));
    this.barberAvailability.push(...createdRows);
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

  async getBarberInviteByToken(token: string): Promise<BarberInvite | undefined> {
    return this.barberInvites.find((invite) => invite.token === token);
  }

  async markBarberInviteUsed(id: number): Promise<BarberInvite | undefined> {
    const index = this.barberInvites.findIndex((invite) => invite.id === id);
    if (index === -1) return undefined;
    this.barberInvites[index] = { ...this.barberInvites[index], usedAt: new Date() };
    return this.barberInvites[index];
  }

  async getCustomerNoteByPhone(phone: string): Promise<CustomerNote | undefined> {
    return this.customerNotes.find((note) => note.phone === phone);
  }

  async upsertCustomerNote(note: CreateCustomerNoteRequest): Promise<CustomerNote> {
    const now = new Date();
    const existingIndex = this.customerNotes.findIndex((item) => item.phone === note.phone);
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
      email: note.email || null,
      notes: note.notes || "",
      createdAt: now,
      updatedAt: now,
    };
    this.customerNotes.push(savedNote);
    return savedNote;
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
