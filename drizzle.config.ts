import { defineConfig } from "drizzle-kit";
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const databaseSchema = process.env.DATABASE_SCHEMA?.trim() || "public";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  schemaFilter: [databaseSchema],
  tablesFilter: [
    "admins",
    "appointments",
    "appointment_extras",
    "appointment_notification_events",
    "appointment_series",
    "audit_logs",
    "barber_availability",
    "barber_compensation_rules",
    "barber_invites",
    "barber_locations",
    "barber_services",
    "barbers",
    "blacklist",
    "business_expenses",
    "customer_notes",
    "extra_definitions",
    "locations",
    "meta_webhook_receipts",
    "service_categories",
    "service_locations",
    "services",
    "shop_availability",
    "user_access_scope_capabilities",
    "user_access_scopes",
    "user_invites",
    "users",
    "verification_codes",
    "whatsapp_messages",
  ],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
