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
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}:\n${output}`));
    });
  });
}

async function waitForServer(baseUrl: string, childOutput: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The child has not opened the HTTP port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for PostgreSQL integration server:\n${childOutput()}`);
}

function futureThursdayIso(weeksAhead: number, hour: number) {
  const date = new Date();
  const currentDay = date.getUTCDay();
  const daysUntilThursday = (4 - currentDay + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilThursday + weeksAhead * 7);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

test("real PostgreSQL returns one 201 and only 409 conflicts for concurrent public bookings", { timeout: 180_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-conflict-pg-"));
  const postgresPort = await availablePort();
  const appPort = await availablePort();
  const password = "appointment-conflict-test";
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port: postgresPort,
    user: "postgres",
    password,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let postgresStarted = false;
  let pool: pg.Pool | undefined;
  let applicationPool: pg.Pool | undefined;
  let serverProcess: ReturnType<typeof spawn> | undefined;
  let serverOutput = "";

  try {
    await postgres.initialise();
    await postgres.start();
    postgresStarted = true;

    const serverUrl = `postgresql://postgres:${password}@127.0.0.1:${postgresPort}/`;
    const bootstrapPool = new pg.Pool({ connectionString: `${serverUrl}postgres` });
    await bootstrapPool.query(
      "CREATE DATABASE appointment_conflict_test ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0",
    );
    await bootstrapPool.end();
    const databaseUrl = `${serverUrl}appointment_conflict_test`;
    const environment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      DATABASE_POOL_MAX: "6",
      NODE_ENV: "development",
      APP_ENV: "development",
      PORT: String(appPort),
      PUBLIC_URL: `http://127.0.0.1:${appPort}`,
      SESSION_SECRET: "appointment-conflict-integration-secret",
      ADMIN_INITIAL_PASSWORD: "Appointment-Conflict-Test-Admin-2026!",
      MULTI_LOCATION_ENABLED: "false",
      MAX_LOCATIONS: "1",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
    } satisfies NodeJS.ProcessEnv;

    await runCommand(
      process.execPath,
      [path.resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"],
      environment,
    );

    pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
    await runSchemaMigrations(pool, {
      schemaName: "public",
      environment: {
        ...environment,
        MIGRATION_DEFAULT_LOCATION_NAME: "Conflict Test Shop",
        MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
        MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
      },
    });

    serverProcess = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk; });
    serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk; });

    const baseUrl = `http://127.0.0.1:${appPort}`;
    await waitForServer(baseUrl, () => serverOutput);

    const [barbersResponse, servicesResponse] = await Promise.all([
      fetch(`${baseUrl}/api/barbers`),
      fetch(`${baseUrl}/api/services`),
    ]);
    assert.equal(barbersResponse.status, 200);
    assert.equal(servicesResponse.status, 200);
    const [barber] = await barbersResponse.json() as Array<{ id: number }>;
    const [service] = await servicesResponse.json() as Array<{ id: number }>;
    assert.ok(barber?.id);
    assert.ok(service?.id);

    async function runBurst(size: number, weeksAhead: number, label: string) {
      const startTime = futureThursdayIso(weeksAhead, 15);
      const responses = await Promise.all(Array.from({ length: size }, (_, index) =>
        fetch(`${baseUrl}/api/appointments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            barberId: barber.id,
            serviceId: service.id,
            startTime,
            customerEmail: null,
            customerName: `${label} ${index + 1}`,
            customerPhone: `9128${String(weeksAhead).padStart(2, "0")}${String(index).padStart(3, "0")}`,
          }),
        }),
      ));
      const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
      assert.deepEqual(statuses, [201, ...Array(size - 1).fill(409)]);

      const persisted = await pool!.query<{ id: number }>(`
        SELECT id FROM appointments
        WHERE customer_name LIKE $1 AND barber_id = $2 AND status = 'booked'
      `, [`${label}%`, barber.id]);
      assert.equal(persisted.rowCount, 1);
      const appointmentId = persisted.rows[0].id;
      assert.equal(Number((await pool!.query(
        "SELECT count(*) AS count FROM audit_logs WHERE action = 'appointment.created_online' AND summary LIKE $1",
        [`%${label}%`],
      )).rows[0].count), 1);
      assert.equal(Number((await pool!.query(
        `SELECT count(*) AS count FROM appointment_notification_events event
          JOIN appointments appointment ON appointment.id = event.appointment_id
          WHERE appointment.customer_name LIKE $1`,
        [`${label}%`],
      )).rows[0].count), 1);
      assert.equal(Number((await pool!.query(
        "SELECT count(*) AS count FROM whatsapp_messages",
      )).rows[0].count), 0);
      return { appointmentId, startTime };
    }

    const firstBurst = await runBurst(2, 3, "Conflict two");
    await runBurst(5, 4, "Conflict five");

    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      DATABASE_POOL_MAX: "6",
      USE_MEMORY_STORAGE: "false",
    });
    const [{ db, pool: storagePool }, { appointments }, { isAppointmentConflictError }] = await Promise.all([
      import("../../server/db"),
      import("../../shared/schema"),
      import("../../server/storage"),
    ]);
    applicationPool = storagePool;
    let actualDrizzleError: unknown;
    try {
      await db.insert(appointments).values({
        locationId: 1,
        barberId: barber.id,
        serviceId: service.id,
        startTime: new Date(firstBurst.startTime),
        customerName: "Direct constraint conflict",
        customerPhone: "+351912899999",
        durationMinutes: 60,
        status: "booked",
        cancelToken: "direct-constraint-conflict",
      });
    } catch (error) {
      actualDrizzleError = error;
    }
    assert.ok(actualDrizzleError, "the real exclusion constraint must reject the overlapping insert");
    const actualWrapper = actualDrizzleError as {
      code?: unknown;
      cause?: { code?: unknown; constraint?: unknown };
    };
    assert.notEqual(actualWrapper.code, "23P01");
    assert.equal(actualWrapper.cause?.code, "23P01");
    assert.equal(actualWrapper.cause?.constraint, "appointments_no_booked_overlap");
    assert.equal(isAppointmentConflictError(actualDrizzleError), true);

    const overlaps = await pool.query(`
      SELECT first.id, second.id
      FROM appointments first
      JOIN appointments second ON first.id < second.id
        AND first.barber_id = second.barber_id
        AND first.status = 'booked' AND second.status = 'booked'
        AND tsrange(first.start_time, first.start_time + make_interval(mins => first.duration_minutes), '[)')
          && tsrange(second.start_time, second.start_time + make_interval(mins => second.duration_minutes), '[)')
    `);
    assert.equal(overlaps.rowCount, 0);
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
      await new Promise<void>((resolve) => serverProcess!.once("exit", () => resolve()));
    }
    if (applicationPool) await applicationPool.end();
    if (pool) await pool.end();
    if (postgresStarted) await postgres.stop();
    await rm(databaseDir, { recursive: true, force: true });
  }
});
