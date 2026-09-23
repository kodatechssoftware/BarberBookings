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

function datedThursdayIso(direction: "past" | "future", weeks: number, hour: number, minute: number) {
  const date = new Date();
  const currentDay = date.getUTCDay();
  const dayOffset = direction === "future"
    ? ((4 - currentDay + 7) % 7 || 7) + weeks * 7
    : -(((currentDay - 4 + 7) % 7 || 7) + weeks * 7);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
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
      DEMO_MODE: "false",
      MULTI_LOCATION_ENABLED: "false",
      MAX_LOCATIONS: "1",
      PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
      BOOKING_SLOT_INTERVAL_MINUTES: "60",
      APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true",
      NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
      WHATSAPP_NOTIFICATIONS_ENABLED: "false",
      MESSAGING_PROVIDER: "none",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      PERFORMANCE_TIMINGS_ENABLED: "false",
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

    const baseUrl = `http://127.0.0.1:${appPort}`;
    const startApplication = async () => {
      serverProcess = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        cwd: process.cwd(),
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk; });
      serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk; });
      await waitForServer(baseUrl, () => serverOutput);
    };
    await startApplication();

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

    const historicalFixtures = [
      { label: "Existing 09:15", startTime: datedThursdayIso("future", 10, 9, 15), action: "same-time" },
      { label: "Existing 09:30", startTime: datedThursdayIso("future", 11, 9, 30), action: "cancelled" },
      { label: "Existing 10:30", startTime: datedThursdayIso("past", 2, 10, 30), action: "completed" },
      { label: "Existing 14:45", startTime: datedThursdayIso("past", 3, 14, 45), action: "no_show" },
      { label: "Existing 17:30", startTime: datedThursdayIso("future", 12, 17, 30), action: "same-time" },
    ];
    const historicalIds = new Map<string, number>();
    for (const [index, fixture] of historicalFixtures.entries()) {
      const inserted = await pool.query<{ id: number }>(`
        INSERT INTO appointments (
          location_id, barber_id, service_id, start_time, customer_name, customer_email,
          customer_phone, duration_minutes, status, cancel_token, payment_method,
          deposit_required, reschedule_revision, notification_revision, whatsapp_opt_in
        ) VALUES (1, $1, $2, $3, $4, $5, $6, 60, 'booked', $7, 'pending', false, 0, 0, false)
        RETURNING id
      `, [
        barber.id,
        service.id,
        fixture.startTime,
        fixture.label,
        `${fixture.label.replace(/[^0-9]/g, "") || index}@example.test`,
        `+3519127${String(index).padStart(5, "0")}`,
        `existing-off-grid-${index}`,
      ]);
      historicalIds.set(fixture.label, inserted.rows[0].id);
    }

    // Prove that an ordinary application restart does not rewrite historical times.
    serverProcess.kill();
    await new Promise<void>((resolve) => serverProcess!.once("exit", () => resolve()));
    serverProcess = undefined;
    await startApplication();

    const loginResponse = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: environment.ADMIN_INITIAL_PASSWORD }),
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    const authenticatedHeaders = { "content-type": "application/json", cookie };

    for (const fixture of historicalFixtures) {
      const id = historicalIds.get(fixture.label)!;
      if (fixture.action === "same-time") {
        const response = await fetch(`${baseUrl}/api/appointments/${id}`, {
          method: "PATCH",
          headers: authenticatedHeaders,
          body: JSON.stringify({ startTime: fixture.startTime, barberId: barber.id, serviceId: service.id }),
        });
        assert.equal(response.status, 200, `${fixture.label}: ${await response.text()}`);
      } else {
        const response = await fetch(`${baseUrl}/api/appointments/${id}/status`, {
          method: "PATCH",
          headers: authenticatedHeaders,
          body: JSON.stringify({
            status: fixture.action,
            expectedStatus: "booked",
            ...(fixture.action === "completed" ? { paymentMethod: "cash" } : {}),
          }),
        });
        assert.equal(response.status, 200, `${fixture.label}: ${await response.text()}`);
      }
    }

    const persistedHistorical = await pool.query<{
      id: number;
      start_time: Date;
      duration_minutes: number;
      status: string;
      payment_method: string;
    }>(`
      SELECT id, start_time, duration_minutes, status, payment_method
      FROM appointments WHERE id = ANY($1::int[]) ORDER BY id
    `, [Array.from(historicalIds.values())]);
    assert.equal(persistedHistorical.rowCount, 5);
    for (const fixture of historicalFixtures) {
      const row = persistedHistorical.rows.find((candidate) => candidate.id === historicalIds.get(fixture.label));
      assert.ok(row);
      assert.equal(new Date(row.start_time).toISOString(), fixture.startTime);
      assert.equal(row.duration_minutes, 60);
      assert.equal(row.status, fixture.action === "same-time" ? "booked" : fixture.action);
      if (fixture.action === "completed") assert.equal(row.payment_method, "cash");
    }
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_notification_events
      WHERE appointment_id = ANY($1::int[])
    `, [Array.from(historicalIds.values())])).rows[0].count), 1);
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM whatsapp_messages
      WHERE appointment_id = ANY($1::int[])
    `, [Array.from(historicalIds.values())])).rows[0].count), 0);

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
      PERFORMANCE_TIMINGS_ENABLED: "false",
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
