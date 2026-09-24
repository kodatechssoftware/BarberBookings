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
    const [barber] = await barbersResponse.json() as Array<{ id: number; serviceIds?: number[] }>;
    const [service] = await servicesResponse.json() as Array<{ id: number }>;
    assert.ok(barber?.id);
    assert.ok(service?.id);

    const setupLoginResponse = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: environment.ADMIN_INITIAL_PASSWORD }),
    });
    assert.equal(setupLoginResponse.status, 200);
    const setupCookie = setupLoginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(setupCookie);
    const setupHeaders = { "content-type": "application/json", cookie: setupCookie };

    const alternateServiceResponse = await fetch(`${baseUrl}/api/services`, {
      method: "POST",
      headers: setupHeaders,
      body: JSON.stringify({
        name: "Historical alternate service",
        description: "Historical slot interval coverage",
        price: 1500,
        duration: 60,
        isVisible: true,
      }),
    });
    const alternateServiceBody = await alternateServiceResponse.text();
    assert.equal(alternateServiceResponse.status, 201, alternateServiceBody);
    const alternateService = JSON.parse(alternateServiceBody) as { id: number };

    const assignAlternateServiceResponse = await fetch(`${baseUrl}/api/barbers/${barber.id}/services`, {
      method: "PATCH",
      headers: setupHeaders,
      body: JSON.stringify({ serviceIds: [service.id, alternateService.id] }),
    });
    assert.equal(assignAlternateServiceResponse.status, 200, await assignAlternateServiceResponse.text());

    const alternateBarberResponse = await fetch(`${baseUrl}/api/barbers`, {
      method: "POST",
      headers: setupHeaders,
      body: JSON.stringify({
        name: "Historical alternate barber",
        specialty: "Historical slot interval coverage",
        bio: "PostgreSQL integration test",
        color: "#334155",
        isVisible: true,
        serviceIds: [service.id, alternateService.id],
      }),
    });
    const alternateBarberBody = await alternateBarberResponse.text();
    assert.equal(alternateBarberResponse.status, 201, alternateBarberBody);
    const alternateBarber = JSON.parse(alternateBarberBody) as { id: number };

    type HistoricalAction = "same-time" | "cancelled" | "client-cancelled" | "completed" | "no_show" | "service-only" | "barber-only";
    const historicalFixtures: Array<{ label: string; startTime: string; action: HistoricalAction }> = [
      { label: "Existing 09:15", startTime: datedThursdayIso("future", 10, 9, 15), action: "same-time" },
      { label: "Existing 09:30", startTime: datedThursdayIso("future", 11, 9, 30), action: "cancelled" },
      { label: "Existing 10:30", startTime: datedThursdayIso("past", 2, 10, 30), action: "completed" },
      { label: "Existing 14:45", startTime: datedThursdayIso("past", 3, 14, 45), action: "no_show" },
      { label: "Existing 17:30", startTime: datedThursdayIso("future", 12, 17, 30), action: "same-time" },
      { label: "Existing 10:30 client cancellation", startTime: datedThursdayIso("future", 13, 10, 30), action: "client-cancelled" },
      { label: "Existing 10:30 service change", startTime: datedThursdayIso("future", 14, 10, 30), action: "service-only" },
      { label: "Existing 14:30 barber change", startTime: datedThursdayIso("future", 15, 14, 30), action: "barber-only" },
    ];
    const historicalIds = new Map<string, number>();
    const historicalTokens = new Map<string, string>();
    for (const [index, fixture] of historicalFixtures.entries()) {
      const cancelToken = `existing-off-grid-${index}`;
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
        cancelToken,
      ]);
      historicalIds.set(fixture.label, inserted.rows[0].id);
      historicalTokens.set(fixture.label, cancelToken);
    }

    type HistoricalSnapshot = {
      id: number;
      start_time: string;
      duration_minutes: number;
      barber_id: number;
      service_id: number | null;
      status: string;
      cancel_token: string;
      notification_revision: number;
      reschedule_revision: number;
    };
    const readHistoricalSnapshot = async (): Promise<HistoricalSnapshot[]> => {
      const result = await pool!.query<Omit<HistoricalSnapshot, "start_time"> & { start_time: Date }>(`
        SELECT id, start_time, duration_minutes, barber_id, service_id, status, cancel_token,
               notification_revision, reschedule_revision
        FROM appointments WHERE id = ANY($1::int[]) ORDER BY id
      `, [Array.from(historicalIds.values())]);
      return result.rows.map((row) => ({
        ...row,
        start_time: new Date(row.start_time).toISOString(),
      }));
    };
    const historicalSnapshotBeforeRestart = await readHistoricalSnapshot();

    // Prove that an ordinary application restart does not rewrite any historical appointment field.
    serverProcess.kill();
    await new Promise<void>((resolve) => serverProcess!.once("exit", () => resolve()));
    serverProcess = undefined;
    await startApplication();
    assert.deepEqual(await readHistoricalSnapshot(), historicalSnapshotBeforeRestart);

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
      } else if (fixture.action === "client-cancelled") {
        const token = historicalTokens.get(fixture.label)!;
        const response = await fetch(`${baseUrl}/api/appointments/cancel/${token}`, { method: "POST" });
        const responseBody = await response.text();
        assert.equal(response.status, 200, `${fixture.label}: ${responseBody}`);
        assert.equal((JSON.parse(responseBody) as { status: string }).status, "cancelled");
        const repeated = await fetch(`${baseUrl}/api/appointments/cancel/${token}`, { method: "POST" });
        const repeatedBody = await repeated.text();
        assert.equal(repeated.status, 200, `${fixture.label} repeated: ${repeatedBody}`);
        assert.equal((JSON.parse(repeatedBody) as { alreadyCancelled?: boolean }).alreadyCancelled, true);
      } else if (fixture.action === "service-only") {
        const response = await fetch(`${baseUrl}/api/appointments/${id}`, {
          method: "PATCH",
          headers: authenticatedHeaders,
          body: JSON.stringify({ serviceId: alternateService.id }),
        });
        assert.equal(response.status, 200, `${fixture.label}: ${await response.text()}`);
      } else if (fixture.action === "barber-only") {
        const response = await fetch(`${baseUrl}/api/appointments/${id}`, {
          method: "PATCH",
          headers: authenticatedHeaders,
          body: JSON.stringify({ barberId: alternateBarber.id }),
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
      barber_id: number;
      service_id: number | null;
      status: string;
      payment_method: string;
      cancel_token: string;
      reschedule_revision: number;
    }>(`
      SELECT id, start_time, duration_minutes, barber_id, service_id, status, payment_method,
             cancel_token, reschedule_revision
      FROM appointments WHERE id = ANY($1::int[]) ORDER BY id
    `, [Array.from(historicalIds.values())]);
    assert.equal(persistedHistorical.rowCount, historicalFixtures.length);
    for (const fixture of historicalFixtures) {
      const row = persistedHistorical.rows.find((candidate) => candidate.id === historicalIds.get(fixture.label));
      assert.ok(row);
      assert.equal(new Date(row.start_time).toISOString(), fixture.startTime);
      assert.equal(row.duration_minutes, 60);
      assert.equal(row.barber_id, fixture.action === "barber-only" ? alternateBarber.id : barber.id);
      assert.equal(row.service_id, fixture.action === "service-only" ? alternateService.id : service.id);
      assert.equal(
        row.status,
        fixture.action === "cancelled" || fixture.action === "client-cancelled"
          ? "cancelled"
          : fixture.action === "completed" || fixture.action === "no_show"
            ? fixture.action
            : "booked",
      );
      assert.equal(row.cancel_token, historicalTokens.get(fixture.label));
      assert.equal(row.reschedule_revision, 0);
      if (fixture.action === "completed") assert.equal(row.payment_method, "cash");
    }
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_notification_events
      WHERE appointment_id = ANY($1::int[])
    `, [Array.from(historicalIds.values())])).rows[0].count), 4);
    for (const fixture of historicalFixtures.filter(({ action }) =>
      ["cancelled", "client-cancelled", "service-only", "barber-only"].includes(action))) {
      const expectedEventType = fixture.action === "service-only" || fixture.action === "barber-only"
        ? "appointment_updated"
        : "appointment_cancelled";
      const events = await pool.query<{ event_type: string }>(`
        SELECT event_type FROM appointment_notification_events WHERE appointment_id = $1
      `, [historicalIds.get(fixture.label)]);
      assert.deepEqual(events.rows.map((event) => event.event_type), [expectedEventType]);
    }
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
