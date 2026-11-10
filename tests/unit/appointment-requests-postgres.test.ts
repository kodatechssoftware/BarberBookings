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
import { MultiServiceAppointmentValidationError } from "../../shared/multi-service-appointments";

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
      "0026_parallel_service_scheduling.sql",
      "0027_admin_request_notifications.sql",
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
      INSERT INTO users (id, display_name, email, password_hash, status) VALUES
        (1, 'Admin QA', 'admin-qa@example.test', 'test-only-password-hash', 'active'),
        (2, 'Admin QA 2', 'admin-qa-2@example.test', 'test-only-password-hash', 'active'),
        (3, 'Sem acesso', 'sem-acesso@example.test', 'test-only-password-hash', 'active')
      ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
      INSERT INTO user_access_scopes (user_id, location_id, preset_key)
      SELECT candidate.user_id, NULL, 'administrator'
      FROM (VALUES (1), (2)) AS candidate(user_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM user_access_scopes existing
        WHERE existing.user_id = candidate.user_id AND existing.location_id IS NULL
      );
      INSERT INTO barbers (id, name, specialty, color, is_visible) VALUES
        (1, 'Ana', 'Unhas', '#111111', true),
        (2, 'Beatriz', 'Estética', '#222222', true),
        (3, 'Carla', 'Cabelo', '#333333', true)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO services (id, name, price, duration, is_visible) VALUES
        (1, 'Manicure', 2000, 30, true),
        (2, 'Nail art', 1000, 45, true),
        (3, 'Penteado', 3000, 60, true)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO barber_locations (barber_id, location_id, is_active) VALUES
        (1, 1, true), (2, 1, true), (3, 1, true)
      ON CONFLICT (barber_id, location_id) DO UPDATE SET is_active = true;
      INSERT INTO service_locations (
        service_id, location_id, is_active, buffer_before_minutes, buffer_after_minutes
      ) VALUES
        (1, 1, true, 10, 5),
        (2, 1, true, 5, 10),
        (3, 1, true, 15, 5)
      ON CONFLICT (service_id, location_id) DO UPDATE SET
        is_active = true,
        buffer_before_minutes = EXCLUDED.buffer_before_minutes,
        buffer_after_minutes = EXCLUDED.buffer_after_minutes;
      INSERT INTO barber_services (barber_id, service_id, location_id) VALUES
        (1, 1, 1), (2, 2, 1), (3, 3, 1)
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
    const adminNotifications = await import("../../server/admin-request-notifications");
    const adminNotificationWorker = await import("../../server/admin-notification-worker");
    const multiServiceEngine = await import("../../server/multi-service-appointment-engine");
    applicationPool = (await import("../../server/db")).pool;
    const options = {
      masterEnabled: true,
      businessVertical: "beauty",
      responseTokenSecret: environment.SESSION_SECRET,
      appointmentNotificationsEnabled: true,
    } as const;
    const admin = { actorType: "admin" as const, actorId: 1, actorName: "Admin QA", actorUserId: 1 };
    let sequence = 0;
    const input = (startTime: string, multi = false, executionMode: "sequential" | "parallel" = "sequential") => ({
      startTime: new Date(startTime),
      customerName: `Cliente ${++sequence}`,
      customerEmail: `cliente-${sequence}@example.test`,
      customerPhone: "+351910000001",
      whatsappOptIn: true,
      idempotencyKey: `request-key-${sequence}`,
      executionMode,
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
        input("2035-01-18T10:00:00.000Z", true, "parallel"),
        options,
      ),
      (error: unknown) => error instanceof multiServiceEngine.MultiServiceFeatureDisabledError,
      "the server refuses a parallel request while the location feature is disabled",
    );

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

    const rolledBackInput = input("2035-01-04T09:00:00.000Z");
    await assert.rejects(
      engine.createAppointmentRequestWithPool(pool, 1, rolledBackInput, {
        ...options,
        afterRequestNotificationCreated: async () => { throw new Error("forced request notification rollback"); },
      }),
      /forced request notification rollback/,
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_requests WHERE idempotency_key = $1",
      [rolledBackInput.idempotencyKey],
    )).rows[0].count), 0);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM admin_notifications",
    )).rows[0].count), 0);

    const simpleInput = input("2035-01-04T10:00:00.000Z");
    const simple = await engine.createAppointmentRequestWithPool(pool, 1, simpleInput, options);
    assert.equal(simple.request.status, "pending");
    assert.equal(simple.request.segments.length, 1);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM appointments")).rows[0].count), 0);
    const pendingRequests = await engine.listAppointmentRequestsWithPool(pool, 1, "pending", options);
    assert.ok(pendingRequests.some((request) => request.id === simple.request.id));
    assert.equal(
      pendingRequests.find((request) => request.id === simple.request.id)?.segments[0].barberName,
      "Ana",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM admin_notifications WHERE appointment_request_id = $1 AND notification_type = 'new_request'",
      [simple.request.id],
    )).rows[0].count), 1);
    const firstUserFeed = await adminNotifications.getAdminNotificationFeed(pool, 1, 1);
    const secondUserFeed = await adminNotifications.getAdminNotificationFeed(pool, 1, 2);
    assert.equal(firstUserFeed.unreadCount, 1);
    assert.equal(firstUserFeed.pendingDecisionCount, 1);
    assert.equal(secondUserFeed.unreadCount, 1);
    assert.equal(firstUserFeed.items[0].requestId, simple.request.id);
    assert.equal(await adminNotifications.markAdminNotificationRead(
      pool, 1, 1, firstUserFeed.items[0].id,
    ), true);
    assert.equal((await adminNotifications.getAdminNotificationFeed(pool, 1, 1)).unreadCount, 0);
    assert.equal((await adminNotifications.getAdminNotificationFeed(pool, 1, 2)).unreadCount, 1);
    assert.equal(await adminNotifications.markAdminNotificationRead(
      pool, 2, 1, firstUserFeed.items[0].id,
    ), false, "a user cannot mark a notification from another location");
    const simpleRetry = await engine.createAppointmentRequestWithPool(pool, 1, simpleInput, options);
    assert.equal(simpleRetry.reused, true);
    assert.equal(simpleRetry.request.id, simple.request.id);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM admin_notifications WHERE appointment_request_id = $1 AND notification_type = 'new_request'",
      [simple.request.id],
    )).rows[0].count), 1, "idempotent request retries do not duplicate administrative notifications");
    await assert.rejects(
      engine.createAppointmentRequestWithPool(pool, 1, { ...simpleInput, customerName: "Different" }, options),
      (error: unknown) => error instanceof engine.AppointmentRequestError
        && error.code === "APPOINTMENT_REQUEST_IDEMPOTENCY_CONFLICT",
    );

    await assert.rejects(
      adminNotifications.updateRequestNotificationSettings(pool, 1, {
        emailEnabled: true,
        reminderEnabled: true,
        reminderDelayMinutes: 30,
        respectOpeningHours: true,
        recipients: [{ userId: 3, isActive: true, newRequestEmail: true, pendingReminderEmail: true }],
      }, { userId: 1, displayName: "Admin QA" }),
      /não está ativo ou não pode gerir marcações/i,
      "a user without location permission cannot be configured as a recipient",
    );
    const notificationSettings = await adminNotifications.updateRequestNotificationSettings(pool, 1, {
      emailEnabled: true,
      reminderEnabled: true,
      reminderDelayMinutes: 30,
      respectOpeningHours: true,
      recipients: [
        { userId: 1, isActive: true, newRequestEmail: true, pendingReminderEmail: true },
        { userId: 2, isActive: false, newRequestEmail: true, pendingReminderEmail: true },
      ],
    }, { userId: 1, displayName: "Admin QA" });
    assert.equal(notificationSettings.emailEnabled, true);
    assert.equal(notificationSettings.reminderEnabled, true);
    assert.equal(notificationSettings.recipients.find((recipient) => recipient.userId === 3)?.eligible, false);

    const workerRequestInput = input("2035-01-08T10:00:00.000Z");
    const workerRequest = await engine.createAppointmentRequestWithPool(pool, 1, workerRequestInput, options);
    await pool.query(`
      UPDATE admin_notifications SET email_delivery_enabled = true
      WHERE appointment_request_id = $1
    `, [workerRequest.request.id]);
    const notificationSchedule = await pool.query<{ notification_type: string; available_at: Date }>(`
      SELECT notification_type, available_at FROM admin_notifications
      WHERE appointment_request_id = $1 ORDER BY available_at, id
    `, [workerRequest.request.id]);
    assert.deepEqual(notificationSchedule.rows.map((row) => row.notification_type).sort(), ["new_request", "pending_reminder"]);
    const reminderAvailableAt = notificationSchedule.rows.find((row) => row.notification_type === "pending_reminder")!.available_at;
    const reminderLocalHour = Number(new Intl.DateTimeFormat("pt-PT", {
      timeZone: "Europe/Lisbon", hour: "2-digit", hour12: false,
    }).format(new Date(reminderAvailableAt)));
    assert.ok(reminderLocalHour >= 8 && reminderLocalHour < 20, "the reminder is deferred into an opening period");

    const sentStaffEmails: Array<{ type: string; key: string; recipient: string }> = [];
    let workerNow = new Date(Math.max(Date.now(), new Date(reminderAvailableAt).getTime()) + 1_000);
    let failedOnce = false;
    const workerDependencies: import("../../server/admin-notification-worker").AdminRequestNotificationWorkerDependencies = {
      databasePool: pool,
      processingEnabled: true,
      now: () => workerNow,
      sendEmail: async (email) => {
        sentStaffEmails.push({ type: email.notificationType, key: email.idempotencyKey, recipient: email.recipientEmail });
        if (!failedOnce && email.notificationType === "new_request") {
          failedOnce = true;
          return { sent: false, providerMessageId: null, errorCode: "EMAIL_NETWORK_ERROR" };
        }
        return { sent: true, providerMessageId: `mock-${sentStaffEmails.length}`, errorCode: null };
      },
    };
    await adminNotificationWorker.processPendingAdminRequestNotificationEmails(workerDependencies);
    assert.equal(sentStaffEmails.filter((email) => email.type === "new_request").length, 1);
    assert.equal(sentStaffEmails.filter((email) => email.type === "pending_reminder").length, 1);
    assert.equal(new Set(sentStaffEmails.map((email) => email.key)).size, sentStaffEmails.length, "every delivery has a deterministic recipient idempotency key");
    assert.deepEqual(new Set(sentStaffEmails.map((email) => email.recipient)), new Set(["admin-qa@example.test"]));
    assert.equal((await pool.query(`
      SELECT email_status FROM admin_notification_user_states state
      JOIN admin_notifications notification ON notification.id = state.notification_id
      WHERE notification.appointment_request_id = $1 AND notification.notification_type = 'new_request'
    `, [workerRequest.request.id])).rows[0].email_status, "retry");
    workerNow = new Date(workerNow.getTime() + 61_000);
    await adminNotificationWorker.processPendingAdminRequestNotificationEmails(workerDependencies);
    assert.equal(sentStaffEmails.filter((email) => email.type === "new_request").length, 2, "a transient failure is retried once it is due");
    assert.equal((await pool.query(`
      SELECT email_status FROM admin_notification_user_states state
      JOIN admin_notifications notification ON notification.id = state.notification_id
      WHERE notification.appointment_request_id = $1 AND notification.notification_type = 'new_request'
    `, [workerRequest.request.id])).rows[0].email_status, "sent");

    const recoveryRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-09T10:00:00.000Z"), options,
    );
    await pool.query(`
      UPDATE admin_notifications SET email_delivery_enabled = true
      WHERE appointment_request_id = $1 AND notification_type = 'new_request'
    `, [recoveryRequest.request.id]);
    workerNow = new Date();
    await adminNotificationWorker.prepareDueAdminRequestNotificationEmails(workerDependencies);
    await pool.query(`
      UPDATE admin_notification_user_states
      SET email_status = 'sending', email_lease_started_at = $2, next_email_attempt_at = NULL
      WHERE notification_id = (
        SELECT id FROM admin_notifications WHERE appointment_request_id = $1 AND notification_type = 'new_request'
      )
    `, [recoveryRequest.request.id, new Date(workerNow.getTime() - 120_000)]);
    workerNow = new Date(workerNow.getTime() + 1_000);
    await adminNotificationWorker.processPendingAdminRequestNotificationEmails(workerDependencies);
    assert.equal((await pool.query(`
      SELECT email_status FROM admin_notification_user_states state
      JOIN admin_notifications notification ON notification.id = state.notification_id
      WHERE notification.appointment_request_id = $1 AND notification.notification_type = 'new_request'
    `, [recoveryRequest.request.id])).rows[0].email_status, "sent", "an abandoned lease is recovered after restart");

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
    const approvedRequests = await engine.listAppointmentRequestsWithPool(pool, 1, "approved", options);
    assert.ok(approvedRequests.some((request) => request.id === simple.request.id));
    const allRequestsAfterApproval = await engine.listAppointmentRequestsWithPool(pool, 1, undefined, options);
    assert.ok(allRequestsAfterApproval.some((request) => request.id === simple.request.id));
    assert.equal(
      (await engine.listAppointmentRequestsWithPool(pool, 1, "pending", options))
        .some((request) => request.id === simple.request.id),
      false,
    );

    const multi = await engine.createAppointmentRequestWithPool(pool, 1, input("2035-01-05T10:00:00.000Z", true), options);
    const multiApproved = await engine.approveAppointmentRequestWithPool(pool, multi.request.id, 1, admin, options);
    assert.equal(multiApproved.request.status, "approved");
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments WHERE appointment_id = $1",
      [multiApproved.request.appointmentId],
    )).rows[0].count), 2);

    await pool.query(`
      INSERT INTO business_feature_settings (feature_name, location_id, enabled)
      VALUES ('parallelServiceScheduling', 1, true)
      ON CONFLICT (feature_name, location_id) WHERE location_id IS NOT NULL
      DO UPDATE SET enabled = true;
      INSERT INTO parallel_service_compatibilities (location_id, first_service_id, second_service_id)
      VALUES (1, 1, 2)
      ON CONFLICT DO NOTHING
    `);
    const sequentialChoicePreview = await multiServiceEngine.previewSequentialAppointmentAvailabilityWithPool(pool, {
      locationId: 1,
      date: "2035-01-16",
      executionMode: "sequential",
      services: [{ serviceId: 1, barberId: 1 }, { serviceId: 2, barberId: 2 }],
      slotIntervalMinutes: 30,
      now: new Date("2035-01-01T00:00:00.000Z"),
    }, options);
    assert.equal(sequentialChoicePreview.executionMode, "sequential");
    assert.equal(sequentialChoicePreview.parallelEligible, true);
    assert.equal(sequentialChoicePreview.sequentialDurationMinutes, 75);
    assert.equal(sequentialChoicePreview.parallelDurationMinutes, 45);
    assert.equal(sequentialChoicePreview.durationMinutes, 75);
    assert.deepEqual(sequentialChoicePreview.segments.map((segment) => segment.executionStage), [0, 1]);

    const parallelChoicePreview = await multiServiceEngine.previewSequentialAppointmentAvailabilityWithPool(pool, {
      locationId: 1,
      date: "2035-01-16",
      executionMode: "parallel",
      services: [{ serviceId: 1, barberId: 1 }, { serviceId: 2, barberId: 2 }],
      slotIntervalMinutes: 30,
      now: new Date("2035-01-01T00:00:00.000Z"),
    }, options);
    assert.equal(parallelChoicePreview.durationMinutes, 45);
    assert.deepEqual(parallelChoicePreview.segments.map((segment) => segment.executionStage), [0, 0]);

    const explicitlySequentialRequest = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-16T10:00:00.000Z", true, "sequential"),
      options,
    );
    assert.deepEqual(
      explicitlySequentialRequest.request.segments.map((segment) => segment.executionStage),
      [0, 1],
    );
    const explicitlySequentialApproved = await engine.approveAppointmentRequestWithPool(
      pool, explicitlySequentialRequest.request.id, 1, admin, options,
    );
    assert.equal(explicitlySequentialApproved.appointment.durationMinutes, 75);

    const parallelRequest = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-14T10:00:00.000Z", true, "parallel"),
      options,
    );
    assert.deepEqual(parallelRequest.request.segments.map((segment) => segment.executionStage), [0, 0]);
    assert.deepEqual(parallelRequest.request.segments.map((segment) => segment.startTime.toISOString()), [
      "2035-01-14T10:00:00.000Z",
      "2035-01-14T10:00:00.000Z",
    ]);

    await pool.query(`DELETE FROM parallel_service_compatibilities WHERE location_id = 1`);
    await assert.rejects(
      engine.createAppointmentRequestWithPool(
        pool,
        1,
        input("2035-01-17T10:00:00.000Z", true, "parallel"),
        options,
      ),
      (error: unknown) => error instanceof MultiServiceAppointmentValidationError
        && error.code === "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID",
      "request creation revalidates compatibility instead of trusting the public interface",
    );
    await assert.rejects(
      engine.approveAppointmentRequestWithPool(pool, parallelRequest.request.id, 1, admin, options),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
      "approval revalidates compatibility changed since the request was submitted",
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [parallelRequest.request.id])).rows[0].status,
      "pending",
    );
    await pool.query(`
      INSERT INTO parallel_service_compatibilities (location_id, first_service_id, second_service_id)
      VALUES (1, 1, 2)
    `);
    const parallelApproved = await engine.approveAppointmentRequestWithPool(
      pool,
      parallelRequest.request.id,
      1,
      admin,
      options,
    );
    assert.equal(parallelApproved.appointment.durationMinutes, 45);
    assert.deepEqual(
      (await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, parallelApproved.appointment.id))
        .map((segment) => segment.executionStage),
      [0, 0],
    );
    for (const selection of [
      { serviceId: 1, barberId: 1 },
      { serviceId: 2, barberId: 2 },
    ]) {
      const professionalAvailability = await multiServiceEngine.previewSequentialAppointmentAvailabilityWithPool(pool, {
        locationId: 1,
        date: "2035-01-14",
        services: [selection],
        slotIntervalMinutes: 30,
        now: new Date("2035-01-01T00:00:00.000Z"),
      }, options);
      assert.equal(
        professionalAvailability.starts.includes("2035-01-14T10:00:00.000Z"),
        false,
        `the public availability hides the occupied slot for professional ${selection.barberId}`,
      );
    }

    const approvedOccupancyCount = Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [parallelApproved.appointment.id],
    )).rows[0].count);
    await pool.query(`DELETE FROM parallel_service_compatibilities WHERE location_id = 1`);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [parallelApproved.appointment.id],
    )).rows[0].count), approvedOccupancyCount, "compatibility changes do not rewrite an approved appointment");
    assert.deepEqual(
      (await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, parallelApproved.appointment.id))
        .map((segment) => segment.executionStage),
      [0, 0],
      "approved execution stages remain immutable after compatibility changes",
    );
    await pool.query(`
      INSERT INTO parallel_service_compatibilities (location_id, first_service_id, second_service_id)
      VALUES (1, 1, 2)
    `);
    await pool.query(`
      UPDATE business_feature_settings
      SET enabled = false
      WHERE feature_name = 'parallelServiceScheduling' AND location_id = 1
    `);
    await assert.rejects(
      engine.createAppointmentRequestWithPool(
        pool,
        1,
        input("2035-01-22T10:00:00.000Z", true, "parallel"),
        options,
      ),
      (error: unknown) => error instanceof multiServiceEngine.MultiServiceFeatureDisabledError,
      "disabling parallel scheduling rejects new parallel requests",
    );
    const sequentialWhileParallelDisabled = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-22T12:00:00.000Z", true, "sequential"),
      options,
    );
    assert.deepEqual(
      sequentialWhileParallelDisabled.request.segments.map((segment) => segment.executionStage),
      [0, 1],
      "sequential requests remain available while parallel scheduling is disabled",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [parallelApproved.appointment.id],
    )).rows[0].count), approvedOccupancyCount, "existing approved parallel appointments remain intact");
    await pool.query(`
      UPDATE business_feature_settings
      SET enabled = true
      WHERE feature_name = 'parallelServiceScheduling' AND location_id = 1
    `);
    await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [parallelApproved.appointment.id]);
    assert.equal(
      (await pool.query("SELECT status FROM appointments WHERE id = $1", [parallelApproved.appointment.id])).rows[0].status,
      "cancelled",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments WHERE appointment_id = $1",
      [parallelApproved.appointment.id],
    )).rows[0].count), 2, "cancellation retains the complete parallel service history");
    for (const selection of [
      { serviceId: 1, barberId: 1 },
      { serviceId: 2, barberId: 2 },
    ]) {
      const releasedAvailability = await multiServiceEngine.previewSequentialAppointmentAvailabilityWithPool(pool, {
        locationId: 1,
        date: "2035-01-14",
        services: [selection],
        slotIntervalMinutes: 30,
        now: new Date("2035-01-01T00:00:00.000Z"),
      }, options);
      assert.equal(
        releasedAvailability.starts.includes("2035-01-14T10:00:00.000Z"),
        true,
        `cancellation restores public availability for professional ${selection.barberId}`,
      );
    }

    const proposedParallel = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-15T10:00:00.000Z", true, "parallel"),
      options,
    );
    const parallelProposal = await engine.proposeAppointmentRequestTimeWithPool(pool, proposedParallel.request.id, 1, {
      startTime: new Date("2035-01-15T12:00:00.000Z"),
      expiresAt: new Date("2035-01-15T11:00:00.000Z"),
      commandKey: "parallel-proposal-command",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    const acceptedParallelProposal = await engine.respondToAppointmentRequestProposalWithPool(pool, {
      token: parallelProposal.responseToken,
      decision: "accept",
    }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") });
    assert.equal(acceptedParallelProposal.appointment.durationMinutes, 45);
    assert.deepEqual(
      (await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, acceptedParallelProposal.appointment.id))
        .map((segment) => [segment.executionStage, segment.startTime.toISOString()]),
      [[0, "2035-01-15T12:00:00.000Z"], [0, "2035-01-15T12:00:00.000Z"]],
    );

    const blockedParallelProposalRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-21T10:00:00.000Z", true, "parallel"), options,
    );
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-01-21 12:00:00', 'Parallel proposal blocker', '+351910000091', 45, 'booked', 'parallel-proposal-blocker')
    `);
    await assert.rejects(
      engine.proposeAppointmentRequestTimeWithPool(pool, blockedParallelProposalRequest.request.id, 1, {
        startTime: new Date("2035-01-21T12:00:00.000Z"),
        expiresAt: new Date("2035-01-21T11:00:00.000Z"),
        commandKey: "parallel-proposal-preflight-conflict",
      }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError
        && error.code === "APPOINTMENT_REQUEST_TIME_UNAVAILABLE"
        && /todos os profissionais/i.test(error.message),
      "a conflict with one professional prevents a parallel proposal from being recorded",
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [blockedParallelProposalRequest.request.id])).rows[0].status,
      "pending",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_request_proposals WHERE request_id = $1",
      [blockedParallelProposalRequest.request.id],
    )).rows[0].count), 0);

    const blockedSequentialProposalRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-23T10:00:00.000Z", true, "sequential"), options,
    );
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-01-23 12:15:00', 'Sequential proposal blocker', '+351910000092', 12, 'booked', 'sequential-proposal-blocker')
    `);
    await assert.rejects(
      engine.proposeAppointmentRequestTimeWithPool(pool, blockedSequentialProposalRequest.request.id, 1, {
        startTime: new Date("2035-01-23T12:00:00.000Z"),
        expiresAt: new Date("2035-01-23T11:00:00.000Z"),
        commandKey: "sequential-proposal-preflight-conflict",
      }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
      "the proposal preflight validates every sequential offset and its buffers",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_request_proposals WHERE request_id = $1",
      [blockedSequentialProposalRequest.request.id],
    )).rows[0].count), 0);

    const outsideHoursProposalRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-25T10:00:00.000Z", true, "sequential"), options,
    );
    await assert.rejects(
      engine.proposeAppointmentRequestTimeWithPool(pool, outsideHoursProposalRequest.request.id, 1, {
        startTime: new Date("2035-01-25T19:30:00.000Z"),
        expiresAt: new Date("2035-01-25T18:00:00.000Z"),
        commandKey: "sequential-proposal-outside-hours",
      }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
      "proposal preflight respects working periods and complete service duration",
    );

    const activeProposalRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-24T09:00:00.000Z", true, "parallel"), options,
    );
    const activeProposal = await engine.proposeAppointmentRequestTimeWithPool(pool, activeProposalRequest.request.id, 1, {
      startTime: new Date("2035-01-24T10:00:00.000Z"),
      expiresAt: new Date("2035-01-24T09:30:00.000Z"),
      commandKey: "active-proposal-before-invalid-replacement",
    }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") });
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 1, 1, '2035-01-24 14:00:00', 'Replacement blocker', '+351910000093', 30, 'booked', 'replacement-proposal-blocker')
    `);
    await assert.rejects(
      engine.proposeAppointmentRequestTimeWithPool(pool, activeProposalRequest.request.id, 1, {
        startTime: new Date("2035-01-24T14:00:00.000Z"),
        expiresAt: new Date("2035-01-24T13:00:00.000Z"),
        commandKey: "invalid-replacement-proposal",
      }, admin, { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_request_proposals WHERE id = $1", [activeProposal.proposal.id])).rows[0].status,
      "active",
      "a failed replacement leaves the previous valid proposal active",
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [activeProposalRequest.request.id])).rows[0].status,
      "proposed",
    );

    const conflictedParallelProposalRequest = await engine.createAppointmentRequestWithPool(
      pool,
      1,
      input("2035-01-19T10:00:00.000Z", true, "parallel"),
      options,
    );
    const conflictedParallelProposal = await engine.proposeAppointmentRequestTimeWithPool(
      pool,
      conflictedParallelProposalRequest.request.id,
      1,
      {
        startTime: new Date("2035-01-19T12:00:00.000Z"),
        expiresAt: new Date("2035-01-19T11:00:00.000Z"),
        commandKey: "parallel-proposal-conflict",
      },
      admin,
      { ...options, now: () => new Date("2035-01-01T00:00:00.000Z") },
    );
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-01-19 12:00:00', 'Proposal occupier', '+351910000099', 45, 'booked', 'proposal-occupier')
    `);
    await assert.rejects(
      engine.respondToAppointmentRequestProposalWithPool(pool, {
        token: conflictedParallelProposal.responseToken,
        decision: "accept",
      }, { ...options, now: () => new Date("2035-01-02T00:00:00.000Z") }),
      (error: unknown) => error instanceof engine.AppointmentRequestAvailabilityError,
      "proposal acceptance revalidates every professional and fails the complete request",
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_requests WHERE id = $1", [conflictedParallelProposalRequest.request.id])).rows[0].status,
      "pending",
    );
    assert.equal(
      (await pool.query("SELECT status FROM appointment_request_proposals WHERE id = $1", [conflictedParallelProposal.proposal.id])).rows[0].status,
      "unavailable",
    );
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointments WHERE customer_name = $1",
      [conflictedParallelProposalRequest.request.customerName],
    )).rows[0].count), 0);
    assert.deepEqual(
      (await pool.query(
        "SELECT execution_stage FROM appointment_request_segments WHERE request_id = $1 ORDER BY position",
        [conflictedParallelProposalRequest.request.id],
      )).rows.map((row) => row.execution_stage),
      [0, 0],
      "an unavailable proposal preserves the requested parallel execution group",
    );

    const firstConcurrentParallel = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-20T10:00:00.000Z", true, "parallel"), options,
    );
    const secondConcurrentParallel = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-20T10:00:00.000Z", true, "parallel"), options,
    );
    const distinctConcurrentApprovals = await Promise.allSettled([
      engine.approveAppointmentRequestWithPool(pool, firstConcurrentParallel.request.id, 1, admin, options),
      engine.approveAppointmentRequestWithPool(pool, secondConcurrentParallel.request.id, 1, admin, options),
    ]);
    assert.equal(distinctConcurrentApprovals.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(distinctConcurrentApprovals.filter((result) => result.status === "rejected"
      && result.reason instanceof engine.AppointmentRequestAvailabilityError).length, 1);
    const concurrentParallelAppointments = await pool.query<{ id: number }>(`
      SELECT id FROM appointments WHERE customer_name = ANY($1::text[])
    `, [[firstConcurrentParallel.request.customerName, secondConcurrentParallel.request.customerName]]);
    assert.equal(concurrentParallelAppointments.rowCount, 1);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_service_segments WHERE appointment_id = $1",
      [concurrentParallelAppointments.rows[0].id],
    )).rows[0].count), 2);
    assert.equal(Number((await pool.query(
      "SELECT count(*) AS count FROM appointment_occupancy_periods WHERE appointment_id = $1",
      [concurrentParallelAppointments.rows[0].id],
    )).rows[0].count), 2);

    const threeServiceInput = {
      ...input("2035-02-01T10:00:00.000Z", true, "sequential"),
      services: [
        { serviceId: 1, barberId: 1 },
        { serviceId: 2, barberId: 2 },
        { serviceId: 3, barberId: 3 },
      ],
    };
    const threeServiceRequest = await engine.createAppointmentRequestWithPool(pool, 1, threeServiceInput, options);
    const threeServiceApproved = await engine.approveAppointmentRequestWithPool(
      pool, threeServiceRequest.request.id, 1, admin, options,
    );
    assert.equal(threeServiceApproved.appointment.durationMinutes, 135);
    const threeServiceId = threeServiceApproved.appointment.id;
    const threeServicePreview = await multiServiceEngine.previewMultiServiceRescheduleAvailabilityWithPool(pool, {
      appointmentId: threeServiceId,
      locationId: 1,
      expectedRevision: 0,
      date: "2035-02-02",
      slotIntervalMinutes: 30,
      now: new Date("2035-01-01T00:00:00.000Z"),
    }, options);
    assert.ok(threeServicePreview.starts.includes("2035-02-02T12:00:00.000Z"));
    assert.equal(threeServicePreview.durationMinutes, 135);
    assert.equal(threeServicePreview.totalPriceCents, 6000);
    assert.deepEqual(threeServicePreview.segments.map((segment) => segment.startOffsetMinutes), [0, 30, 75]);

    const rescheduledSequential = await multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
      appointmentId: threeServiceId,
      locationId: 1,
      expectedRevision: 0,
      startTime: new Date("2035-02-02T12:00:00.000Z"),
      reminderAvailableAt: new Date("2035-02-01T12:00:00.000Z"),
      actor: admin,
    }, options);
    assert.equal(rescheduledSequential.reused, false);
    assert.equal(rescheduledSequential.rescheduleRevision, 1);
    assert.ok(rescheduledSequential.notificationEventId);
    assert.deepEqual(
      rescheduledSequential.segments.map((segment) => [segment.executionStage, segment.startTime.toISOString()]),
      [
        [0, "2035-02-02T12:00:00.000Z"],
        [1, "2035-02-02T12:30:00.000Z"],
        [2, "2035-02-02T13:15:00.000Z"],
      ],
    );
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_occupancy_periods
      WHERE appointment_id = $1 AND start_time < '2035-02-02 00:00:00'
    `, [threeServiceId])).rows[0].count), 0, "old occupancy is released atomically");
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_notification_events
      WHERE appointment_id = $1 AND event_type = 'appointment_rescheduled'
    `, [threeServiceId])).rows[0].count), 1);
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_notification_events
      WHERE appointment_id = $1 AND event_type = 'appointment_reminder_day_before'
        AND event_revision = 2 AND available_at = '2035-02-01 12:00:00'
    `, [threeServiceId])).rows[0].count), 1, "the replacement reminder is created in the same transaction");
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM audit_logs
      WHERE entity_type = 'appointment' AND entity_id = $1 AND action = 'appointment.rescheduled'
    `, [threeServiceId])).rows[0].count), 1);

    const idempotentSequentialRetry = await multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
      appointmentId: threeServiceId,
      locationId: 1,
      expectedRevision: 0,
      startTime: new Date("2035-02-02T12:00:00.000Z"),
      actor: admin,
    }, options);
    assert.equal(idempotentSequentialRetry.reused, true);
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM appointment_notification_events
      WHERE appointment_id = $1 AND event_type = 'appointment_rescheduled'
    `, [threeServiceId])).rows[0].count), 1, "an identical retry does not duplicate the outbox event");
    await assert.rejects(
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: threeServiceId,
        locationId: 1,
        expectedRevision: 0,
        startTime: new Date("2035-02-03T12:00:00.000Z"),
        actor: admin,
      }, options),
      (error: unknown) => error instanceof multiServiceEngine.MultiServiceRescheduleError
        && error.code === "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT",
      "a stale revision cannot reuse the management token for a different change",
    );

    const concurrentReschedules = await Promise.allSettled([
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: threeServiceId,
        locationId: 1,
        expectedRevision: 1,
        startTime: new Date("2035-02-06T10:00:00.000Z"),
        actor: admin,
      }, options),
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: threeServiceId,
        locationId: 1,
        expectedRevision: 1,
        startTime: new Date("2035-02-07T10:00:00.000Z"),
        actor: admin,
      }, options),
    ]);
    assert.equal(concurrentReschedules.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentReschedules.filter((result) => result.status === "rejected"
      && result.reason instanceof multiServiceEngine.MultiServiceRescheduleError
      && result.reason.code === "MULTI_SERVICE_RESCHEDULE_REVISION_CONFLICT").length, 1);
    const afterConcurrent = await pool.query<{
      start_time: Date;
      reschedule_revision: number;
      notification_revision: number;
    }>(`SELECT start_time, reschedule_revision, notification_revision FROM appointments WHERE id = $1`, [threeServiceId]);
    assert.equal(Number(afterConcurrent.rows[0].reschedule_revision), 2);
    assert.equal(Number(afterConcurrent.rows[0].notification_revision), 3);
    const afterConcurrentSegments = await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, threeServiceId);
    assert.deepEqual(afterConcurrentSegments.map((segment) => segment.executionStage), [0, 1, 2]);
    assert.deepEqual(afterConcurrentSegments.map((segment) =>
      Math.round((segment.startTime.getTime() - new Date(afterConcurrent.rows[0].start_time).getTime()) / 60_000)), [0, 30, 75]);

    const beforeForcedRollback = await pool.query<{
      start_time: Date;
      reschedule_revision: number;
      notification_revision: number;
    }>(`SELECT start_time, reschedule_revision, notification_revision FROM appointments WHERE id = $1`, [threeServiceId]);
    const beforeForcedRollbackSegments = await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, threeServiceId);
    await assert.rejects(
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: threeServiceId,
        locationId: 1,
        expectedRevision: 2,
        startTime: new Date("2035-02-08T10:00:00.000Z"),
        actor: admin,
      }, {
        ...options,
        afterSegmentsRescheduled: async () => { throw new Error("forced multi-service reschedule rollback"); },
      }),
      /forced multi-service reschedule rollback/,
    );
    const afterForcedRollback = await pool.query<{
      start_time: Date;
      reschedule_revision: number;
      notification_revision: number;
    }>(`SELECT start_time, reschedule_revision, notification_revision FROM appointments WHERE id = $1`, [threeServiceId]);
    assert.deepEqual(afterForcedRollback.rows[0], beforeForcedRollback.rows[0]);
    assert.deepEqual(
      (await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, threeServiceId))
        .map((segment) => segment.startTime.toISOString()),
      beforeForcedRollbackSegments.map((segment) => segment.startTime.toISOString()),
      "a failed mutation rolls back every segment",
    );

    const parallelRescheduleRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-02-10T10:00:00.000Z", true, "parallel"), options,
    );
    const parallelRescheduleApproved = await engine.approveAppointmentRequestWithPool(
      pool, parallelRescheduleRequest.request.id, 1, admin, options,
    );
    const parallelRescheduleId = parallelRescheduleApproved.appointment.id;
    const rescheduledParallel = await multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
      appointmentId: parallelRescheduleId,
      locationId: 1,
      expectedRevision: 0,
      startTime: new Date("2035-02-11T12:00:00.000Z"),
      actor: admin,
    }, options);
    assert.deepEqual(
      rescheduledParallel.segments.map((segment) => [segment.executionStage, segment.startTime.toISOString()]),
      [[0, "2035-02-11T12:00:00.000Z"], [0, "2035-02-11T12:00:00.000Z"]],
      "parallel groups remain intact",
    );
    await pool.query(`
      INSERT INTO parallel_service_compatibilities (location_id, first_service_id, second_service_id)
      VALUES (1, 1, 3), (1, 2, 3)
      ON CONFLICT DO NOTHING
    `);
    const threeProfessionalParallelInput = {
      ...input("2035-02-15T10:00:00.000Z", true, "parallel"),
      services: [
        { serviceId: 1, barberId: 1 },
        { serviceId: 2, barberId: 2 },
        { serviceId: 3, barberId: 3 },
      ],
    };
    const threeProfessionalParallelRequest = await engine.createAppointmentRequestWithPool(
      pool, 1, threeProfessionalParallelInput, options,
    );
    const threeProfessionalParallelApproved = await engine.approveAppointmentRequestWithPool(
      pool, threeProfessionalParallelRequest.request.id, 1, admin, options,
    );
    const threeProfessionalParallelRescheduled = await multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
      appointmentId: threeProfessionalParallelApproved.appointment.id,
      locationId: 1,
      expectedRevision: 0,
      startTime: new Date("2035-02-16T10:00:00.000Z"),
      actor: admin,
    }, options);
    assert.equal(threeProfessionalParallelApproved.appointment.durationMinutes, 60);
    assert.deepEqual(
      threeProfessionalParallelRescheduled.segments.map((segment) => [
        segment.barberId,
        segment.executionStage,
        segment.startTime.toISOString(),
      ]),
      [
        [1, 0, "2035-02-16T10:00:00.000Z"],
        [2, 0, "2035-02-16T10:00:00.000Z"],
        [3, 0, "2035-02-16T10:00:00.000Z"],
      ],
      "three different professionals remain in the same parallel execution stage",
    );
    await pool.query(`
      INSERT INTO appointments (
        location_id, barber_id, service_id, start_time, customer_name, customer_phone,
        duration_minutes, status, cancel_token
      ) VALUES (1, 2, 2, '2035-02-12 12:00:00', 'Reschedule blocker', '+351910000094', 45, 'booked', 'reschedule-blocker')
    `);
    const parallelBeforeConflict = await pool.query(`
      SELECT start_time, reschedule_revision, notification_revision
      FROM appointments WHERE id = $1
    `, [parallelRescheduleId]);
    const parallelSegmentsBeforeConflict = await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, parallelRescheduleId);
    await assert.rejects(
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: parallelRescheduleId,
        locationId: 1,
        expectedRevision: 1,
        startTime: new Date("2035-02-12T12:00:00.000Z"),
        actor: admin,
      }, options),
      (error: unknown) => error instanceof multiServiceEngine.MultiServiceConflictError,
      "a conflict affecting one professional rejects the complete parallel move",
    );
    assert.deepEqual((await pool.query(`
      SELECT start_time, reschedule_revision, notification_revision
      FROM appointments WHERE id = $1
    `, [parallelRescheduleId])).rows[0], parallelBeforeConflict.rows[0]);
    assert.deepEqual(
      (await multiServiceEngine.getMultiServiceAppointmentSegmentsWithPool(pool, parallelRescheduleId))
        .map((segment) => segment.startTime.toISOString()),
      parallelSegmentsBeforeConflict.map((segment) => segment.startTime.toISOString()),
    );

    const calendar = await import("../../server/calendar-timezone");
    const postDstStart = calendar.calendarDateTimeToInstant({
      year: 2035, month: 3, day: 25, hour: 9, minute: 0, second: 0,
    }, "Europe/Lisbon");
    const dstReschedule = await multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
      appointmentId: parallelRescheduleId,
      locationId: 1,
      expectedRevision: 1,
      startTime: postDstStart,
      actor: admin,
    }, options);
    assert.equal(new Intl.DateTimeFormat("pt-PT", {
      timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(dstReschedule.startTime), "09:00");
    assert.ok(dstReschedule.segments.every((segment) => segment.startTime.getTime() === postDstStart.getTime()));
    const beforeExpiredTokenAttempt = await pool.query(`
      SELECT start_time, reschedule_revision, notification_revision
      FROM appointments WHERE id = $1
    `, [parallelRescheduleId]);
    await assert.rejects(
      multiServiceEngine.rescheduleMultiServiceAppointmentWithPool(pool, {
        appointmentId: parallelRescheduleId,
        locationId: 1,
        expectedRevision: 2,
        startTime: new Date("2035-03-27T10:00:00.000Z"),
        requireFutureCurrentStart: true,
        actor: { actorType: "client", actorName: "Cliente" },
      }, {
        ...options,
        now: () => new Date("2035-03-26T10:00:00.000Z"),
      }),
      (error: unknown) => error instanceof multiServiceEngine.MultiServiceRescheduleError
        && error.code === "MULTI_SERVICE_RESCHEDULE_TOKEN_EXPIRED",
      "a public reschedule token expires when the current appointment starts",
    );
    assert.deepEqual((await pool.query(`
      SELECT start_time, reschedule_revision, notification_revision
      FROM appointments WHERE id = $1
    `, [parallelRescheduleId])).rows, beforeExpiredTokenAttempt.rows);

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
      pool,
      refused.request.id,
      1,
      { reason: "Sem disponibilidade" },
      admin,
      { ...options, now: () => new Date(refused.request.createdAt) },
    );
    assert.equal(refusedResult.request.status, "refused");
    assert.ok(
      (await engine.listAppointmentRequestsWithPool(pool, 1, "refused", options))
        .some((request) => request.id === refused.request.id),
    );
    assert.ok(
      (await engine.listAppointmentRequestsWithPool(pool, 1, undefined, options))
        .some((request) => request.id === refused.request.id),
    );
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM admin_notifications
      WHERE appointment_request_id = $1 AND notification_type = 'pending_reminder' AND cancelled_at IS NULL
    `, [refused.request.id])).rows[0].count), 0, "refusing a request cancels its reminder");
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
    assert.ok(
      (await engine.listAppointmentRequestsWithPool(pool, 1, "proposed", options))
        .some((request) => request.id === proposed.request.id),
    );
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM admin_notifications
      WHERE appointment_request_id = $1 AND notification_type = 'pending_reminder' AND cancelled_at IS NULL
    `, [proposed.request.id])).rows[0].count), 0, "a proposal is not treated as an unanswered pending request");
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
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM admin_notifications
      WHERE appointment_request_id = $1 AND notification_type = 'pending_reminder' AND cancelled_at IS NULL
    `, [proposed.request.id])).rows[0].count), 0, "accepting a proposal leaves no pending reminder");
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
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count FROM admin_notifications
      WHERE appointment_request_id = $1 AND notification_type = 'pending_reminder' AND cancelled_at IS NULL
    `, [rejected.request.id])).rows[0].count), 1, "rejecting a proposal schedules one fresh pending reminder");

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

    const rollback = await engine.createAppointmentRequestWithPool(
      pool, 1, input("2035-01-12T10:00:00.000Z", true, "parallel"), options,
    );
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
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count
      FROM appointment_service_segments segment
      JOIN appointments appointment ON appointment.id = segment.appointment_id
      WHERE appointment.customer_name = $1
    `, [rollback.request.customerName])).rows[0].count), 0);
    assert.equal(Number((await pool.query(`
      SELECT count(*) AS count
      FROM appointment_occupancy_periods occupancy
      JOIN appointments appointment ON appointment.id = occupancy.appointment_id
      WHERE appointment.customer_name = $1
    `, [rollback.request.customerName])).rows[0].count), 0);

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
    assert.equal(
      full?.history.find((event: { event_type: string }) => event.event_type === "request_approved")?.actor_name,
      "Admin QA",
    );
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
