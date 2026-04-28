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
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
