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

test("real PostgreSQL rolls back the complete appointment PATCH when Extra validation fails", { timeout: 180_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-appointment-extras-update-pg-"));
  const postgresPort = await availablePort();
  const password = "appointment-extras-update-test";
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

  try {
    await postgres.initialise();
    await postgres.start();
    postgresStarted = true;
    const serverUrl = `postgresql://postgres:${password}@127.0.0.1:${postgresPort}/`;
    const bootstrapPool = new pg.Pool({ connectionString: `${serverUrl}postgres` });
    await bootstrapPool.query("CREATE DATABASE appointment_extras_update_test ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await bootstrapPool.end();
    const databaseUrl = `${serverUrl}appointment_extras_update_test`;
    const environment = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      DATABASE_POOL_MAX: "4",
      NODE_ENV: "test",
      APP_ENV: "development",
      USE_MEMORY_STORAGE: "false",
      DEMO_MODE: "false",
      MULTI_LOCATION_ENABLED: "false",
      MAX_LOCATIONS: "1",
      SHOP_TIME_ZONE: "Europe/Lisbon",
      PERFORMANCE_TIMINGS_ENABLED: "false",
    } satisfies NodeJS.ProcessEnv;

    await runCommand(process.execPath, [path.resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"], environment);
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await runSchemaMigrations(pool, {
      schemaName: "public",
      environment: {
        ...environment,
        MIGRATION_DEFAULT_LOCATION_NAME: "Appointment Extras Test",
        MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
        MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
      },
    });

    const locationId = Number((await pool.query("SELECT id FROM locations WHERE is_default = true")).rows[0].id);
    const barberId = Number((await pool.query(`
      INSERT INTO barbers (name, specialty, color, is_visible)
      VALUES ('Barbeiro Extras PATCH', 'Test', '#112233', true) RETURNING id
    `)).rows[0].id);
    const serviceId = Number((await pool.query(`
      INSERT INTO services (name, price, duration, is_visible)
      VALUES ('Corte Extras PATCH', 1500, 30, true) RETURNING id
    `)).rows[0].id);
    await pool.query("INSERT INTO barber_locations (barber_id, location_id, is_active) VALUES ($1, $2, true)", [barberId, locationId]);
    await pool.query("INSERT INTO service_locations (service_id, location_id, is_active) VALUES ($1, $2, true)", [serviceId, locationId]);
    await pool.query("INSERT INTO barber_services (barber_id, service_id) VALUES ($1, $2)", [barberId, serviceId]);

    Object.assign(process.env, environment);
    const [{ DatabaseStorage }, dbModule] = await Promise.all([
      import("../../server/storage"),
      import("../../server/db"),
    ]);
    applicationPool = dbModule.pool;
    const storage = new DatabaseStorage();
    const fixed = await storage.createExtraDefinition({
      locationId,
      name: "Fixo PostgreSQL",
      pricingMode: "fixed",
      amountCents: 500,
      financialRule: "establishment",
    });
    const variable = await storage.createExtraDefinition({
      locationId,
      name: "Variável PostgreSQL",
      pricingMode: "variable",
      amountCents: null,
      financialRule: "barber",
    });
    const appointment = await storage.createAppointment({
      locationId,
      barberId,
      serviceId,
      startTime: new Date("2037-01-08T10:00:00.000Z"),
      customerName: "Cliente atomicidade",
      customerEmail: null,
      customerPhone: "+351910000099",
      cancelToken: "appointment-extras-update-postgres",
      durationMinutes: 30,
      serviceNameSnapshot: "Corte original",
      servicePriceCentsSnapshot: 1500,
      extras: [{ extraId: fixed.id }],
    });

    const assertOriginalState = async () => {
      const persisted = await storage.getAppointment(appointment.id);
      assert.equal(persisted?.serviceNameSnapshot, "Corte original");
      assert.equal(persisted?.servicePriceCentsSnapshot, 1500);
      assert.deepEqual((await storage.getAppointmentExtras([appointment.id])).map((extra) => ({
        id: extra.extraDefinitionId,
        name: extra.nameSnapshot,
        amount: extra.amountCentsSnapshot,
      })), [{ id: fixed.id, name: "Fixo PostgreSQL", amount: 500 }]);
    };

    await assert.rejects(
      storage.updateAppointmentWithNotification(appointment.id, {
        serviceNameSnapshot: "Não pode persistir",
        servicePriceCentsSnapshot: 3000,
      }, false, undefined, [{ extraId: 999_999_999 }]),
      (error: any) => error?.code === "APPOINTMENT_EXTRA_UNAVAILABLE",
    );
    await assertOriginalState();

    await assert.rejects(
      storage.updateAppointmentWithNotification(appointment.id, {
        serviceNameSnapshot: "Também não pode persistir",
        servicePriceCentsSnapshot: 3200,
      }, false, undefined, [{ extraId: variable.id }]),
      (error: any) => error?.code === "APPOINTMENT_EXTRA_AMOUNT_INVALID",
    );
    await assertOriginalState();

    await storage.updateAppointmentWithNotification(appointment.id, {
      serviceNameSnapshot: "Corte atualizado",
      servicePriceCentsSnapshot: 2500,
    }, false, undefined, [
      { extraId: fixed.id },
      { extraId: variable.id, amountCents: 1800 },
    ]);
    const updated = await storage.getAppointment(appointment.id);
    assert.equal(updated?.serviceNameSnapshot, "Corte atualizado");
    assert.equal(updated?.servicePriceCentsSnapshot, 2500);
    assert.deepEqual((await storage.getAppointmentExtras([appointment.id])).map((extra) => ({
      id: extra.extraDefinitionId,
      amount: extra.amountCentsSnapshot,
      position: extra.position,
    })), [
      { id: fixed.id, amount: 500, position: 0 },
      { id: variable.id, amount: 1800, position: 1 },
    ]);
  } finally {
    if (applicationPool) await applicationPool.end().catch(() => undefined);
    if (pool) await pool.end().catch(() => undefined);
    if (postgresStarted) await postgres.stop().catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
