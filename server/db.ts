import 'dotenv/config';
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";


const { Pool } = pg;

const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true";
const fallbackMemoryDatabaseUrl = "postgresql://memory:memory@127.0.0.1:1/memory";

if (!process.env.DATABASE_URL && !useMemoryStorage) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || fallbackMemoryDatabaseUrl,
});
export const db = drizzle(pool, { schema });
