import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { getMigrationLocationConfig, migrationChecksum, runSchemaMigrations } from "../server/migrations";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

assert.throws(() => getMigrationLocationConfig({ NODE_ENV: "production", APP_ENV: "production" }), /name and address/);
assert.throws(() => getMigrationLocationConfig({ NODE_ENV: "production", APP_ENV: "production",
  MIGRATION_DEFAULT_LOCATION_NAME: "Loja", MIGRATION_DEFAULT_LOCATION_ADDRESS: "Morada",
  MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Invalid/Timezone" }), /TIME_ZONE is invalid/);
assert.equal(migrationChecksum("SELECT 1;\nSELECT 2;\n"), migrationChecksum("SELECT 1;\r\nSELECT 2;\r\n"));

const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-pg-"));
const port = await availablePort();
const embedded = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "migration-test", persistent: false,
  onLog: () => undefined, onError: () => undefined });
let pool: pg.Pool | undefined;
try {
  await embedded.initialise();
  await embedded.start();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:migration-test@127.0.0.1:${port}/postgres`, max: 4 });
  const schema = "main_fixture";
  const table = (name: string) => `"${schema}"."${name}"`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE ${table("barbers")} (
      id serial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL, bio text, avatar text,
      email text, password text, color text NOT NULL DEFAULT '#D4AF37', is_visible boolean DEFAULT true
    );
    CREATE TABLE ${table("services")} (
      id serial PRIMARY KEY, name text NOT NULL, description text, agenda_label text,
      price integer NOT NULL, duration integer NOT NULL, is_visible boolean DEFAULT true
    );
    CREATE TABLE ${table("appointments")} (
      id serial PRIMARY KEY, barber_id integer NOT NULL REFERENCES ${table("barbers")}(id),
      service_id integer REFERENCES ${table("services")}(id), start_time timestamp NOT NULL,
      customer_name text NOT NULL, customer_email text, customer_phone text NOT NULL,
      duration_minutes integer NOT NULL DEFAULT 30, status text NOT NULL DEFAULT 'booked',
      cancel_token text NOT NULL, cancelled_at timestamp, payment_method text NOT NULL DEFAULT 'pending',
      deposit_required boolean NOT NULL DEFAULT false, deposit_reason text, created_at timestamp DEFAULT now()
    );
    CREATE TABLE ${table("shop_availability")} (
      id serial PRIMARY KEY, day_of_week integer NOT NULL, start_time text NOT NULL,
      end_time text NOT NULL, is_open boolean NOT NULL DEFAULT true
    );
    CREATE TABLE ${table("barber_availability")} (
      id serial PRIMARY KEY, barber_id integer NOT NULL REFERENCES ${table("barbers")}(id),
      day_of_week integer NOT NULL, start_time text NOT NULL, end_time text NOT NULL,
      is_working boolean NOT NULL DEFAULT true
    );
    CREATE TABLE ${table("barber_services")} (
      barber_id integer NOT NULL REFERENCES ${table("barbers")}(id),
      service_id integer NOT NULL REFERENCES ${table("services")}(id), PRIMARY KEY (barber_id, service_id)
    );
    CREATE TABLE ${table("customer_notes")} (
      id serial PRIMARY KEY, phone text NOT NULL, customer_name_key text NOT NULL DEFAULT '', email text,
      notes text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE ${table("blacklist")} (id serial PRIMARY KEY, email text, phone text NOT NULL, reason text, created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE ${table("business_expenses")} (
      id serial PRIMARY KEY, category text NOT NULL, description text NOT NULL, amount_cents integer NOT NULL,
      expense_date timestamp NOT NULL, recurrence text NOT NULL DEFAULT 'once', notes text,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO ${table("barbers")} (name, specialty) VALUES ('Barbeiro original', 'Corte');
    INSERT INTO ${table("services")} (name, price, duration) VALUES ('Serviço original', 1500, 30);
    INSERT INTO ${table("appointments")} (barber_id, service_id, start_time, customer_name, customer_email, customer_phone, cancel_token)
      VALUES (1, 1, '2030-09-09 13:30:00', 'Cliente original', 'cliente@example.test', '910000000', 'token-fixture');
    INSERT INTO ${table("appointments")} (barber_id, start_time, customer_name, customer_phone, cancel_token)
      VALUES (1, '2030-09-09 15:00:00', 'BLOQUEIO MANUAL', '', 'block-fixture');
    INSERT INTO ${table("shop_availability")} (day_of_week, start_time, end_time) VALUES (1, '09:00', '19:00');
    INSERT INTO ${table("barber_availability")} (barber_id, day_of_week, start_time, end_time) VALUES (1, 1, '09:00', '18:00');
    INSERT INTO ${table("barber_services")} VALUES (1, 1);
    INSERT INTO ${table("customer_notes")} (phone, customer_name_key, email, notes) VALUES ('910000000', 'cliente original', 'cliente@example.test', 'Nota existente');
    INSERT INTO ${table("blacklist")} (phone, reason) VALUES ('919999999', 'Teste existente');
    INSERT INTO ${table("business_expenses")} (category, description, amount_cents, expense_date) VALUES ('rent', 'Renda existente', 50000, '2030-09-01');
  `);

  const preservedTables = ["barbers", "services", "appointments", "shop_availability", "barber_availability",
    "barber_services", "customer_notes", "blacklist", "business_expenses"];
  const countsBefore = new Map<string, number>();
  for (const name of preservedTables) countsBefore.set(name, Number((await pool.query(`SELECT count(*) AS count FROM ${table(name)}`)).rows[0].count));

  const environment = {
    NODE_ENV: "production", APP_ENV: "production",
    MIGRATION_DEFAULT_LOCATION_NAME: "Baptista Barber Shop",
    MIGRATION_DEFAULT_LOCATION_ADDRESS: "Rua validada, Lisboa",
    MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    MIGRATION_DEFAULT_LOCATION_MAP_URL: "https://maps.example.test/shop",
  };
  const firstRun = await runSchemaMigrations(pool, { schemaName: schema, environment });
  assert.deepEqual(firstRun.applied, [
    "0001_multi_location_foundation.sql", "0002_whatsapp_messages.sql",
    "0003_appointment_notification_outbox.sql", "0004_appointment_series.sql",
  ]);
  const secondRun = await runSchemaMigrations(pool, { schemaName: schema, environment });
  assert.equal(secondRun.applied.length, 0);
  assert.equal(secondRun.alreadyApplied, 4);

  for (const name of preservedTables) {
    assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table(name)}`)).rows[0].count), countsBefore.get(name), `${name} row count`);
  }
  const defaultLocation = (await pool.query(`SELECT * FROM ${table("locations")} WHERE is_default = true`)).rows[0];
  assert.equal(defaultLocation.name, environment.MIGRATION_DEFAULT_LOCATION_NAME);
  assert.equal(defaultLocation.address, environment.MIGRATION_DEFAULT_LOCATION_ADDRESS);
  assert.equal(defaultLocation.timezone, environment.MIGRATION_DEFAULT_LOCATION_TIME_ZONE);
  for (const name of ["appointments", "shop_availability", "barber_availability", "business_expenses"]) {
    const result = await pool.query(`SELECT count(*) AS total, count(*) FILTER (WHERE location_id = $1) AS assigned FROM ${table(name)}`, [defaultLocation.id]);
    assert.equal(result.rows[0].assigned, result.rows[0].total, `${name} default location backfill`);
  }
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("barber_locations")} WHERE location_id = $1`, [defaultLocation.id])).rows[0].count), 1);
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("service_locations")} WHERE location_id = $1`, [defaultLocation.id])).rows[0].count), 1);
  assert.equal((await pool.query(`SELECT customer_name FROM ${table("appointments")} WHERE cancel_token = 'token-fixture'`)).rows[0].customer_name, "Cliente original");
  assert.equal((await pool.query(`SELECT notes FROM ${table("customer_notes")} WHERE phone = '910000000'`)).rows[0].notes, "Nota existente");
  assert.equal((await pool.query(`SELECT description FROM ${table("business_expenses")} WHERE amount_cents = 50000`)).rows[0].description, "Renda existente");
  const migratedAppointment = (await pool.query(`
    SELECT reschedule_revision, notification_revision, whatsapp_opt_in, whatsapp_opt_in_at,
      series_id, series_occurrence_index
    FROM ${table("appointments")} WHERE cancel_token = 'token-fixture'
  `)).rows[0];
  assert.deepEqual(migratedAppointment, {
    reschedule_revision: 0, notification_revision: 0, whatsapp_opt_in: false,
    whatsapp_opt_in_at: null, series_id: null, series_occurrence_index: null,
  });

  const indexes = new Set((await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [schema])).rows.map((row) => row.indexname));
  for (const index of [
    "locations_single_default_idx", "appointments_location_id_idx", "barber_locations_location_idx",
    "service_locations_location_idx", "whatsapp_messages_provider_message_id_idx",
    "appointment_notification_events_event_key_idx", "appointment_notification_events_pending_idx",
    "meta_webhook_receipts_receipt_key_idx", "meta_webhook_receipts_provider_message_id_idx",
    "appointments_series_occurrence_idx", "appointment_notification_events_series_idx",
  ]) assert.ok(indexes.has(index), `missing index ${index}`);

  await pool.query(`
    INSERT INTO ${table("appointment_series")} (
      id, location_id, barber_id, service_id, customer_name, customer_phone,
      interval_weeks, duration_months, occurrence_count, first_start_time
    ) VALUES ('series-fixture', ${Number(defaultLocation.id)}, 1, 1, 'Cliente série', '910000000', 1, 1, 2, '2031-01-02 10:00:00');
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      series_id, series_occurrence_index
    ) VALUES
      (1, 1, '2031-01-02 10:00:00', 'Cliente série', '910000000', 'series-token-1', ${Number(defaultLocation.id)}, 'series-fixture', 0),
      (1, 1, '2031-01-09 10:00:00', 'Cliente série', '910000000', 'series-token-2', ${Number(defaultLocation.id)}, 'series-fixture', 1);
    INSERT INTO ${table("appointment_notification_events")} (
      series_id, event_type, event_revision, event_key, appointment_start_time, payload_snapshot
    ) VALUES ('series-fixture', 'appointment_recurring_confirmation', 1,
      'series:series-fixture:recurring_confirmation:1', '2031-01-02 10:00:00', '{"schemaVersion":1}'::jsonb);
  `);
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointment_notification_events")} (
      appointment_id, series_id, event_type, event_revision, event_key, appointment_start_time
    ) VALUES (1, 'series-fixture', 'invalid', 1, 'invalid-subject', now())
  `), (error: any) => error?.code === "23514");
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      series_id, series_occurrence_index
    ) VALUES (1, 1, '2031-01-16 10:00:00', 'Duplicado', '910000000', 'series-token-3', ${Number(defaultLocation.id)}, 'series-fixture', 1)
  `), (error: any) => error?.code === "23505");
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("appointments")} WHERE series_id IS NULL`)).rows[0].count), 2,
    "legacy appointments must not be retroactively grouped");

  console.log("PASS: representative main data was preserved/backfilled; revisions, opt-in, outbox, series, constraints, indexes and controlled re-execution passed on real PostgreSQL.");
} finally {
  if (pool) await pool.end();
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
}
