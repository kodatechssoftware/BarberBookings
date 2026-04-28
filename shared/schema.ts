import { pgSchema, pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
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

function idColumn(sequenceName: string) {
  if (databaseSchema && databaseSchema !== "public") {
    return integer("id")
      .primaryKey()
      .default(sql.raw(`nextval('${databaseSchema}.${sequenceName}'::regclass)`));
  }

  return serial("id").primaryKey();
}

// === TABLE DEFINITIONS ===

export const barbers = appPgTable("barbers", {
  id: idColumn("barbers_id_seq"),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  bio: text("bio"),
  avatar: text("avatar"),
  email: text("email").unique(),
  password: text("password"),
  isVisible: boolean("is_visible").default(true),
});

export const services = appPgTable("services", {
  id: idColumn("services_id_seq"),
  name: text("name").notNull(),
  description: text("description"),
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
  status: text("status", { enum: ["booked", "completed", "cancelled"] }).default("booked").notNull(),
  cancelToken: text("cancel_token").notNull(),
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
}));

export const servicesRelations = relations(services, ({ many }) => ({
  appointments: many(appointments),
}));

// === BASE SCHEMAS ===

export const insertBarberSchema = createInsertSchema(barbers).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true, createdAt: true, status: true, cancelToken: true });
export const insertAdminSchema = createInsertSchema(admins).omit({ id: true });
export const insertBlacklistSchema = createInsertSchema(blacklist).omit({ id: true, createdAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Admin = typeof admins.$inferSelect;
export type Blacklist = typeof blacklist.$inferSelect;

export type CreateBarberRequest = z.infer<typeof insertBarberSchema>;
export type CreateServiceRequest = z.infer<typeof insertServiceSchema>;
export type CreateAppointmentRequest = z.infer<typeof insertAppointmentSchema>;
export type CreateAdminRequest = z.infer<typeof insertAdminSchema>;
export type InsertBlacklist = z.infer<typeof insertBlacklistSchema>;

export type AppointmentWithDetails = Appointment & {
  barber: Barber;
  service: Service;
};
