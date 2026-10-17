import { pgSchema, pgTable, text, serial, integer, boolean, timestamp, date, primaryKey, uniqueIndex, index, jsonb, check, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
import { accessPresetKeys, capabilityCodes } from "./auth";

const databaseSchema =
  typeof process !== "undefined" ? process.env.DATABASE_SCHEMA?.trim() : undefined;
export const appPgSchema =
  databaseSchema && databaseSchema !== "public" ? pgSchema(databaseSchema) : undefined;
const appPgTable = (appPgSchema ? appPgSchema.table : pgTable) as typeof pgTable;

export const barbersIdSeq = appPgSchema?.sequence("barbers_id_seq");
export const servicesIdSeq = appPgSchema?.sequence("services_id_seq");
export const serviceCategoriesIdSeq = appPgSchema?.sequence("service_categories_id_seq");
export const appointmentsIdSeq = appPgSchema?.sequence("appointments_id_seq");
export const adminsIdSeq = appPgSchema?.sequence("admins_id_seq");
export const blacklistIdSeq = appPgSchema?.sequence("blacklist_id_seq");
export const verificationCodesIdSeq = appPgSchema?.sequence("verification_codes_id_seq");
export const shopAvailabilityIdSeq = appPgSchema?.sequence("shop_availability_id_seq");
export const barberAvailabilityIdSeq = appPgSchema?.sequence("barber_availability_id_seq");
export const barberInvitesIdSeq = appPgSchema?.sequence("barber_invites_id_seq");
export const customerNotesIdSeq = appPgSchema?.sequence("customer_notes_id_seq");
export const auditLogsIdSeq = appPgSchema?.sequence("audit_logs_id_seq");
export const barberCompensationRulesIdSeq = appPgSchema?.sequence("barber_compensation_rules_id_seq");
export const businessExpensesIdSeq = appPgSchema?.sequence("business_expenses_id_seq");
export const businessExpenseRecurringSeriesIdSeq = appPgSchema?.sequence("business_expense_recurring_series_id_seq");
export const businessExpenseRecurringVersionsIdSeq = appPgSchema?.sequence("business_expense_recurring_versions_id_seq");
export const businessExpenseRecurringPausesIdSeq = appPgSchema?.sequence("business_expense_recurring_pauses_id_seq");
export const whatsappMessagesIdSeq = appPgSchema?.sequence("whatsapp_messages_id_seq");
export const appointmentNotificationEventsIdSeq = appPgSchema?.sequence("appointment_notification_events_id_seq");
export const metaWebhookReceiptsIdSeq = appPgSchema?.sequence("meta_webhook_receipts_id_seq");
export const locationsIdSeq = appPgSchema?.sequence("locations_id_seq");
export const extraDefinitionsIdSeq = appPgSchema?.sequence("extra_definitions_id_seq");
export const usersIdSeq = appPgSchema?.sequence("users_id_seq");
export const userAccessScopesIdSeq = appPgSchema?.sequence("user_access_scopes_id_seq");
export const userInvitesIdSeq = appPgSchema?.sequence("user_invites_id_seq");

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

export const appointmentPaymentMethods = [
  "pending",
  "cash",
  "card",
  "voucher",
  "gift",
] as const;

export const userStatuses = ["invited", "active", "disabled"] as const;

export const barberCompensationModels = [
  "none",
  "commission",
  "chair_rent",
] as const;

export const chairRentPeriods = [
  "day",
  "week",
  "month",
] as const;

export const businessExpenseCategories = [
  "rent",
  "utilities",
  "internet",
  "materials",
  "equipment",
  "marketing",
  "accounting",
  "staff",
  "other",
] as const;

export const businessExpenseRecurrences = [
  "once",
  "weekly",
  "monthly",
] as const;

export const businessExpenseRecurringStatuses = [
  "active",
  "paused",
  "ended",
] as const;

export const extraFinancialRules = [
  "follow_compensation",
  "barber",
  "establishment",
] as const;

export const extraPricingModes = [
  "fixed",
  "variable",
] as const;

export const whatsappMessageStatuses = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "unknown",
] as const;

export const whatsappMessageTypes = [
  "booking_confirmation",
  "booking_cancellation",
  "provider_test",
] as const;

export type RecurringNotificationSnapshot = {
  schemaVersion: 1;
  seriesId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  whatsappOptIn: boolean;
  location: { id: number; name: string; address: string; timezone: string };
  service: { id: number; name: string };
  barber: { id: number; name: string };
  recurrence: { intervalWeeks: number; durationMonths: number; occurrenceCount: number };
  occurrences: Array<{ appointmentId: number; occurrenceIndex: number; startTime: string }>;
};

export const locations = appPgTable("locations", {
  id: idColumn("locations_id_seq"),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  address: text("address").notNull().default(""),
  logoUrl: text("logo_url"),
  mapUrl: text("map_url"),
  mapEmbedUrl: text("map_embed_url"),
  phone: text("phone"),
  email: text("email"),
  timezone: text("timezone").notNull().default("Europe/Lisbon"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Canonical login identity. Legacy admins/barbers remain authoritative until auth cutover. */
export const users = appPgTable("users", {
  id: idColumn("users_id_seq"),
  displayName: text("display_name").notNull(),
  username: text("username"),
  usernameKey: text("username_key").generatedAlwaysAs(sql`lower(btrim(username))`),
  email: text("email").notNull(),
  emailKey: text("email_key").notNull().generatedAlwaysAs(sql`lower(btrim(email))`),
  passwordHash: text("password_hash"),
  status: text("status", { enum: userStatuses }).notNull().default("invited"),
  authVersion: integer("auth_version").notNull().default(1),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  displayNameNotBlankCheck: check("users_display_name_not_blank_check", sql`btrim(${table.displayName}) <> ''`),
  emailNotBlankCheck: check("users_email_not_blank_check", sql`btrim(${table.email}) <> ''`),
  usernameNotBlankCheck: check("users_username_not_blank_check", sql`${table.username} IS NULL OR btrim(${table.username}) <> ''`),
  statusCheck: check("users_status_check", sql`${table.status} IN ('invited', 'active', 'disabled')`),
  authVersionCheck: check("users_auth_version_check", sql`${table.authVersion} > 0`),
  passwordStateCheck: check("users_password_state_check", sql`
    (${table.status} = 'active' AND ${table.passwordHash} IS NOT NULL AND btrim(${table.passwordHash}) <> '')
    OR (${table.status} IN ('invited', 'disabled') AND (${table.passwordHash} IS NULL OR btrim(${table.passwordHash}) <> ''))
  `),
  timestampsCheck: check("users_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  emailKeyUnique: uniqueIndex("users_email_key_unique").on(table.emailKey),
  usernameKeyUnique: uniqueIndex("users_username_key_unique")
    .on(table.usernameKey)
    .where(sql`${table.usernameKey} IS NOT NULL`),
}));

export const barbers = appPgTable("barbers", {
  id: idColumn("barbers_id_seq"),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  bio: text("bio"),
  avatar: text("avatar"),
  email: text("email").unique(),
  password: text("password"),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  color: text("color").notNull().default("#D4AF37"),
  isVisible: boolean("is_visible").default(true),
}, (table) => ({
  userIdUnique: uniqueIndex("barbers_user_id_unique")
    .on(table.userId)
    .where(sql`${table.userId} IS NOT NULL`),
}));

export const serviceCategories = appPgTable("service_categories", {
  id: idColumn("service_categories_id_seq"),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  sortOrderCheck: check("service_categories_sort_order_check", sql`${table.sortOrder} >= 0`),
  nameNotBlankCheck: check("service_categories_name_not_blank_check", sql`btrim(${table.name}) <> ''`),
}));

export const services = appPgTable("services", {
  id: idColumn("services_id_seq"),
  name: text("name").notNull(),
  description: text("description"),
  agendaLabel: text("agenda_label"),
  price: integer("price").notNull(),
  duration: integer("duration").notNull(),
  isVisible: boolean("is_visible").default(true),
  categoryId: integer("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
});

export const appointmentSeries = appPgTable("appointment_series", {
  id: text("id").primaryKey(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  serviceId: integer("service_id").references(() => services.id).notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone").notNull(),
  whatsappOptIn: boolean("whatsapp_opt_in").default(false).notNull(),
  whatsappOptInAt: timestamp("whatsapp_opt_in_at"),
  intervalWeeks: integer("interval_weeks").notNull(),
  durationMonths: integer("duration_months").notNull(),
  occurrenceCount: integer("occurrence_count").notNull(),
  firstStartTime: timestamp("first_start_time").notNull(),
  notificationRevision: integer("notification_revision").default(1).notNull(),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  recurrenceValuesCheck: check("appointment_series_recurrence_values_check",
    sql`${table.intervalWeeks} > 0 AND ${table.durationMonths} > 0 AND ${table.occurrenceCount} > 1`),
  notificationRevisionCheck: check("appointment_series_notification_revision_check", sql`${table.notificationRevision} > 0`),
}));

export const appointments = appPgTable("appointments", {
  id: idColumn("appointments_id_seq"),
  locationId: integer("location_id").references(() => locations.id).notNull().default(1),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  serviceId: integer("service_id").references(() => services.id),
  startTime: timestamp("start_time").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone").notNull(),
  durationMinutes: integer("duration_minutes").default(30).notNull(),
  serviceNameSnapshot: text("service_name_snapshot"),
  servicePriceCentsSnapshot: integer("service_price_cents_snapshot"),
  compensationRuleIdSnapshot: integer("compensation_rule_id_snapshot"),
  compensationModelSnapshot: text("compensation_model_snapshot", { enum: barberCompensationModels }),
  commissionPercentSnapshot: integer("commission_percent_snapshot"),
  chairRentCentsSnapshot: integer("chair_rent_cents_snapshot"),
  chairRentPeriodSnapshot: text("chair_rent_period_snapshot", { enum: chairRentPeriods }),
  manualOutsideHours: boolean("manual_outside_hours").default(false).notNull(),
  status: text("status", { enum: appointmentStatuses }).default("booked").notNull(),
  cancelToken: text("cancel_token").notNull(),
  cancelledAt: timestamp("cancelled_at"),
  paymentMethod: text("payment_method", { enum: appointmentPaymentMethods }).default("pending").notNull(),
  depositRequired: boolean("deposit_required").default(false).notNull(),
  depositReason: text("deposit_reason"),
  rescheduleRevision: integer("reschedule_revision").default(0).notNull(),
  notificationRevision: integer("notification_revision").default(0).notNull(),
  whatsappOptIn: boolean("whatsapp_opt_in").default(false).notNull(),
  whatsappOptInAt: timestamp("whatsapp_opt_in_at"),
  seriesId: text("series_id").references(() => appointmentSeries.id),
  seriesOccurrenceIndex: integer("series_occurrence_index"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  seriesOccurrenceIdx: uniqueIndex("appointments_series_occurrence_idx").on(table.seriesId, table.seriesOccurrenceIndex),
  compensationRuleSnapshotFk: foreignKey({
    name: "appointments_compensation_rule_snapshot_fkey",
    columns: [table.compensationRuleIdSnapshot, table.barberId, table.locationId],
    foreignColumns: [barberCompensationRules.id, barberCompensationRules.barberId, barberCompensationRules.locationId],
  }).onDelete("restrict"),
  serviceSnapshotPairCheck: check("appointments_service_snapshot_pair_check", sql`
    (${table.serviceNameSnapshot} IS NULL AND ${table.servicePriceCentsSnapshot} IS NULL)
    OR (${table.serviceNameSnapshot} IS NOT NULL AND ${table.servicePriceCentsSnapshot} IS NOT NULL)
  `),
  serviceNameSnapshotCheck: check("appointments_service_name_snapshot_check", sql`
    ${table.serviceNameSnapshot} IS NULL
    OR (btrim(${table.serviceNameSnapshot}) <> '' AND char_length(${table.serviceNameSnapshot}) <= 100)
  `),
  servicePriceSnapshotCheck: check("appointments_service_price_snapshot_check", sql`
    ${table.servicePriceCentsSnapshot} IS NULL
    OR (${table.servicePriceCentsSnapshot} >= 0 AND ${table.servicePriceCentsSnapshot} <= 1000000)
  `),
  compensationSnapshotCheck: check("appointments_compensation_snapshot_check", sql`
    ((${table.compensationModelSnapshot} IS NULL
      AND ${table.compensationRuleIdSnapshot} IS NULL
      AND ${table.commissionPercentSnapshot} IS NULL
      AND ${table.chairRentCentsSnapshot} IS NULL
      AND ${table.chairRentPeriodSnapshot} IS NULL)
    OR (${table.compensationModelSnapshot} = 'none'
      AND ${table.commissionPercentSnapshot} IS NULL
      AND ${table.chairRentCentsSnapshot} IS NULL
      AND ${table.chairRentPeriodSnapshot} IS NULL)
    OR (${table.compensationModelSnapshot} = 'commission'
      AND ${table.compensationRuleIdSnapshot} IS NOT NULL
      AND ${table.commissionPercentSnapshot} BETWEEN 0 AND 100
      AND ${table.chairRentCentsSnapshot} IS NULL
      AND ${table.chairRentPeriodSnapshot} IS NULL)
    OR (${table.compensationModelSnapshot} = 'chair_rent'
      AND ${table.compensationRuleIdSnapshot} IS NOT NULL
      AND ${table.commissionPercentSnapshot} IS NULL
      AND ${table.chairRentCentsSnapshot} > 0
      AND ${table.chairRentPeriodSnapshot} IN ('day', 'week', 'month'))
    ) IS TRUE
  `),
}));

export const extraDefinitions = appPgTable("extra_definitions", {
  id: idColumn("extra_definitions_id_seq"),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }).notNull(),
  name: text("name").notNull(),
  pricingMode: text("pricing_mode", { enum: extraPricingModes }).notNull(),
  amountCents: integer("amount_cents"),
  financialRule: text("financial_rule", { enum: extraFinancialRules }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  locationNameIdx: uniqueIndex("extra_definitions_location_name_ci_idx")
    .on(table.locationId, sql`lower(btrim(${table.name}))`),
  locationActiveOrderIdx: index("extra_definitions_location_active_order_idx")
    .on(table.locationId, table.isActive, table.sortOrder, table.id),
  nameCheck: check("extra_definitions_name_check",
    sql`btrim(${table.name}) <> '' AND char_length(${table.name}) <= 100`),
  pricingModeCheck: check("extra_definitions_pricing_mode_check",
    sql`${table.pricingMode} IN ('fixed', 'variable')`),
  pricingAmountCheck: check("extra_definitions_pricing_amount_check", sql`
    (${table.pricingMode} = 'fixed' AND ${table.amountCents} IS NOT NULL AND ${table.amountCents} > 0 AND ${table.amountCents} <= 1000000)
    OR (${table.pricingMode} = 'variable' AND ${table.amountCents} IS NULL)
  `),
  financialRuleCheck: check("extra_definitions_financial_rule_check",
    sql`${table.financialRule} IN ('follow_compensation', 'barber', 'establishment')`),
  sortOrderCheck: check("extra_definitions_sort_order_check", sql`${table.sortOrder} >= 0`),
}));

export const appointmentExtras = appPgTable("appointment_extras", {
  appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "cascade" }).notNull(),
  extraDefinitionId: integer("extra_definition_id").references(() => extraDefinitions.id, { onDelete: "restrict" }).notNull(),
  nameSnapshot: text("name_snapshot").notNull(),
  amountCentsSnapshot: integer("amount_cents_snapshot").notNull(),
  financialRuleSnapshot: text("financial_rule_snapshot", { enum: extraFinancialRules }).notNull(),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.appointmentId, table.extraDefinitionId] }),
  appointmentPositionIdx: uniqueIndex("appointment_extras_appointment_position_unique")
    .on(table.appointmentId, table.position),
  definitionIdx: index("appointment_extras_extra_definition_id_idx")
    .on(table.extraDefinitionId, table.appointmentId),
  nameSnapshotCheck: check("appointment_extras_name_snapshot_check",
    sql`btrim(${table.nameSnapshot}) <> '' AND char_length(${table.nameSnapshot}) <= 100`),
  amountCentsSnapshotCheck: check("appointment_extras_amount_cents_snapshot_check",
    sql`${table.amountCentsSnapshot} > 0 AND ${table.amountCentsSnapshot} <= 1000000`),
  financialRuleSnapshotCheck: check("appointment_extras_financial_rule_snapshot_check",
    sql`${table.financialRuleSnapshot} IN ('follow_compensation', 'barber', 'establishment')`),
  positionCheck: check("appointment_extras_position_check", sql`${table.position} >= 0`),
}));

export const admins = appPgTable("admins", {
  id: idColumn("admins_id_seq"),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  password: text("password").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
}, (table) => ({
  userIdUnique: uniqueIndex("admins_user_id_unique")
    .on(table.userId)
    .where(sql`${table.userId} IS NOT NULL`),
}));

/** Presets remain code-owned; scopes persist only a known key plus optional explicit grants. */
export const userAccessScopes = appPgTable("user_access_scopes", {
  id: idColumn("user_access_scopes_id_seq"),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
  presetKey: text("preset_key", { enum: accessPresetKeys }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  presetKeyCheck: check("user_access_scopes_preset_key_check",
    sql`${table.presetKey} IS NULL OR ${table.presetKey} IN ('administrator', 'professional')`),
  administratorGlobalCheck: check("user_access_scopes_administrator_global_check",
    sql`${table.presetKey} IS DISTINCT FROM 'administrator' OR ${table.locationId} IS NULL`),
  timestampsCheck: check("user_access_scopes_timestamps_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  globalScopeUnique: uniqueIndex("user_access_scopes_global_unique")
    .on(table.userId)
    .where(sql`${table.locationId} IS NULL`),
  locationScopeUnique: uniqueIndex("user_access_scopes_location_unique")
    .on(table.userId, table.locationId)
    .where(sql`${table.locationId} IS NOT NULL`),
}));

const capabilitySqlList = sql.raw(capabilityCodes.map((code) => `'${code}'`).join(", "));

export const userAccessScopeCapabilities = appPgTable("user_access_scope_capabilities", {
  accessScopeId: integer("access_scope_id")
    .references(() => userAccessScopes.id, { onDelete: "cascade" })
    .notNull(),
  capabilityCode: text("capability_code").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.accessScopeId, table.capabilityCode] }),
  capabilityCodeCheck: check("user_access_scope_capabilities_code_check",
    sql`${table.capabilityCode} IN (${capabilitySqlList})`),
}));

export const userInvites = appPgTable("user_invites", {
  id: idColumn("user_invites_id_seq"),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenDigest: text("token_digest").notNull(),
  invitedByUserId: integer("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tokenDigestUnique: uniqueIndex("user_invites_token_digest_unique").on(table.tokenDigest),
  userIdx: index("user_invites_user_idx").on(table.userId, table.createdAt),
  tokenDigestNotBlankCheck: check("user_invites_token_digest_not_blank_check", sql`btrim(${table.tokenDigest}) <> ''`),
  expiryCheck: check("user_invites_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  terminalStateCheck: check("user_invites_terminal_state_check",
    sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`),
  acceptedAtCheck: check("user_invites_accepted_at_check",
    sql`${table.acceptedAt} IS NULL OR ${table.acceptedAt} >= ${table.createdAt}`),
  revokedAtCheck: check("user_invites_revoked_at_check",
    sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`),
}));

export const blacklist = appPgTable("blacklist", {
  id: idColumn("blacklist_id_seq"),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }).notNull(),
  email: text("email"),
  phone: text("phone").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  locationPhoneIdx: index("blacklist_location_phone_idx").on(table.locationId, table.phone),
  locationCreatedAtIdx: index("blacklist_location_created_at_idx").on(table.locationId, table.createdAt),
}));

export const verificationCodes = appPgTable("verification_codes", {
  id: idColumn("verification_codes_id_seq"),
  phone: text("phone").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
});

export const shopAvailability = appPgTable("shop_availability", {
  id: idColumn("shop_availability_id_seq"),
  locationId: integer("location_id").references(() => locations.id).notNull().default(1),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isOpen: boolean("is_open").default(true).notNull(),
});

export const barberAvailability = appPgTable("barber_availability", {
  id: idColumn("barber_availability_id_seq"),
  locationId: integer("location_id").references(() => locations.id).notNull().default(1),
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  isWorking: boolean("is_working").default(true).notNull(),
});

export const barberLocations = appPgTable("barber_locations", {
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.barberId, table.locationId] }),
}));

export const serviceLocations = appPgTable("service_locations", {
  serviceId: integer("service_id").references(() => services.id).notNull(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  priceOverride: integer("price_override"),
  durationOverride: integer("duration_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.serviceId, table.locationId] }),
  priceOverrideCheck: check(
    "service_locations_price_override_check",
    sql`${table.priceOverride} IS NULL OR ${table.priceOverride} >= 0`,
  ),
  durationOverrideCheck: check(
    "service_locations_duration_override_check",
    sql`${table.durationOverride} IS NULL OR ${table.durationOverride} > 0`,
  ),
}));

export const barberServices = appPgTable("barber_services", {
  barberId: integer("barber_id").references(() => barbers.id).notNull(),
  serviceId: integer("service_id").references(() => services.id).notNull(),
  locationId: integer("location_id").references(() => locations.id).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.barberId, table.serviceId, table.locationId] }),
  barberLocationFk: foreignKey({
    name: "barber_services_barber_location_fkey",
    columns: [table.barberId, table.locationId],
    foreignColumns: [barberLocations.barberId, barberLocations.locationId],
  }).onDelete("cascade"),
  serviceLocationFk: foreignKey({
    name: "barber_services_service_location_fkey",
    columns: [table.serviceId, table.locationId],
    foreignColumns: [serviceLocations.serviceId, serviceLocations.locationId],
  }).onDelete("cascade"),
  locationBarberIdx: index("barber_services_location_barber_idx")
    .on(table.locationId, table.barberId, table.serviceId),
  locationServiceIdx: index("barber_services_location_service_idx")
    .on(table.locationId, table.serviceId, table.barberId),
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
  locationId: integer("location_id").references(() => locations.id).notNull(),
  phone: text("phone"),
  customerNameKey: text("customer_name_key").notNull().default(""),
  email: text("email"),
  emailKey: text("email_key"),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  customerNotesIdentityIdx: uniqueIndex("customer_notes_location_phone_name_idx")
    .on(table.locationId, table.phone, table.customerNameKey)
    .where(sql`${table.phone} IS NOT NULL`),
  customerNotesEmailIdentityIdx: uniqueIndex("customer_notes_location_email_name_idx")
    .on(table.locationId, table.emailKey, table.customerNameKey)
    .where(sql`${table.emailKey} IS NOT NULL`),
  customerNotesContactRequiredCheck: check(
    "customer_notes_contact_required_check",
    sql`(${table.phone} IS NOT NULL AND btrim(${table.phone}) <> '') OR (${table.emailKey} IS NOT NULL AND btrim(${table.emailKey}) <> '')`,
  ),
  customerNotesPhoneNonemptyCheck: check(
    "customer_notes_phone_nonempty_check",
    sql`${table.phone} IS NULL OR btrim(${table.phone}) <> ''`,
  ),
  customerNotesEmailKeyNormalizedCheck: check(
    "customer_notes_email_key_normalized_check",
    sql`(((${table.email} IS NULL OR btrim(${table.email}) = '') AND ${table.emailKey} IS NULL) OR (${table.email} IS NOT NULL AND btrim(${table.email}) <> '' AND ${table.emailKey} = lower(btrim(${table.email})) AND ${table.emailKey} <> ''))`,
  ),
}));

export const auditLogs = appPgTable("audit_logs", {
  id: idColumn("audit_logs_id_seq"),
  actorType: text("actor_type").notNull(),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorProfessionalId: integer("actor_professional_id").references(() => barbers.id, { onDelete: "set null" }),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  actorUserIdx: index("audit_logs_actor_user_idx").on(table.actorUserId, table.createdAt),
  actorProfessionalIdx: index("audit_logs_actor_professional_idx").on(table.actorProfessionalId, table.createdAt),
  locationIdx: index("audit_logs_location_idx").on(table.locationId, table.createdAt),
}));

export const barberCompensationRules = appPgTable("barber_compensation_rules", {
  id: idColumn("barber_compensation_rules_id_seq"),
  barberId: integer("barber_id").references(() => barbers.id, { onDelete: "cascade" }).notNull(),
  locationId: integer("location_id").notNull(),
  model: text("model", { enum: barberCompensationModels }).default("none").notNull(),
  commissionPercent: integer("commission_percent"),
  chairRentCents: integer("chair_rent_cents"),
  chairRentPeriod: text("chair_rent_period", { enum: chairRentPeriods }),
  effectiveFrom: timestamp("effective_from").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  barberLocationFk: foreignKey({
    name: "barber_compensation_rules_barber_location_fkey",
    columns: [table.barberId, table.locationId],
    foreignColumns: [barberLocations.barberId, barberLocations.locationId],
  }).onDelete("restrict"),
  effectiveUnique: uniqueIndex("barber_compensation_rules_barber_location_effective_uidx")
    .on(table.barberId, table.locationId, table.effectiveFrom),
  snapshotIdentityUnique: uniqueIndex("barber_compensation_rules_snapshot_identity_uidx")
    .on(table.id, table.barberId, table.locationId),
  effectiveIdx: index("barber_compensation_rules_barber_location_effective_idx")
    .on(table.barberId, table.locationId, table.effectiveFrom),
  modelCheck: check("barber_compensation_rules_model_check",
    sql`${table.model} IN ('none', 'commission', 'chair_rent')`),
  valuesCheck: check("barber_compensation_rules_values_check", sql`
    ((${table.model} = 'none'
      AND ${table.commissionPercent} IS NULL
      AND ${table.chairRentCents} IS NULL
      AND ${table.chairRentPeriod} IS NULL)
    OR (${table.model} = 'commission'
      AND ${table.commissionPercent} BETWEEN 0 AND 100
      AND ${table.chairRentCents} IS NULL
      AND ${table.chairRentPeriod} IS NULL)
    OR (${table.model} = 'chair_rent'
      AND ${table.commissionPercent} IS NULL
      AND ${table.chairRentCents} > 0
      AND ${table.chairRentPeriod} IN ('day', 'week', 'month'))
    ) IS TRUE
  `),
}));

export const businessExpenseRecurringSeries = appPgTable("business_expense_recurring_series", {
  id: idColumn("business_expense_recurring_series_id_seq"),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "restrict" }).notNull(),
  creationKey: text("creation_key").notNull(),
  status: text("status", { enum: businessExpenseRecurringStatuses }).default("active").notNull(),
  anchorDate: date("anchor_date").notNull(),
  endedOn: date("ended_on"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  locationStatusIdx: index("business_expense_recurring_series_location_status_idx")
    .on(table.locationId, table.status),
  creationKeyUnique: uniqueIndex("business_expense_recurring_series_location_creation_uidx")
    .on(table.locationId, table.creationKey),
  statusCheck: check("business_expense_recurring_series_status_check",
    sql`${table.status} IN ('active', 'paused', 'ended')`),
  endedStateCheck: check("business_expense_recurring_series_ended_state_check", sql`
    ((${table.status} = 'ended' AND ${table.endedOn} IS NOT NULL)
      OR (${table.status} <> 'ended' AND ${table.endedOn} IS NULL)) IS TRUE
  `),
}));

export const businessExpenseRecurringVersions = appPgTable("business_expense_recurring_versions", {
  id: idColumn("business_expense_recurring_versions_id_seq"),
  seriesId: integer("series_id").references(() => businessExpenseRecurringSeries.id, { onDelete: "cascade" }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  category: text("category", { enum: businessExpenseCategories }).notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  recurrence: text("recurrence", { enum: ["weekly", "monthly"] }).notNull(),
  weekday: integer("weekday"),
  monthDay: integer("month_day"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  seriesEffectiveUnique: uniqueIndex("business_expense_recurring_versions_series_effective_uidx")
    .on(table.seriesId, table.effectiveFrom),
  termsCheck: check("business_expense_recurring_versions_terms_check", sql`
    (${table.amountCents} BETWEEN 0 AND 10000000
      AND btrim(${table.description}) <> ''
      AND ((${table.recurrence} = 'weekly' AND ${table.weekday} BETWEEN 0 AND 6 AND ${table.monthDay} IS NULL)
        OR (${table.recurrence} = 'monthly' AND ${table.monthDay} BETWEEN 1 AND 31 AND ${table.weekday} IS NULL))) IS TRUE
  `),
}));

export const businessExpenseRecurringPauses = appPgTable("business_expense_recurring_pauses", {
  id: idColumn("business_expense_recurring_pauses_id_seq"),
  seriesId: integer("series_id").references(() => businessExpenseRecurringSeries.id, { onDelete: "cascade" }).notNull(),
  pausedFrom: date("paused_from").notNull(),
  resumedOn: date("resumed_on"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  openPauseUnique: uniqueIndex("business_expense_recurring_pauses_open_uidx")
    .on(table.seriesId)
    .where(sql`${table.resumedOn} IS NULL`),
  rangeCheck: check("business_expense_recurring_pauses_range_check",
    sql`(${table.resumedOn} IS NULL OR ${table.resumedOn} >= ${table.pausedFrom}) IS TRUE`),
}));

export const businessExpenses = appPgTable("business_expenses", {
  id: idColumn("business_expenses_id_seq"),
  locationId: integer("location_id").references(() => locations.id).notNull().default(1),
  category: text("category", { enum: businessExpenseCategories }).notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  expenseDate: timestamp("expense_date").notNull(),
  recurrence: text("recurrence", { enum: businessExpenseRecurrences }).default("once").notNull(),
  notes: text("notes"),
  recurringSeriesId: integer("recurring_series_id")
    .references(() => businessExpenseRecurringSeries.id, { onDelete: "restrict" }),
  recurringVersionId: integer("recurring_version_id")
    .references(() => businessExpenseRecurringVersions.id, { onDelete: "restrict" }),
  scheduledDate: date("scheduled_date"),
  isOccurrenceOverride: boolean("is_occurrence_override").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  recurringOccurrenceUnique: uniqueIndex("business_expenses_recurring_occurrence_uidx")
    .on(table.recurringSeriesId, table.scheduledDate)
    .where(sql`${table.recurringSeriesId} IS NOT NULL`),
  recurringOccurrenceCheck: check("business_expenses_recurring_occurrence_check", sql`
    (((${table.recurringSeriesId} IS NULL AND ${table.recurringVersionId} IS NULL AND ${table.scheduledDate} IS NULL
        AND ${table.isOccurrenceOverride} = false)
      OR (${table.recurringSeriesId} IS NOT NULL AND ${table.recurringVersionId} IS NOT NULL AND ${table.scheduledDate} IS NOT NULL
        AND ${table.recurrence} IN ('weekly', 'monthly')))) IS TRUE
  `),
}));

export const whatsappMessages = appPgTable("whatsapp_messages", {
  id: idColumn("whatsapp_messages_id_seq"),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  messageType: text("message_type", { enum: whatsappMessageTypes }).notNull(),
  phone: text("phone").notNull(),
  providerMessageId: text("provider_message_id"),
  status: text("status", { enum: whatsappMessageStatuses }).default("pending").notNull(),
  providerStatus: text("provider_status"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  webhookPayload: text("webhook_payload"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  providerMessageIdIdx: uniqueIndex("whatsapp_messages_provider_message_id_idx").on(table.providerMessageId),
}));

export const appointmentNotificationEvents = appPgTable("appointment_notification_events", {
  id: idColumn("appointment_notification_events_id_seq"),
  appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
  seriesId: text("series_id").references(() => appointmentSeries.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventRevision: integer("event_revision").notNull(),
  eventKey: text("event_key").notNull(),
  availableAt: timestamp("available_at").defaultNow().notNull(),
  appointmentStartTime: timestamp("appointment_start_time").notNull(),
  previousStartTime: timestamp("previous_start_time"),
  newStartTime: timestamp("new_start_time"),
  provider: text("provider"),
  templateName: text("template_name"),
  whatsappStatus: text("whatsapp_status").default("pending").notNull(),
  providerMessageId: text("provider_message_id"),
  providerStatus: text("provider_status"),
  responseStatus: integer("response_status"),
  errorCode: text("error_code"),
  processingStartedAt: timestamp("processing_started_at"),
  processingCompletedAt: timestamp("processing_completed_at"),
  whatsappAttemptedAt: timestamp("whatsapp_attempted_at"),
  whatsappAcceptedAt: timestamp("whatsapp_accepted_at"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  failedAt: timestamp("failed_at"),
  lastProviderTimestamp: timestamp("last_provider_timestamp"),
  webhookFallbackClaimedAt: timestamp("webhook_fallback_claimed_at"),
  payloadSnapshot: jsonb("payload_snapshot").$type<RecurringNotificationSnapshot>(),
  emailStatus: text("email_status").default("not_needed").notNull(),
  emailProviderMessageId: text("email_provider_message_id"),
  emailErrorCode: text("email_error_code"),
  emailAttemptedAt: timestamp("email_attempted_at"),
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  eventKeyIdx: uniqueIndex("appointment_notification_events_event_key_idx").on(table.eventKey),
  providerMessageIdIdx: uniqueIndex("appointment_notification_events_provider_message_id_idx").on(table.providerMessageId),
  duePendingIdx: index("appointment_notification_events_due_pending_idx")
    .on(table.availableAt, table.id)
    .where(sql`${table.processingCompletedAt} IS NULL`),
  subjectCheck: check("appointment_notification_events_subject_check", sql`num_nonnulls(${table.appointmentId}, ${table.seriesId}) = 1`),
}));

export const metaWebhookReceipts = appPgTable("meta_webhook_receipts", {
  id: idColumn("meta_webhook_receipts_id_seq"),
  receiptKey: text("receipt_key").notNull(),
  providerMessageId: text("provider_message_id").notNull(),
  status: text("status").notNull(),
  providerTimestamp: timestamp("provider_timestamp"),
  errorCode: text("error_code"),
  wabaId: text("waba_id").notNull(),
  phoneNumberId: text("phone_number_id").notNull(),
  notificationEventId: integer("notification_event_id").references(() => appointmentNotificationEvents.id, { onDelete: "set null" }),
  payloadSummary: text("payload_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  receiptKeyIdx: uniqueIndex("meta_webhook_receipts_receipt_key_idx").on(table.receiptKey),
}));

// === RELATIONS ===

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  barber: one(barbers, {
    fields: [appointments.barberId],
    references: [barbers.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
  series: one(appointmentSeries, {
    fields: [appointments.seriesId],
    references: [appointmentSeries.id],
  }),
  extras: many(appointmentExtras),
}));

export const extraDefinitionsRelations = relations(extraDefinitions, ({ one, many }) => ({
  location: one(locations, {
    fields: [extraDefinitions.locationId],
    references: [locations.id],
  }),
  appointmentExtras: many(appointmentExtras),
}));

export const appointmentExtrasRelations = relations(appointmentExtras, ({ one }) => ({
  appointment: one(appointments, {
    fields: [appointmentExtras.appointmentId],
    references: [appointments.id],
  }),
  definition: one(extraDefinitions, {
    fields: [appointmentExtras.extraDefinitionId],
    references: [extraDefinitions.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  legacyAdmin: one(admins, {
    fields: [users.id],
    references: [admins.userId],
  }),
  professional: one(barbers, {
    fields: [users.id],
    references: [barbers.userId],
  }),
  accessScopes: many(userAccessScopes),
  invites: many(userInvites, { relationName: "invitedUser" }),
  sentInvites: many(userInvites, { relationName: "invitingUser" }),
}));

export const adminsRelations = relations(admins, ({ one }) => ({
  user: one(users, {
    fields: [admins.userId],
    references: [users.id],
  }),
}));

export const userAccessScopesRelations = relations(userAccessScopes, ({ one, many }) => ({
  user: one(users, {
    fields: [userAccessScopes.userId],
    references: [users.id],
  }),
  location: one(locations, {
    fields: [userAccessScopes.locationId],
    references: [locations.id],
  }),
  capabilities: many(userAccessScopeCapabilities),
}));

export const userAccessScopeCapabilitiesRelations = relations(userAccessScopeCapabilities, ({ one }) => ({
  scope: one(userAccessScopes, {
    fields: [userAccessScopeCapabilities.accessScopeId],
    references: [userAccessScopes.id],
  }),
}));

export const userInvitesRelations = relations(userInvites, ({ one }) => ({
  user: one(users, {
    relationName: "invitedUser",
    fields: [userInvites.userId],
    references: [users.id],
  }),
  invitedBy: one(users, {
    relationName: "invitingUser",
    fields: [userInvites.invitedByUserId],
    references: [users.id],
  }),
}));

export const barbersRelations = relations(barbers, ({ one, many }) => ({
  user: one(users, {
    fields: [barbers.userId],
    references: [users.id],
  }),
  appointments: many(appointments),
  serviceAssignments: many(barberServices),
  compensationRules: many(barberCompensationRules),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [services.categoryId],
    references: [serviceCategories.id],
  }),
  appointments: many(appointments),
  barberAssignments: many(barberServices),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  services: many(services),
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
  location: one(locations, {
    fields: [barberServices.locationId],
    references: [locations.id],
  }),
}));

export const barberCompensationRulesRelations = relations(barberCompensationRules, ({ one }) => ({
  barber: one(barbers, {
    fields: [barberCompensationRules.barberId],
    references: [barbers.id],
  }),
  location: one(locations, {
    fields: [barberCompensationRules.locationId],
    references: [locations.id],
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
  categoryId: z.number().int().positive().nullable().optional(),
});
export const insertServiceCategorySchema = createInsertSchema(serviceCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().trim().min(1, "Indique o nome da categoria.").max(80, "O nome não pode ter mais de 80 caracteres."),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
const extraDefinitionInputFields = {
  locationId: z.number().int().positive(),
  name: z.string().trim().min(1, "Indique o nome do Extra.").max(100, "O nome não pode ter mais de 100 caracteres."),
  pricingMode: z.enum(extraPricingModes),
  amountCents: z.number().int("O valor deve ser indicado em cêntimos.").nullable().optional(),
  financialRule: z.enum(extraFinancialRules),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(2_147_483_647, "A ordem indicada é demasiado elevada.").optional(),
};
export const insertExtraDefinitionSchema = z.object(extraDefinitionInputFields).superRefine((input, context) => {
  if (input.pricingMode !== "fixed") return;
  if (input.amountCents === undefined || input.amountCents === null || input.amountCents <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "O valor deve ser superior a zero para um Extra de valor fixo.",
    });
  } else if (input.amountCents > 1_000_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountCents"],
      message: "O valor indicado é demasiado elevado.",
    });
  }
}).transform((input) => ({
  ...input,
  amountCents: input.pricingMode === "variable" ? null : input.amountCents!,
}));
export const updateExtraDefinitionSchema = z.object({
  name: extraDefinitionInputFields.name.optional(),
  pricingMode: extraDefinitionInputFields.pricingMode.optional(),
  amountCents: extraDefinitionInputFields.amountCents,
  financialRule: extraDefinitionInputFields.financialRule.optional(),
  isActive: extraDefinitionInputFields.isActive,
  sortOrder: extraDefinitionInputFields.sortOrder,
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
  locationId: true,
  createdAt: true,
  status: true,
  cancelToken: true,
  cancelledAt: true,
  paymentMethod: true,
  durationMinutes: true,
  serviceNameSnapshot: true,
  servicePriceCentsSnapshot: true,
  manualOutsideHours: true,
  depositRequired: true,
  depositReason: true,
  rescheduleRevision: true,
  notificationRevision: true,
  whatsappOptInAt: true,
  seriesId: true,
  seriesOccurrenceIndex: true,
}).extend({
  customerName: z.string().trim().min(1, "Indique o nome.").max(80, "O nome não pode ter mais de 80 caracteres."),
  customerEmail: z.string().trim().email("Indique um email válido.").max(120, "O email não pode ter mais de 120 caracteres.").optional().nullable(),
  customerPhone: bookingPhoneSchema,
  whatsappOptIn: z.boolean().optional().default(false),
});
export const insertAdminSchema = createInsertSchema(admins).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertUserAccessScopeSchema = createInsertSchema(userAccessScopes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertUserAccessScopeCapabilitySchema = createInsertSchema(userAccessScopeCapabilities);
export const insertUserInviteSchema = createInsertSchema(userInvites).omit({ id: true, createdAt: true });
export const insertBlacklistSchema = createInsertSchema(blacklist).omit({ id: true, createdAt: true });
export const insertShopAvailabilitySchema = createInsertSchema(shopAvailability).omit({ id: true });
export const insertBarberAvailabilitySchema = createInsertSchema(barberAvailability).omit({ id: true });
export const insertBarberServiceSchema = createInsertSchema(barberServices);
export const insertBarberInviteSchema = createInsertSchema(barberInvites).omit({ id: true, createdAt: true });
export const insertCustomerNoteSchema = createInsertSchema(customerNotes).omit({
  id: true,
  emailKey: true,
  createdAt: true,
  updatedAt: true,
}).superRefine((note, context) => {
  if (!note.phone?.trim() && !note.email?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Indique um telemóvel ou email.",
      path: ["phone"],
    });
  }
});
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertBarberCompensationRuleSchema = createInsertSchema(barberCompensationRules).omit({
  id: true,
  createdAt: true,
});
export const insertBusinessExpenseRecurringSeriesSchema = createInsertSchema(businessExpenseRecurringSeries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertBusinessExpenseRecurringVersionSchema = createInsertSchema(businessExpenseRecurringVersions).omit({
  id: true,
  createdAt: true,
});
export const insertBusinessExpenseSchema = createInsertSchema(businessExpenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  description: z.string().trim().min(1, "Indique a descricao da despesa.").max(160, "A descricao nao pode ter mais de 160 caracteres."),
  amountCents: z.number().int("O valor deve ser indicado em centimos.").min(0, "O valor nao pode ser negativo.").max(10_000_000, "O valor indicado e demasiado elevado."),
  notes: z.string().trim().max(500, "As notas nao podem ter mais de 500 caracteres.").optional().nullable(),
});
export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// === EXPLICIT API CONTRACT TYPES ===

export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type ServiceLocationOffer = typeof serviceLocations.$inferSelect;
export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type ServiceCategorySummary = Pick<ServiceCategory, "id" | "name" | "sortOrder">;
export type ServiceCatalogueItem = Omit<Service, "categoryId"> & {
  categoryId?: number | null;
  category?: ServiceCategorySummary | null;
  locationId?: number;
  isActive?: boolean;
  priceOverride?: number | null;
  durationOverride?: number | null;
  basePrice?: number;
  baseDuration?: number;
  baseIsVisible?: boolean | null;
};
export type Appointment = typeof appointments.$inferSelect;
export type AppointmentSeries = typeof appointmentSeries.$inferSelect;
export type ExtraDefinition = typeof extraDefinitions.$inferSelect;
export type AppointmentExtra = typeof appointmentExtras.$inferSelect;
export type ExtraFinancialRule = typeof extraFinancialRules[number];
export type ExtraPricingMode = typeof extraPricingModes[number];
export type AppointmentStatus = typeof appointmentStatuses[number];
export type AppointmentPaymentMethod = typeof appointmentPaymentMethods[number];
export type Admin = typeof admins.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserAccessScope = typeof userAccessScopes.$inferSelect;
export type UserAccessScopeCapability = typeof userAccessScopeCapabilities.$inferSelect;
export type UserInvite = typeof userInvites.$inferSelect;
export type Blacklist = typeof blacklist.$inferSelect;
export type ShopAvailability = typeof shopAvailability.$inferSelect;
export type BarberAvailability = typeof barberAvailability.$inferSelect;
export type BarberService = typeof barberServices.$inferSelect;
export type BarberInvite = typeof barberInvites.$inferSelect;
export type CustomerNote = typeof customerNotes.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type BarberCompensationRule = typeof barberCompensationRules.$inferSelect;
export type BusinessExpenseRecurringSeries = typeof businessExpenseRecurringSeries.$inferSelect;
export type BusinessExpenseRecurringVersion = typeof businessExpenseRecurringVersions.$inferSelect;
export type BusinessExpenseRecurringPause = typeof businessExpenseRecurringPauses.$inferSelect;
export type BusinessExpense = typeof businessExpenses.$inferSelect;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type AppointmentNotificationEvent = typeof appointmentNotificationEvents.$inferSelect;
export type MetaWebhookReceipt = typeof metaWebhookReceipts.$inferSelect;
export type BarberCompensationModel = typeof barberCompensationModels[number];
export type ChairRentPeriod = typeof chairRentPeriods[number];
export type BusinessExpenseCategory = typeof businessExpenseCategories[number];
export type BusinessExpenseRecurrence = typeof businessExpenseRecurrences[number];
export type BusinessExpenseRecurringStatus = typeof businessExpenseRecurringStatuses[number];
export type WhatsappMessageStatus = typeof whatsappMessageStatuses[number];
export type WhatsappMessageType = typeof whatsappMessageTypes[number];

export type BarberWithServices = Barber & {
  serviceIds: number[];
  allServicesAllowed?: boolean;
  locationCount?: number;
  compensationModel?: BarberCompensationModel;
  commissionPercent?: number | null;
  chairRentCents?: number | null;
  chairRentPeriod?: ChairRentPeriod | null;
};

export type CreateBarberRequest = z.infer<typeof insertBarberSchema>;
export type CreateServiceRequest = z.infer<typeof insertServiceSchema>;
export type CreateServiceCategoryRequest = z.infer<typeof insertServiceCategorySchema>;
export type CreateExtraDefinitionRequest = z.infer<typeof insertExtraDefinitionSchema>;
export type UpdateExtraDefinitionRequest = z.infer<typeof updateExtraDefinitionSchema>;
export type CreateAppointmentRequest = z.infer<typeof insertAppointmentSchema>;
export type CreateAdminRequest = z.infer<typeof insertAdminSchema>;
export type InsertBlacklist = z.infer<typeof insertBlacklistSchema>;
export type CreateShopAvailabilityRequest = z.infer<typeof insertShopAvailabilitySchema>;
export type CreateBarberAvailabilityRequest = z.infer<typeof insertBarberAvailabilitySchema>;
export type CreateBarberServiceRequest = z.infer<typeof insertBarberServiceSchema>;
export type CreateBarberInviteRequest = z.infer<typeof insertBarberInviteSchema>;
export type CreateCustomerNoteRequest = z.infer<typeof insertCustomerNoteSchema>;
export type CreateAuditLogRequest = z.infer<typeof insertAuditLogSchema>;
export type CreateBarberCompensationRuleRequest = z.infer<typeof insertBarberCompensationRuleSchema>;
export type CreateBusinessExpenseRequest = z.infer<typeof insertBusinessExpenseSchema>;
export type CreateWhatsappMessageRequest = z.infer<typeof insertWhatsappMessageSchema>;

export type AppointmentWithDetails = Appointment & {
  barber: Barber;
  service: Service;
};
