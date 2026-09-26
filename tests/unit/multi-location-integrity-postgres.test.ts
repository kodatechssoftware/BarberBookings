import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runSchemaMigrations } from "../../server/migrations";

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
    const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}:\n${output}`)));
  });
}

function futureStart(iteration: number, hour = 10) {
  const value = new Date(Date.now() + (60 + iteration) * 86400000);
  value.setUTCHours(hour, 0, 0, 0);
  return value;
}

async function installDelayTrigger(pool: pg.Pool, target: "appointments" | "locations" | "barber_locations") {
  const suffix = target.replaceAll("_", "");
  const condition = target === "appointments"
    ? ""
    : "WHEN (OLD.is_active = true AND NEW.is_active = false)";
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_delay_${suffix}() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_sleep(0.25);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS test_delay_${suffix}_trigger ON ${target};
    CREATE TRIGGER test_delay_${suffix}_trigger
      BEFORE ${target === "appointments" ? "INSERT" : "UPDATE"} ON ${target}
      FOR EACH ROW ${condition}
      EXECUTE FUNCTION test_delay_${suffix}();
  `);
}

async function removeDelayTrigger(pool: pg.Pool, target: "appointments" | "locations" | "barber_locations") {
  const suffix = target.replaceAll("_", "");
  await pool.query(`
    DROP TRIGGER IF EXISTS test_delay_${suffix}_trigger ON ${target};
    DROP FUNCTION IF EXISTS test_delay_${suffix}();
  `);
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("real PostgreSQL keeps location and barber assignment consistent with concurrent appointment creation", { timeout: 180_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-multilocation-integrity-pg-"));
  const postgresPort = await availablePort();
  const password = "multi-location-integrity-test";
  const postgres = new EmbeddedPostgres({
    databaseDir, port: postgresPort, user: "postgres", password, persistent: false,
    onLog: () => undefined, onError: () => undefined,
  });
  let postgresStarted = false;
  let pool: pg.Pool | undefined;
  let applicationPool: pg.Pool | undefined;

  try {
    await postgres.initialise();
    await postgres.start();
    postgresStarted = true;
    const serverUrl = `postgresql://postgres:${password}@127.0.0.1:${postgresPort}/`;
    const bootstrapPool = new pg.Pool({ connectionString: `${serverUrl}postgres` });
    await bootstrapPool.query("CREATE DATABASE multi_location_integrity_test ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await bootstrapPool.end();
    const databaseUrl = `${serverUrl}multi_location_integrity_test`;
    const environment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      DATABASE_POOL_MAX: "6",
      NODE_ENV: "test",
      APP_ENV: "development",
      USE_MEMORY_STORAGE: "false",
      DEMO_MODE: "false",
      MULTI_LOCATION_ENABLED: "true",
      MAX_LOCATIONS: "3",
      SHOP_TIME_ZONE: "Europe/Lisbon",
      PERFORMANCE_TIMINGS_ENABLED: "false",
    } satisfies NodeJS.ProcessEnv;

    await runCommand(process.execPath, [path.resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"], environment);
    pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
    await runSchemaMigrations(pool, {
      schemaName: "public",
      environment: {
        ...environment,
        MIGRATION_DEFAULT_LOCATION_NAME: "Loja A",
        MIGRATION_DEFAULT_LOCATION_ADDRESS: "Morada A",
        MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
      },
    });

    const locationA = Number((await pool.query("SELECT id FROM locations WHERE is_default = true")).rows[0].id);
    const locationB = Number((await pool.query(`
      INSERT INTO locations (name, slug, address, timezone, is_active, is_default, sort_order)
      VALUES ('Loja B', 'loja-b', 'Morada B', 'Europe/Lisbon', true, false, 1)
      RETURNING id
    `)).rows[0].id);
    const barberId = Number((await pool.query(`
      INSERT INTO barbers (name, specialty, color, is_visible)
      VALUES ('Barbeiro X', 'Corte', '#112233', true) RETURNING id
    `)).rows[0].id);
    const serviceId = Number((await pool.query(`
      INSERT INTO services (name, price, duration, is_visible)
      VALUES ('Corte', 1500, 30, true) RETURNING id
    `)).rows[0].id);
    await pool.query(`
      INSERT INTO barber_locations (barber_id, location_id, is_active)
      VALUES ($1, $2, true), ($1, $3, true)
    `, [barberId, locationA, locationB]);
    await pool.query(`
      INSERT INTO service_locations (service_id, location_id, is_active)
      VALUES ($1, $2, true), ($1, $3, true)
    `, [serviceId, locationA, locationB]);
    await pool.query("INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2)", [barberId, serviceId]);

    Object.assign(process.env, environment);
    const [{ DatabaseStorage, isAppointmentConflictError, isAppointmentLocationIntegrityError }, locationStore, dbModule] = await Promise.all([
      import("../../server/storage"),
      import("../../server/location-store"),
      import("../../server/db"),
    ]);
    applicationPool = dbModule.pool;
    const storage = new DatabaseStorage();
    let tokenSequence = 0;
    const createAt = (locationId: number, startTime: Date) => storage.createAppointment({
      locationId,
      barberId,
      serviceId,
      startTime,
      customerName: `Cliente ${++tokenSequence}`,
      customerEmail: null,
      customerPhone: `+35191${String(tokenSequence).padStart(7, "0")}`,
      cancelToken: `multi-location-integrity-${tokenSequence}`,
      durationMinutes: 30,
      status: "booked",
      notificationEventType: "appointment_confirmation",
    });
    const clearAppointments = () => pool!.query("DELETE FROM appointments");
    const resetLocationAndAssignment = async () => {
      await pool!.query("UPDATE locations SET is_active = true WHERE id = $1", [locationB]);
      await pool!.query("UPDATE barber_locations SET is_active = true WHERE barber_id = $1 AND location_id = $2", [barberId, locationB]);
    };

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await resetLocationAndAssignment();
      await clearAppointments();
      await installDelayTrigger(pool, "appointments");
      const start = futureStart(iteration, 10);
      const creation = createAt(locationB, start);
      await pause(60);
      const deactivation = locationStore.updateLocation(locationB, { isActive: false });
      const [creationResult, deactivationResult] = await Promise.allSettled([creation, deactivation]);
      await removeDelayTrigger(pool, "appointments");
      assert.equal(creationResult.status, "fulfilled", "creation holding the location lock must win");
      assert.equal(deactivationResult.status, "rejected");
      assert.equal((deactivationResult as PromiseRejectedResult).reason?.message, "LOCATION_HAS_FUTURE_APPOINTMENTS");
      assert.equal((await pool.query("SELECT is_active FROM locations WHERE id = $1", [locationB])).rows[0].is_active, true);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments WHERE location_id = $1", [locationB])).rows[0].count), 1);
    }

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await resetLocationAndAssignment();
      await clearAppointments();
      await installDelayTrigger(pool, "locations");
      const deactivation = locationStore.updateLocation(locationB, { isActive: false });
      await pause(60);
      const creation = createAt(locationB, futureStart(iteration + 10, 10));
      const [deactivationResult, creationResult] = await Promise.allSettled([deactivation, creation]);
      await removeDelayTrigger(pool, "locations");
      assert.equal(deactivationResult.status, "fulfilled", "deactivation holding the location lock must win");
      assert.equal(creationResult.status, "rejected");
      assert.equal(isAppointmentLocationIntegrityError((creationResult as PromiseRejectedResult).reason), true);
      assert.equal((await pool.query("SELECT is_active FROM locations WHERE id = $1", [locationB])).rows[0].is_active, false);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments WHERE location_id = $1", [locationB])).rows[0].count), 0);
    }

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await resetLocationAndAssignment();
      await clearAppointments();
      await installDelayTrigger(pool, "appointments");
      const creation = createAt(locationB, futureStart(iteration + 20, 11));
      await pause(60);
      const removal = locationStore.removeBarberFromLocation(barberId, locationB);
      const [creationResult, removalResult] = await Promise.allSettled([creation, removal]);
      await removeDelayTrigger(pool, "appointments");
      assert.equal(creationResult.status, "fulfilled", "creation holding the assignment lock must win");
      assert.equal(removalResult.status, "rejected");
      assert.equal((removalResult as PromiseRejectedResult).reason?.message, "BARBER_LOCATION_HAS_FUTURE_APPOINTMENTS");
      assert.equal((await pool.query("SELECT is_active FROM barber_locations WHERE barber_id = $1 AND location_id = $2", [barberId, locationB])).rows[0].is_active, true);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments WHERE location_id = $1 AND barber_id = $2", [locationB, barberId])).rows[0].count), 1);
    }

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await resetLocationAndAssignment();
      await clearAppointments();
      await installDelayTrigger(pool, "barber_locations");
      const removal = locationStore.removeBarberFromLocation(barberId, locationB);
      await pause(60);
      const creation = createAt(locationB, futureStart(iteration + 30, 11));
      const [removalResult, creationResult] = await Promise.allSettled([removal, creation]);
      await removeDelayTrigger(pool, "barber_locations");
      assert.equal(removalResult.status, "fulfilled", "removal holding the assignment lock must win");
      assert.equal(creationResult.status, "rejected");
      assert.equal(isAppointmentLocationIntegrityError((creationResult as PromiseRejectedResult).reason), true);
      assert.equal((await pool.query("SELECT is_active FROM barber_locations WHERE barber_id = $1 AND location_id = $2", [barberId, locationB])).rows[0].is_active, false);
      assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments WHERE location_id = $1 AND barber_id = $2", [locationB, barberId])).rows[0].count), 0);
    }

    await resetLocationAndAssignment();
    await clearAppointments();
    const sameStart = futureStart(50, 12);
    const crossLocationResults = await Promise.allSettled([
      createAt(locationA, sameStart),
      createAt(locationB, sameStart),
    ]);
    assert.equal(crossLocationResults.filter((result) => result.status === "fulfilled").length, 1);
    const conflict = crossLocationResults.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(isAppointmentConflictError(conflict.reason), true);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments WHERE barber_id = $1 AND status = 'booked'", [barberId])).rows[0].count), 1);
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count
      FROM appointments first
      JOIN appointments second ON first.id < second.id
        AND first.barber_id = second.barber_id
        AND first.status = 'booked' AND second.status = 'booked'
        AND tsrange(first.start_time, first.start_time + make_interval(mins => first.duration_minutes), '[)')
          && tsrange(second.start_time, second.start_time + make_interval(mins => second.duration_minutes), '[)')
    `)).rows[0].count), 0);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointment_notification_events")).rows[0].count), 1);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM whatsapp_messages")).rows[0].count), 0);
  } finally {
    if (applicationPool) await applicationPool.end();
    if (pool) await pool.end();
    if (postgresStarted) await postgres.stop().catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
  }
});
