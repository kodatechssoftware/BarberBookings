import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-startup-overlap-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "startup-overlap-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});

let testPool: pg.Pool | undefined;
let applicationPool: pg.Pool | undefined;
try {
  await embedded.initialise();
  await embedded.start();
  const databaseUrl = `postgresql://postgres:startup-overlap-test@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_MAX = "2";
  process.env.USE_MEMORY_STORAGE = "false";
  testPool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await testPool.query("CREATE EXTENSION IF NOT EXISTS btree_gist");

  const legacySchema = "startup_overlap_legacy";
  const currentSchema = "startup_overlap_current";
  const brokenSchema = "startup_overlap_broken";
  const table = (schema: string, name: string) => `"${schema}"."${name}"`;
  const createAppointments = (schema: string) => `
    CREATE TABLE ${table(schema, "appointments")} (
      id serial PRIMARY KEY,
      barber_id integer NOT NULL,
      start_time timestamp NOT NULL,
      duration_minutes integer NOT NULL,
      buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
      buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'booked'
    )
  `;
  const createOccupancyPeriods = (schema: string) => `
    CREATE TABLE ${table(schema, "appointment_occupancy_periods")} (
      appointment_id integer NOT NULL,
      position integer NOT NULL,
      barber_id integer NOT NULL,
      start_time timestamp NOT NULL,
      end_time timestamp NOT NULL,
      PRIMARY KEY (appointment_id, position)
    )
  `;

  for (const schema of [legacySchema, currentSchema, brokenSchema]) {
    await testPool.query(`CREATE SCHEMA "${schema}"`);
    await testPool.query(createAppointments(schema));
  }
  await testPool.query(createOccupancyPeriods(currentSchema));
  await testPool.query(createOccupancyPeriods(brokenSchema));
  await testPool.query(`
    ALTER TABLE ${table(currentSchema, "appointment_occupancy_periods")}
    ADD CONSTRAINT appointments_no_booked_overlap
    EXCLUDE USING gist (
      barber_id WITH =,
      tsrange(start_time, end_time, '[)') WITH &&
    ) DEFERRABLE INITIALLY DEFERRED
  `);

  const { ensureAppointmentOverlapProtection, pool } = await import("../server/db");
  applicationPool = pool;

  // Pre-0021: a missing legacy constraint is installed exactly as before.
  process.env.DATABASE_SCHEMA = legacySchema;
  await ensureAppointmentOverlapProtection();
  await ensureAppointmentOverlapProtection();
  const legacyConstraints = await testPool.query<{ tableName: string; definition: string }>(`
    SELECT table_info.relname AS "tableName", pg_get_constraintdef(constraint_info.oid) AS definition
    FROM pg_constraint constraint_info
    JOIN pg_class table_info ON table_info.oid = constraint_info.conrelid
    JOIN pg_namespace namespace_info ON namespace_info.oid = table_info.relnamespace
    WHERE namespace_info.nspname = $1
      AND constraint_info.conname = 'appointments_no_booked_overlap'
  `, [legacySchema]);
  assert.equal(legacyConstraints.rowCount, 1);
  assert.equal(legacyConstraints.rows[0].tableName, "appointments");
  assert.match(legacyConstraints.rows[0].definition, /buffer_before_minutes_snapshot/);
  assert.match(legacyConstraints.rows[0].definition, /buffer_after_minutes_snapshot/);

  // Post-0021: the projection constraint is authoritative and reruns are no-ops.
  process.env.DATABASE_SCHEMA = currentSchema;
  await ensureAppointmentOverlapProtection();
  await ensureAppointmentOverlapProtection();
  const currentConstraints = await testPool.query<{ tableName: string; definition: string }>(`
    SELECT table_info.relname AS "tableName", pg_get_constraintdef(constraint_info.oid) AS definition
    FROM pg_constraint constraint_info
    JOIN pg_class table_info ON table_info.oid = constraint_info.conrelid
    JOIN pg_namespace namespace_info ON namespace_info.oid = table_info.relnamespace
    WHERE namespace_info.nspname = $1
      AND constraint_info.conname = 'appointments_no_booked_overlap'
  `, [currentSchema]);
  assert.equal(currentConstraints.rowCount, 1);
  assert.equal(currentConstraints.rows[0].tableName, "appointment_occupancy_periods");
  assert.match(currentConstraints.rows[0].definition, /tsrange\(start_time, end_time/);

  // A partial post-0021 schema must fail closed instead of restoring legacy behavior.
  process.env.DATABASE_SCHEMA = brokenSchema;
  await assert.rejects(
    ensureAppointmentOverlapProtection(),
    /exists without a valid appointments_no_booked_overlap exclusion constraint/,
  );
  const brokenLegacyConstraint = await testPool.query(`
    SELECT 1
    FROM pg_constraint constraint_info
    JOIN pg_class table_info ON table_info.oid = constraint_info.conrelid
    JOIN pg_namespace namespace_info ON namespace_info.oid = table_info.relnamespace
    WHERE namespace_info.nspname = $1
      AND table_info.relname = 'appointments'
      AND constraint_info.conname = 'appointments_no_booked_overlap'
  `, [brokenSchema]);
  assert.equal(brokenLegacyConstraint.rowCount, 0);

  console.log("PASS: overlap startup protection supports pre-0021, post-0021 and fail-closed partial schemas; reruns are idempotent.");
} finally {
  if (applicationPool) await applicationPool.end();
  if (testPool) await testPool.end();
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
}
