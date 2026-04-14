import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === TABLE DEFINITIONS ===

export const barbers = pgTable("barbers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  bio: text("bio"),
  avatar: text("avatar"),
  email: text("email").unique(),
  password: text("password"),
  isVisible: boolean("is_visible").default(true),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(),
  duration: integer("duration").notNull(),
  isVisible: boolean("is_visible").default(true),
});

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
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

export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  password: text("password").notNull(),
});

export const blacklist = pgTable("blacklist", {
  id: serial("id").primaryKey(),
  email: text("email"),
  phone: text("phone").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
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
