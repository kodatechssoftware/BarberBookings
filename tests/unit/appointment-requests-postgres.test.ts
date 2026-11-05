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
    const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}:\n${output}`)));
  });
}

test("appointment request workflow is scoped, idempotent, atomic and concurrency-safe", { timeout: 240_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-request-pg-"));
  const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-request-migrations-"));
  const port = await availablePort();
  const password = "appointment-request-test";
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
      SESSION_SECRET: "appointment-request-test-secret-at-least-32-characters",
      MIGRATION_DEFAULT_LOCATION_NAME: "Beauty Request Test",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    } satisfies NodeJS.ProcessEnv;
    Object.assign(process.env, environment);

    await runCommand(process.execPath, [path.resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"], environment);
    for (const migration of [
      "0021_appointment_availability_windows.sql",
      "0023_beauty_v2_feature_settings.sql",
      "0024_multi_service_appointment_engine.sql",
      "0025_appointment_request_approval.sql",
    ]) {
      await copyFile(path.resolve("migrations", migration), path.join(migrationsDirectory, migration));
    }
    pool = new pg.Pool({ connectionString: databaseUrl, max: 12 });
    await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment });
    await pool.query(`
      INSERT INTO locations (id, name, slug, address, timezone, is_active, is_default) VALUES
        (1, 'Beauty Request Test', 'principal', 'Test address', 'Europe/Lisbon', true, true),
        (2, 'Other location', 'other', 'Other address', 'Europe/Lisbon', true, false)
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
      INSERT INTO business_feature_settings (feature_name, location_id, enabled) VALUES
        ('appointmentRequests', 1, true),
        ('multiServiceAppointments', 1, true)
      ON CONFLICT (feature_name, location_id) WHERE location_id IS NOT NULL
      DO UPDATE SET enabled = true;
    `);

    const engine = await import("../../server/appointment-request-engine");
    const multiServiceEngine = await import("../../server/multi-service-appointment-engine");
    applicationPool = (await import("../../server/db")).pool;
    const options = {
      masterEnabled: true,
      businessVertical: "beauty",
      responseTokenSecret: environment.SESSION_SECRET,
      appointmentNotificationsEnabled: true,
    } as const;
    const admin = { actorType: "admin" as const, actorId: 1, actorName: "Admin" };
    let sequence = 0;
    const input = (startTime: string, multi = false) => ({
      startTime: new Date(startTime),
      customerName: `Cliente ${++sequence}`,
      customerEmail: `cliente-${sequence}@example.test`,
      customerPhone: "+351910000001",
      whatsappOptIn: true,
      idempotencyKey: `request-key-${sequence}`,
      services: multi
        ? [{ serviceId: 1, barberId: 1 }, { serviceId: 2, barberId: 2 }]
        : [{ serviceId: 1, barberId: 1 }],
    });

    await pool.query(`UPDATE business_feature_settings SET enabled = false WHERE feature_name = 'appointmentRequests'`);
    await assert.rejects(
      engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-04T09:00:00.000Z"), options),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUESTS_DISABLED"
        && error.status === 404,
    );
    await pool.query(`UPDATE business_feature_settings SET enabled = true WHERE feature_name = 'appointmentRequests'`);

    const availability = await multiServiceEngine.previewSequentialAppointmentAvailabilityWithPool(pool, {
      locationId: 1,
      date: "2035-01-04",
      services: [{ serviceId: 1, barberId: 1 }, { serviceId: 2, barberId: 2 }],
      slotIntervalMinutes: 30,
      now: new Date("2035-01-01T00:00:00.000Z"),
    }, options);
    assert.equal(availability.totalPriceCents, 3000);
    assert.equal(availability.durationMinutes, 75);
    assert.ok(availability.starts.length > 0);

    await assert.rejects(
      engine.createAppointmentRequestWithPool(
        pool,
        1,
        input("2020-01-04T10:00:00.000Z"),
        options,
      ),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_TIME_INVALID",
    );

    const simpleInput = input("2035-01-04T10:00:00.000Z");
    const simple = await engine.createAppointmentRequestWithPool(pool, 1, simpleInput, options);
    assert.equal(simple.request.status, "pending");
    assert.equal(simple.request.segments.length, 1);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments")).rows[0].count), 0);
    const simpleRetry = await engine.createAppointmentRequestWithPool(pool, 1, simpleInput, options);
    assert.equal(simpleRetry.reused, true);
    assert.equal(simpleRetry.request.id, simple.request.id);
    await assert.rejects(
      engine.createAppointmentRequestWithPool(pool, 1, { ...simpleInput, customerName: "Different" }, options),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_IDEMPOTENCY_CONFLICT",
    );

    const approved = await engine.approveAppointmentRequestWithPool(pool, simple.request.id, 1, admin, options);
    assert.equal(approved.request.status, "approved");
    assert.ok(approved.request.appointmentId);
    const approvedRetry = await engine.approveAppointmentRequestWithPool(pool, simple.request.id, 1, admin, options);
    assert.equal(approvedRetry.reused, true);
    assert.equal(approvedRetry.appointment.id, approved.request.appointmentId);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
      [simpleInput.customerName],
    )).rows[0].count), 1);

    const multi = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-05T10:00:00.000Z", true), options);
    const multiApproved = await engine.approveAppointmentRequestWithPool(pool, multi.request.id, 1, admin, options);
    assert.equal(multiApproved.request.status, "approved");
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments WHERE appointment_id = $1",
      [multiApproved.request.appointmentId],
    )).rows[0].count), 2);

    const partiallyOccupied = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-05T14:00:00.000Z", true),
      options,
    );
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-01-05 14:30:00', 'Second segment occupier',
        '+351910000098', 45, 'booked', 'second-segment-occupier-token')
    `);
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, partiallyOccupied.request.id, 1, admin, options),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
    );
    assert.equal(
      Number((await pool.query(
        "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
        [partiallyOccupied.request.customerName],
      )).rows[0].count),
      0,
    );

    const occupied = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-06T10:00:00.000Z"), options);
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 1, 1, '2035-01-06 10:00:00', 'Occupier', '+351910000099', 30, 'booked', 'occupier-token')
    `);
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, occupied.request.id, 1, admin, options),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
    );
    assert.equal((await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [occupied.request.id])).rows[0].status, "pending");
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
      [occupied.request.customerName],
    )).rows[0].count), 0);

    const elapsed = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-06T12:00:00.000Z"),
      options,
    );
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, elapsed.request.id, 1, admin, {
        ...options,
        now: () => new Date("2035-01-06T12:01:00.000Z"),
      }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [elapsed.request.id])).rows[0].status,
      "pending",
    );

    const refused = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-07T10:00:00.000Z"), options);
    const refusedResult = await engine.refuseAppointmentRequestWithPool(
      pool, refused.request.id, 1, { reason: "Sem disponibilidade" }, admin, options,
    );
    assert.equal(refusedResult.request.status, "refused");
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, refused.request.id, 1, admin, options),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_TRANSITION_INVALID",
    );

    const proposed = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-08T10:00:00.000Z"), options);
    const proposal = await engine.proposeAppointmentRequestTimeWithPool(pool, proposed.request.id, 1, {
      startTime: new Date("2035-01-08T12:00:00.000Z"),
      expiresAt: new Date("2035-01-08T11:00:00.000Z"),
      commandKey: "proposal-command-accept",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    const publicProposal = await engine.inspectAppointmentRequestProposalWithPool(
      pool,
      proposal.responseToken,
      { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") },
    );
    assert.equal(publicProposal.status, "active");
    assert.equal(publicProposal.services[0].name, "Manicure");
    assert.equal("customerName" in publicProposal, false);
    const accepted = await engine.respondToAppointmentRequestProposalWithPool(pool, {
      token: proposal.responseToken,
      decision: "accept",
    }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") });
    assert.equal(accepted.request.status, "approved");
    assert.equal(new Date(accepted.appointment.startTime).toISOString(), "2035-01-08T12:00:00.000Z");
    const acceptedRetry = await engine.respondToAppointmentRequestProposalWithPool(pool, {
      token: proposal.responseToken,
      decision: "accept",
    }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") });
    assert.equal(acceptedRetry.reused, true);

    const rejected = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-09T10:00:00.000Z"), options);
    const rejectedProposal = await engine.proposeAppointmentRequestTimeWithPool(pool, rejected.request.id, 1, {
      startTime: new Date("2035-01-09T12:00:00.000Z"),
      expiresAt: new Date("2035-01-09T11:00:00.000Z"),
      commandKey: "proposal-command-reject",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    const rejectedResponse = await engine.respondToAppointmentRequestProposalWithPool(pool, {
      token: rejectedProposal.responseToken,
      decision: "reject",
    }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") });
    assert.equal(rejectedResponse.request.status, "pending");

    const replaced = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-10T10:00:00.000Z"), options);
    const firstProposal = await engine.proposeAppointmentRequestTimeWithPool(pool, replaced.request.id, 1, {
      startTime: new Date("2035-01-10T12:00:00.000Z"),
      expiresAt: new Date("2035-01-10T11:00:00.000Z"),
      commandKey: "proposal-command-first",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    await engine.proposeAppointmentRequestTimeWithPool(pool, replaced.request.id, 1, {
      startTime: new Date("2035-01-10T14:00:00.000Z"),
      expiresAt: new Date("2035-01-10T13:00:00.000Z"),
      commandKey: "proposal-command-second",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    await assert.rejects(
      engine.respondToAppointmentRequestProposalWithPool(pool, {
        token: firstProposal.responseToken,
        decision: "accept",
      }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_PROPOSAL_STALE",
    );

    const expiring = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-11T10:00:00.000Z"), options);
    const expiringProposal = await engine.proposeAppointmentRequestTimeWithPool(pool, expiring.request.id, 1, {
      startTime: new Date("2035-01-11T12:00:00.000Z"),
      expiresAt: new Date("2035-01-03T00:00:00.000Z"),
      commandKey: "proposal-command-expired",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    await assert.rejects(
      engine.respondToAppointmentRequestProposalWithPool(pool, {
        token: expiringProposal.responseToken,
        decision: "accept",
      }, { ...options, now: () => new Date("2035-01-04T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_PROPOSAL_EXPIRED",
    );
    assert.equal((await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [expiring.request.id])).rows[0].status, "pending");

    const rollback = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-12T10:00:00.000Z", true), options);
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, rollback.request.id, 1, admin, {
        ...options,
        afterAppointmentCreated: async () => { throw new Error("forced request rollback"); },
      }),
      /forced request rollback/,
    );
    assert.equal((await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [rollback.request.id])).rows[0].status, "pending");
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
      [rollback.request.customerName],
    )).rows[0].count), 0);

    const concurrentRequest = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-13T10:00:00.000Z"), options);
    const concurrentApprovals = await Promise.all([
      engine.approveAppointmentRequestWithPool(pool, concurrentRequest.request.id, 1, admin, options),
      engine.approveAppointmentRequestWithPool(pool, concurrentRequest.request.id, 1, admin, options),
    ]);
    assert.equal(new Set(concurrentApprovals.map((result) => result.appointment.id)).size, 1);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
      [concurrentRequest.request.customerName],
    )).rows[0].count), 1);

    await assert.rejects(
      engine.getAppointmentRequestWithPool(pool, concurrentRequest.request.id, 2, options),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUESTS_DISABLED",
    );
    const full = await engine.getAppointmentRequestWithPool(pool, concurrentRequest.request.id, 1, options);
    assert.ok(full?.history.some((event: { event_type: string }) => event.event_type === "request_approved"));
    assert.ok(Number((await pool.query(
      "SELECT count(*) AS count FROM audit_logs WHERE entity_type = 'appointment_request'",
    )).rows[0].count) > 0);
    const requestOutbox = await pool.query(`
      SELECT processing_completed_at, whatsapp_status, email_status
      FROM appointment_notification_events WHERE appointment_request_id IS NOT NULL
    `);
    assert.ok(requestOutbox.rowCount && requestOutbox.rowCount > 0);
    assert.ok(requestOutbox.rows.every((event) => event.processing_completed_at
      && event.whatsapp_status === "skipped" && event.email_status === "skipped"));
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_request_segments WHERE request_id = $1",
      [simple.request.id],
    )).rows[0].count), 1, "legacy-compatible single-service requests keep their snapshot without creating a service set");
  } finally {
    if (applicationPool) await applicationPool.end().catch(() => undefined);
    if (pool) await pool.end().catch(() => undefined);
    if (started) await stopEmbeddedPostgres(postgres, databaseDir).catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
    await rm(migrationsDirectory, { recursive: true, force: true });
  }
});
