import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { stopEmbeddedPostgres } from "../../script/embedded-postgres-lifecycle";
import { runSchemaMigrations } from "../../server/migrations";

process.env.TZ = "UTC";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function runCommand(command: string, args: string[], environment: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}:\n${output}`)));
  });
}

test("multi-service PostgreSQL engine is atomic, concurrent and legacy-compatible", { timeout: 180_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-multi-service-pg-"));
  const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-multi-service-migrations-"));
  const port = await availablePort();
  const password = "multi-service-test";
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let started = false;
  let pool: pg.Pool | undefined;
  let applicationPool: pg.Pool | undefined;

  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    const environment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      NODE_ENV: "test",
      APP_ENV: "development",
      BUSINESS_VERTICAL: "beauty",
      BEAUTY_V2_FEATURES_ENABLED: "true",
      MIGRATION_DEFAULT_LOCATION_NAME: "Beauty v2 Test",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    } satisfies NodeJS.ProcessEnv;
    Object.assign(process.env, environment);

    await runCommand(process.execPath, [path.resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"], environment);
    for (const migration of [
      "0021_appointment_availability_windows.sql",
      "0023_beauty_v2_feature_settings.sql",
      "0024_multi_service_appointment_engine.sql",
    ]) {
      await copyFile(path.resolve("migrations", migration), path.join(migrationsDirectory, migration));
    }
    pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment });

    await pool.query(`
      INSERT INTO locations (id, name, slug, address, timezone, is_active, is_default)
      VALUES (1, 'Beauty v2 Test', 'principal', 'Test address', 'Europe/Lisbon', true, true)
      ON CONFLICT (id) DO UPDATE SET is_active = true, timezone = EXCLUDED.timezone;
      INSERT INTO barbers (id, name, specialty, color, is_visible) VALUES
        (1, 'Ana', 'Unhas', '#111111', true),
        (2, 'Beatriz', 'Estética', '#222222', true)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO services (id, name, price, duration, is_visible) VALUES
        (1, 'Manicure', 2000, 30, true),
        (2, 'Nail art', 1000, 45, true)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO barber_locations (barber_id, location_id, is_active) VALUES
        (1, 1, true), (2, 1, true)
      ON CONFLICT (barber_id, location_id) DO UPDATE SET is_active = true;
      INSERT INTO service_locations (
        service_id, location_id, is_active, buffer_before_minutes, buffer_after_minutes
      ) VALUES
        (1, 1, true, 10, 5),
        (2, 1, true, 5, 10)
      ON CONFLICT (service_id, location_id) DO UPDATE SET
        is_active = true,
        buffer_before_minutes = EXCLUDED.buffer_before_minutes,
        buffer_after_minutes = EXCLUDED.buffer_after_minutes;
      INSERT INTO barber_services (barber_id, service_id, location_id) VALUES
        (1, 1, 1), (2, 2, 1)
      ON CONFLICT (barber_id, service_id, location_id) DO NOTHING;
      INSERT INTO shop_availability (location_id, day_of_week, start_time, end_time, is_open)
      SELECT 1, day, '08:00', '20:00', true FROM generate_series(0, 6) day;
      INSERT INTO business_feature_settings (feature_name, location_id, enabled)
      VALUES ('multiServiceAppointments', 1, true)
      ON CONFLICT (feature_name, location_id) WHERE location_id IS NOT NULL
      DO UPDATE SET enabled = true;
    `);

    const engine = await import("../../server/multi-service-appointment-engine");
    applicationPool = (await import("../../server/db")).pool;
    const request = (customerName: string, startTime = "2035-01-04T10:00:00.000Z") => ({
      locationId: 1,
      startTime,
      customerName,
      customerPhone: "+351910000001",
      customerEmail: null,
      cancelToken: `token-${customerName.toLowerCase().replaceAll(" ", "-")}`,
      services: [
        { serviceId: 1, barberId: 1 },
        { serviceId: 2, barberId: 2 },
      ],
    });

    await assert.rejects(
      engine.createMultiServiceAppointmentWithPool(pool, request("Disabled"), {
        masterEnabled: false,
        businessVertical: "beauty",
      }),
      (error: unknown) => error instanceof engine.MultiServiceFeatureDisabledError,
    );
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments")).rows[0].count), 0);

    const created = await engine.createMultiServiceAppointmentWithPool(pool, request("Sequential"), {
      masterEnabled: true,
      businessVertical: "beauty",
    });
    assert.equal(created.segments.length, 2);
    assert.deepEqual(created.segments.map((segment) => segment.barberId), [1, 2]);
    assert.equal(created.appointment.durationMinutes, 75);
    assert.equal(created.appointment.servicePriceCentsSnapshot, 3000);
    assert.equal(created.appointment.serviceNameSnapshot, "Manicure + Nail art");
    assert.deepEqual(
      (await engine.getMultiServiceAppointmentSegmentsWithPool(pool, created.appointment.id))
        .map((segment) => [segment.position, segment.serviceId, segment.barberId]),
      [[0, 1, 1], [1, 2, 2]],
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [created.appointment.id],
    )).rows[0].count), 2);
    await assert.rejects(
      pool.query("DELETE FROM appointment_service_sets WHERE appointment_id = $1", [created.appointment.id]),
      (error: any) => error?.code === "23514",
      "a multi-service appointment cannot be silently downgraded to the legacy model",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments WHERE appointment_id = $1",
      [created.appointment.id],
    )).rows[0].count), 2);

    const legacy = await pool.query<{ id: number }>(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 1, 1, '2035-01-04 14:00:00', 'Legacy', '+351910000002', 30, 'booked', 'legacy-token')
      RETURNING id
    `);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_sets WHERE appointment_id = $1",
      [legacy.rows[0].id],
    )).rows[0].count), 0);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [legacy.rows[0].id],
    )).rows[0].count), 1);

    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-01-11 10:30:00', 'Partial conflict', '+351910000003', 45, 'booked', 'partial-token')
    `);
    await assert.rejects(
      engine.createMultiServiceAppointmentWithPool(pool, request("Rejected partial", "2035-01-11T10:00:00.000Z"), {
        masterEnabled: true,
        businessVertical: "beauty",
      }),
      (error: unknown) => error instanceof engine.MultiServiceConflictError,
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = 'Rejected partial'",
    )).rows[0].count), 0);

    const beforeRollback = Number((await pool.query("SELECT count(*) AS count FROM appointments")).rows[0].count);
    await assert.rejects(
      engine.createMultiServiceAppointmentWithPool(pool, request("Rollback", "2035-01-18T10:00:00.000Z"), {
        masterEnabled: true,
        businessVertical: "beauty",
        afterSegmentsInserted: async () => { throw new Error("forced rollback"); },
      }),
      /forced rollback/,
    );
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments")).rows[0].count), beforeRollback);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments segment JOIN appointments appointment ON appointment.id = segment.appointment_id WHERE appointment.customer_name = 'Rollback'",
    )).rows[0].count), 0);

    const concurrent = await Promise.allSettled([
      engine.createMultiServiceAppointmentWithPool(pool, request("Concurrent A", "2035-01-25T10:00:00.000Z"), {
        masterEnabled: true, businessVertical: "beauty",
      }),
      engine.createMultiServiceAppointmentWithPool(pool, {
        ...request("Concurrent B", "2035-01-25T10:00:00.000Z"),
        customerPhone: "+351910000004",
      }, { masterEnabled: true, businessVertical: "beauty" }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected"
      && result.reason instanceof engine.MultiServiceConflictError).length, 1);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name IN ('Concurrent A', 'Concurrent B')",
    )).rows[0].count), 1);
  } finally {
    if (applicationPool) await applicationPool.end().catch(() => undefined);
    if (pool) await pool.end().catch(() => undefined);
    if (started) await stopEmbeddedPostgres(postgres, databaseDir).catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
    await rm(migrationsDirectory, { recursive: true, force: true });
  }
});
