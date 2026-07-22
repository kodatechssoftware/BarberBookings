import { pgSchema, pgTable, text, serial, integer, boolean, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";

const databaseSchema =
  typeof process !== "undefined" ? process.env.DATABASE_SCHEMA?.trim() : undefined;
export const appPgSchema =
  databaseSchema && databaseSchema !== "public" ? pgSchema(databaseSchema) : undefined;
const appPgTable = (appPgSchema ? appPgSchema.table : pgTable) as typeof pgTable;

export const barbersIdSeq = appPgSchema?.sequence("barbers_id_seq");
export const servicesIdSeq = appPgSchema?.sequence("services_id_seq");
export const appointmentsIdSeq = appPgSchema?.sequence("appointments_id_seq");
export const adminsIdSeq = appPgSchema?.sequence("admins_id_seq");
export const blacklistIdSeq = appPgSchema?.sequence("blacklist_id_seq");
export const verificationCodesIdSeq = appPgSchema?.sequence("verification_codes_id_seq");
export const shopAvailabilityIdSeq = appPgSchema?.sequence("shop_availability_id_seq");
export const barberAvailabilityIdSeq = appPgSchema?.sequence("barber_availability_id_seq");
export const barberInvitesIdSeq = appPgSchema?.sequence("barber_invites_id_seq");
export const customerNotesIdSeq = appPgSchema?.sequence("customer_notes_id_seq");
export const auditLogsIdSeq = appPgSchema?.sequence("audit_logs_id_seq");

function idColumn(sequenceName: string) {
  if (databaseSchema && databaseSchema !== "public") {
    return integer("id")
      .primaryKey()
      .default(sql.raw(`nextval('${databaseSchema}.${sequenceName}'::regclass)`));
  }

  return serial("id").primaryKey();
}

// === TABLE DEFINITIONS ===

export const appointmentStatuses = [
  "booked",
  "completed",
  "cancelled",
  "late_cancelled",
  "no_show",
] as const;

export const barbers = appPgTable("barbers", {
  id: idColumn("barbers_id_seq"),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  bio: text("bio"),
  avatar: text("avatar"),
  email: text("email").unique(),
  password: text("password"),
  color: text("color").notNull().default("#D4AF37"),
  isVisible: boolean("is_visible").default(true),
});

export const services = appPgTable("services", {
  id: idColumn("services_id_seq"),
  name: text("name").notNull(),
  description: text("description"),
  agendaLabel: text("agenda_label"),
  price: integer("price").notNull(),
  duration: integer("duration").notNull(),
  isVisible: boolean("is_visible").default(true),
});

export const appointments = appPgTable("appointments", {
  id: idColumn("appointments_id_seq"),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  serviceId: integer("service_id").references(() => services.id),
  startTime: timestamp("start_time").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone").notNull(),
  durationMinutes: integer("duration_minutes").default(30).notNull(),
  status: text("status", { enum: appointmentStatuses }).default("booked").notNull(),
  cancelToken: text("cancel_token").notNull(),
  cancelledAt: timestamp("cancelled_at"),
  depositRequired: boolean("deposit_required").default(false).notNull(),
  depositReason: text("deposit_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const admins = appPgTable("admins", {
  id: idColumn("admins_id_seq"),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  password: text("password").notNull(),
});

export const blacklist = appPgTable("blacklist", {
  id: idColumn("blacklist_id_seq"),
  email: text("email"),
  phone: text("phone").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const verificationCodes = appPgTable("verification_codes", {
  id: idColumn("verification_codes_id_seq"),
  phone: text("phone").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
});

export const shopAvailability = appPgTable("shop_availability", {
  id: idColumn("shop_availability_id_seq"),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isOpen: boolean("is_open").default(true).notNull(),
});

export const barberAvailability = appPgTable("barber_availability", {
  id: idColumn("barber_availability_id_seq"),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isWorking: boolean("is_working").default(true).notNull(),
});

export const barberServices = appPgTable("barber_services", {
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  serviceId: integer("service_id").references(() => services.id).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.barberId, table.serviceId] }),
}));

export const barberInvites = appPgTable("barber_invites", {
  id: idColumn("barber_invites_id_seq"),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customerNotes = appPgTable("customer_notes", {
  id: idColumn("customer_notes_id_seq"),
  phone: text("phone").notNull(),
  customerNameKey: text("customer_name_key").notNull().default(""),
  email: text("email"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  customerNotesIdentityIdx: uniqueIndex("customer_notes_phone_name_idx").on(table.phone, table.customerNameKey),
}));

export const auditLogs = appPgTable("audit_logs", {
  id: idColumn("audit_logs_id_seq"),
  actorType: text("actor_type").notNull(),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// === RELATIONS ===

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  barber: one(barbers, {
    fields: [appointments.barberId],
    references: [barbers.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
}));

export const barbersRelations = relations(barbers, ({ many }) => ({
  appointments: many(appointments),
  serviceAssignments: many(barberServices),
}));

export const servicesRelations = relations(services, ({ many }) => ({
  appointments: many(appointments),
  barberAssignments: many(barberServices),
}));

export const barberServicesRelations = relations(barberServices, ({ one }) => ({
  barber: one(barbers, {
    fields: [barberServices.barberId],
    references: [barbers.id],
  }),
  service: one(services, {
    fields: [barberServices.serviceId],
    references: [services.id],
  }),
}));

// === BASE SCHEMAS ===

export const insertBarberSchema = createInsertSchema(barbers).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true }).extend({
  name: z.string().trim().min(1, "Indique o nome do serviço.").max(100, "O nome não pode ter mais de 100 caracteres."),
  description: z.string().trim().max(500, "A descrição não pode ter mais de 500 caracteres.").optional().nullable(),
  agendaLabel: z.string().trim().max(40, "A etiqueta da agenda nao pode ter mais de 40 caracteres.").optional().nullable(),
  price: z.number().int("O preço deve ser um número inteiro de cêntimos.").min(0, "O preço não pode ser negativo.").max(1_000_000, "O preço indicado é demasiado elevado."),
  duration: z.number().int("A duração deve ser um número inteiro de minutos.").min(1, "A duração deve ser superior a zero.").max(720, "A duração não pode exceder 12 horas."),
});
const localPortugueseMobilePattern = /^9\d{8}$/;
const internationalPhonePattern = /^\+\d{7,15}$/;
const internationalZeroPrefixPhonePattern = /^00\d{7,15}$/;
const bookingPhoneSchema = z.string().trim().refine((value) => {
  const trimmed = value.trim();
  return localPortugueseMobilePattern.test(trimmed) ||
    internationalPhonePattern.test(trimmed) ||
    internationalZeroPrefixPhonePattern.test(trimmed);
}, "Indique um telemovel valido.");
export const insertAppointmentSchema = createInsertSchema(appointments).omit({
  id: true,
  createdAt: true,
  status: true,
  cancelToken: true,
  cancelledAt: true,
  durationMinutes: true,
  depositRequired: true,
  depositReason: true,
}).extend({
  customerName: z.string().trim().min(1, "Indique o nome.").max(80, "O nome não pode ter mais de 80 caracteres."),
  customerEmail: z.string().trim().email("Indique um email válido.").max(120, "O email não pode ter mais de 120 caracteres.").optional().nullable(),
  customerPhone: bookingPhoneSchema,
});
export const insertAdminSchema = createInsertSchema(admins).omit({ id: true });
export const insertBlacklistSchema = createInsertSchema(blacklist).omit({ id: true, createdAt: true });
export const insertShopAvailabilitySchema = createInsertSchema(shopAvailability).omit({ id: true });
export const insertBarberAvailabilitySchema = createInsertSchema(barberAvailability).omit({ id: true });
export const insertBarberServiceSchema = createInsertSchema(barberServices);
export const insertBarberInviteSchema = createInsertSchema(barberInvites).omit({ id: true, createdAt: true });
export const insertCustomerNoteSchema = createInsertSchema(customerNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentStatus = typeof appointmentStatuses[number];
export type Admin = typeof admins.$inferSelect;
export type Blacklist = typeof blacklist.$inferSelect;
export type ShopAvailability = typeof shopAvailability.$inferSelect;
export type BarberAvailability = typeof barberAvailability.$inferSelect;
export type BarberService = typeof barberServices.$inferSelect;
export type BarberInvite = typeof barberInvites.$inferSelect;
export type CustomerNote = typeof customerNotes.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

export type BarberWithServices = Barber & {
  serviceIds: number[];
};

export type CreateBarberRequest = z.infer<typeof insertBarberSchema>;
export type CreateServiceRequest = z.infer<typeof insertServiceSchema>;
export type CreateAppointmentRequest = z.infer<typeof insertAppointmentSchema>;
export type CreateAdminRequest = z.infer<typeof insertAdminSchema>;
export type InsertBlacklist = z.infer<typeof insertBlacklistSchema>;
export type CreateShopAvailabilityRequest = z.infer<typeof insertShopAvailabilitySchema>;
export type CreateBarberAvailabilityRequest = z.infer<typeof insertBarberAvailabilitySchema>;
export type CreateBarberServiceRequest = z.infer<typeof insertBarberServiceSchema>;
export type CreateBarberInviteRequest = z.infer<typeof insertBarberInviteSchema>;
export type CreateCustomerNoteRequest = z.infer<typeof insertCustomerNoteSchema>;
export type CreateAuditLogRequest = z.infer<typeof insertAuditLogSchema>;

export type AppointmentWithDetails = Appointment & {
  barber: Barber;
  service: Service;
};
