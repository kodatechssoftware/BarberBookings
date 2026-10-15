import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { runDatabaseBootstrap } from "../server/database-bootstrap";
import {
  BEAUTY_DEMO_CONFIRMATION,
  BEAUTY_DEMO_PROFESSIONAL_EMAIL,
  BeautyDemoSeedError,
  runBeautyDemoSeed,
} from "../server/beauty-demo-seed";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function count(pool: pg.Pool, table: string, where = "", values: unknown[] = []) {
  return Number((await pool.query(`SELECT count(*) AS count FROM ${table} ${where}`, values)).rows[0].count);
}

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-beauty-demo-pg-"));
const port = await availablePort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "beauty-demo-test",
  persistent: false,
  onLog: () => undefined,
  onError: () => undefined,
});
let pool: pg.Pool | undefined;
const environment = {
  NODE_ENV: "test",
  APP_ENV: "development",
  BUSINESS_VERTICAL: "beauty",
  AUTH_RUNTIME_MODE: "canonical",
  DEMO_MODE: "false",
  MIGRATION_DEFAULT_LOCATION_NAME: "Ana Isabel Beauty Test",
  MIGRATION_DEFAULT_LOCATION_ADDRESS: "Morada sintética de teste",
  MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
};
const referenceDate = "2026-10-15";

try {
  await postgres.initialise();
  await postgres.start();
  pool = new pg.Pool({
    connectionString: `postgresql://postgres:beauty-demo-test@127.0.0.1:${port}/postgres`,
    max: 6,
  });
  await runDatabaseBootstrap(pool, { environment });

  const identityBefore = {
    users: await count(pool, "users"),
    admins: await count(pool, "admins"),
    invites: await count(pool, "user_invites"),
  };
  const dryRun = await runBeautyDemoSeed(pool, { mode: "dry-run", referenceDate, environment });
  assert.equal(dryRun.state, "planned");
  assert.equal(dryRun.appointments, 42);
  assert.deepEqual(dryRun.appointmentStates, {
    booked: 9,
    completed: 29,
    cancelled: 2,
    late_cancelled: 1,
    no_show: 1,
  });
  assert.equal(dryRun.completedRevenueCents, 86_000);
  assert.equal(dryRun.projectedRevenueCents, 25_800);
  assert.equal(dryRun.cashCents, 32_400);
  assert.equal(dryRun.cardCents, 53_600);
  assert.equal(dryRun.completedExtrasCents, 7_200);
  assert.equal(await count(pool, "barbers"), 0, "dry-run must not create a professional");

  await assert.rejects(
    runBeautyDemoSeed(pool, { mode: "apply", referenceDate, environment }),
    (error: unknown) => error instanceof BeautyDemoSeedError && /--confirm beauty-dev/.test(error.message),
  );
  await assert.rejects(
    runBeautyDemoSeed(pool, {
      mode: "apply",
      referenceDate,
      confirmation: BEAUTY_DEMO_CONFIRMATION,
      environment: { ...environment, BUSINESS_VERTICAL: "barber" },
    }),
    /BUSINESS_VERTICAL=beauty/,
  );
  await assert.rejects(
    runBeautyDemoSeed(pool, {
      mode: "apply",
      referenceDate,
      confirmation: BEAUTY_DEMO_CONFIRMATION,
      environment: { ...environment, APP_ENV: "production" },
    }),
    /APP_ENV=development/,
  );

  const applied = await runBeautyDemoSeed(pool, {
    mode: "apply",
    referenceDate,
    confirmation: BEAUTY_DEMO_CONFIRMATION,
    environment,
  });
  assert.equal(applied.state, "applied");
  assert.equal(applied.periodExpenseCents, 50_950);
  assert.equal(await count(pool, "barbers", "WHERE email = $1", [BEAUTY_DEMO_PROFESSIONAL_EMAIL]), 1);
  assert.equal(await count(pool, "service_categories"), 3);
  assert.equal(await count(pool, "services"), 7);
  assert.equal(await count(pool, "extra_definitions"), 6);
  assert.equal(await count(pool, "appointments"), 42);
  assert.equal(await count(pool, "business_expense_recurring_series"), 3);
  assert.equal(await count(pool, "business_expense_recurring_versions"), 4);
  assert.equal(await count(pool, "business_expenses"), 8);
  assert.equal(await count(pool, "appointment_notification_events"), 0);
  assert.equal(await count(pool, "whatsapp_messages"), 0);
  assert.equal(await count(pool, "users"), identityBefore.users);
  assert.equal(await count(pool, "admins"), identityBefore.admins);
  assert.equal(await count(pool, "user_invites"), identityBefore.invites);

  const weekShowcaseExtras = await pool.query<{ name_snapshot: string }>(`
    SELECT extra.name_snapshot
    FROM appointment_extras extra
    JOIN appointments appointment ON appointment.id = extra.appointment_id
    WHERE appointment.start_time >= $1 AND appointment.start_time < $2
    ORDER BY extra.name_snapshot
  `, [new Date("2026-10-12T00:00:00.000Z"), new Date("2026-10-19T00:00:00.000Z")]);
  assert.ok(weekShowcaseExtras.rows.some((row) => row.name_snapshot === "Baby Boomer"));
  assert.ok(weekShowcaseExtras.rows.some((row) => row.name_snapshot === "Nail Art elaborada"));
  const futureRent = await pool.query<{ amount_cents: number; effective_from: string }>(`
    SELECT version.amount_cents, version.effective_from::text
    FROM business_expense_recurring_versions version
    JOIN business_expense_recurring_series series ON series.id = version.series_id
    WHERE series.creation_key = 'beauty-demo:ana-isabel:v1:expense:rent'
    ORDER BY version.effective_from DESC
    LIMIT 1
  `);
  assert.deepEqual(futureRent.rows[0], { amount_cents: 32_500, effective_from: "2026-11-01" });

  const concurrent = await Promise.all([
    runBeautyDemoSeed(pool, { mode: "apply", referenceDate, confirmation: BEAUTY_DEMO_CONFIRMATION, environment }),
    runBeautyDemoSeed(pool, { mode: "apply", referenceDate, confirmation: BEAUTY_DEMO_CONFIRMATION, environment }),
  ]);
  assert.ok(concurrent.every((result) => result.state === "already-applied"));
  assert.equal(await count(pool, "appointments"), 42, "rerun/concurrent apply must not duplicate appointments");

  const dryRunAfterApply = await runBeautyDemoSeed(pool, { mode: "dry-run", referenceDate, environment });
  assert.equal(dryRunAfterApply.state, "already-applied");

  const cleaned = await runBeautyDemoSeed(pool, {
    mode: "cleanup",
    referenceDate,
    confirmation: BEAUTY_DEMO_CONFIRMATION,
    environment,
  });
  assert.equal(cleaned.state, "cleaned");
  for (const table of [
    "barbers", "service_categories", "services", "extra_definitions", "appointments",
    "barber_availability", "shop_availability", "business_expense_recurring_series",
    "business_expense_recurring_versions", "business_expenses",
  ]) assert.equal(await count(pool, table), 0, `${table} must be clean after cleanup`);
  assert.equal(await count(pool, "locations"), 1, "cleanup must preserve the Beauty location");
  assert.equal(await count(pool, "users"), identityBefore.users);
  assert.equal(await count(pool, "admins"), identityBefore.admins);
  assert.equal(await count(pool, "user_invites"), identityBefore.invites);

  const secondCleanup = await runBeautyDemoSeed(pool, {
    mode: "cleanup",
    referenceDate,
    confirmation: BEAUTY_DEMO_CONFIRMATION,
    environment,
  });
  assert.equal(secondCleanup.state, "already-clean");
  console.log("Beauty demo seed tests passed.");
} finally {
  await pool?.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
}
