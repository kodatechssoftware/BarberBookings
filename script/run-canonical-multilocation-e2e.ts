import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
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
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}:\n${output}`)));
  });
}

const databaseDirectory = await mkdtemp(path.join(tmpdir(), "beauty-canonical-multilocation-e2e-"));
const postgresPort = await availablePort();
const databasePassword = "canonical-multilocation-e2e";
const postgres = new EmbeddedPostgres({
  databaseDir: databaseDirectory,
  port: postgresPort,
  user: "postgres",
  password: databasePassword,
  persistent: false,
  onLog: () => undefined,
  onError: (message) => console.error(`[embedded-postgres] ${message}`),
});
let pool: pg.Pool | undefined;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    const applicationDatabase = await import("../server/db").catch(() => undefined);
    await applicationDatabase?.pool.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await postgres.stop().catch(() => undefined);
    await rm(databaseDirectory, { recursive: true, force: true });
  } finally {
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => { void stop(0); });
process.once("SIGTERM", () => { void stop(0); });

try {
  await postgres.initialise();
  await postgres.start();
  const serverUrl = `postgresql://postgres:${databasePassword}@127.0.0.1:${postgresPort}/`;
  const bootstrapPool = new pg.Pool({ connectionString: `${serverUrl}postgres` });
  await bootstrapPool.query("CREATE DATABASE canonical_multilocation_e2e ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
  await bootstrapPool.end();

  const databaseUrl = `${serverUrl}canonical_multilocation_e2e`;
  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DATABASE_SCHEMA: "public",
    DATABASE_POOL_MAX: "8",
    NODE_ENV: "development",
    APP_ENV: "development",
    USE_MEMORY_STORAGE: "false",
    AUTH_RUNTIME_MODE: "canonical",
    MULTI_LOCATION_ENABLED: "true",
    MAX_LOCATIONS: "4",
    BUSINESS_VERTICAL: "beauty",
    BUSINESS_THEME: "beauty-clean",
    SHOP_NAME: "Loja A",
    SHOP_ADDRESS: "Morada A",
    SHOP_TIME_ZONE: "Europe/Lisbon",
    MIGRATION_DEFAULT_LOCATION_NAME: "Loja A",
    MIGRATION_DEFAULT_LOCATION_ADDRESS: "Morada A",
    MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    SESSION_SECRET: "canonical-multilocation-e2e-session-secret",
    APPOINTMENT_NOTIFICATION_EVENTS_ENABLED: "true",
    NOTIFICATION_OUTBOX_WORKER_ENABLED: "false",
    APPOINTMENT_REMINDERS_ENABLED: "true",
    WHATSAPP_NOTIFICATIONS_ENABLED: "false",
    MESSAGING_PROVIDER: "none",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
    DEMO_MODE: "false",
    PERFORMANCE_TIMINGS_ENABLED: "false",
    PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED: "false",
    PORT: process.env.PORT || "5027",
  } satisfies NodeJS.ProcessEnv;

  await runCommand(process.execPath, [
    "--import",
    "tsx",
    path.resolve("script/bootstrap-database.ts"),
  ], environment);
  pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });

  const passwordHash = await bcrypt.hash("Canonical-Test-Password-2026!", 4);
  const administratorId = Number((await pool.query<{ id: number }>(`
    INSERT INTO users (display_name, username, email, password_hash, status)
    VALUES ('Administrador E2E', 'canonical-admin', 'canonical-admin@example.test', $1, 'active')
    RETURNING id
  `, [passwordHash])).rows[0].id);
  await pool.query(`
    INSERT INTO user_access_scopes (user_id, location_id, preset_key)
    VALUES ($1, NULL, 'administrator')
  `, [administratorId]);

  Object.assign(process.env, environment);
  await import("../server/index");
  await new Promise(() => undefined);
} catch (error) {
  console.error("Canonical multi-location E2E server failed to start", error);
  await stop(1);
}

