import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { asc } from "drizzle-orm";
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
const preServiceTermsMigrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-migrations-before-service-terms-"));
const preExtrasMigrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-migrations-before-extras-"));
const migrationsDirectory = path.resolve(process.cwd(), "migrations");
for (const file of [
  "0001_multi_location_foundation.sql",
  "0002_whatsapp_messages.sql",
  "0003_appointment_notification_outbox.sql",
  "0004_appointment_series.sql",
  "0005_service_categories.sql",
  "0006_customer_notes_location.sql",
]) {
  await copyFile(path.join(migrationsDirectory, file), path.join(preServiceTermsMigrationsDirectory, file));
}
for (const file of [
  "0001_multi_location_foundation.sql",
  "0002_whatsapp_messages.sql",
  "0003_appointment_notification_outbox.sql",
  "0004_appointment_series.sql",
  "0005_service_categories.sql",
  "0006_customer_notes_location.sql",
  "0007_appointment_service_snapshots.sql",
]) {
  await copyFile(path.join(migrationsDirectory, file), path.join(preExtrasMigrationsDirectory, file));
}
const port = await availablePort();
const embedded = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "migration-test", persistent: false,
  onLog: () => undefined, onError: () => undefined });
let pool: pg.Pool | undefined;
let applicationPool: pg.Pool | undefined;
try {
  await embedded.initialise();
  await embedded.start();
  const databaseUrl = `postgresql://postgres:migration-test@127.0.0.1:${port}/postgres`;
  pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
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
    CREATE UNIQUE INDEX customer_notes_phone_name_idx
      ON ${table("customer_notes")} (phone, customer_name_key);
    CREATE TABLE ${table("blacklist")} (id serial PRIMARY KEY, email text, phone text NOT NULL, reason text, created_at timestamp NOT NULL DEFAULT now());
    CREATE TABLE ${table("business_expenses")} (
      id serial PRIMARY KEY, category text NOT NULL, description text NOT NULL, amount_cents integer NOT NULL,
      expense_date timestamp NOT NULL, recurrence text NOT NULL DEFAULT 'once', notes text,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO ${table("barbers")} (name, specialty) VALUES ('Barbeiro original', 'Corte');
    INSERT INTO ${table("services")} (name, description, agenda_label, price, duration, is_visible) VALUES
      ('Serviço original', 'Descrição original', 'Original', 1500, 30, true),
      ('Serviço oculto', 'Mantém todos os campos', NULL, 2750, 75, false);
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
  const legacyServicesBefore = (await pool.query(`
    SELECT id, name, description, agenda_label, price, duration, is_visible
    FROM ${table("services")} ORDER BY id
  `)).rows;
  const legacyCustomerNoteBefore = (await pool.query(`
    SELECT id, phone, customer_name_key, email, notes, created_at, updated_at
    FROM ${table("customer_notes")} WHERE phone = '910000000'
  `)).rows[0];
  const countsBefore = new Map<string, number>();
  for (const name of preservedTables) countsBefore.set(name, Number((await pool.query(`SELECT count(*) AS count FROM ${table(name)}`)).rows[0].count));

  const environment = {
    NODE_ENV: "production", APP_ENV: "production",
    MIGRATION_DEFAULT_LOCATION_NAME: "Baptista Barber Shop",
    MIGRATION_DEFAULT_LOCATION_ADDRESS: "Rua validada, Lisboa",
    MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    MIGRATION_DEFAULT_LOCATION_MAP_URL: "https://maps.example.test/shop",
  };
  const freshSchema = "fresh_fixture";
  const freshTable = (name: string) => `"${freshSchema}"."${name}"`;
  await pool.query(`CREATE SCHEMA "${freshSchema}"`);
  for (const name of preservedTables) {
    await pool.query(`CREATE TABLE ${freshTable(name)} (LIKE ${table(name)} INCLUDING ALL)`);
  }
  const freshRun = await runSchemaMigrations(pool, {
    schemaName: freshSchema,
    environment,
    migrationsDirectory,
  });
  assert.equal(freshRun.applied.length, 8, "a fresh empty application schema must apply migrations 0001 through 0008");
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${freshTable("appointments")}`)).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${freshTable("extra_definitions")}`)).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${freshTable("appointment_extras")}`)).rows[0].count), 0);
  const freshExtrasColumns = (await pool.query(`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'extra_definitions'
  `, [freshSchema])).rows;
  assert.ok(freshExtrasColumns.some((column) => column.column_name === "pricing_mode" && column.is_nullable === "NO"));
  assert.ok(freshExtrasColumns.some((column) => column.column_name === "amount_cents" && column.is_nullable === "YES"));
  const secondFreshRun = await runSchemaMigrations(pool, {
    schemaName: freshSchema,
    environment,
    migrationsDirectory,
  });
  assert.equal(secondFreshRun.applied.length, 0);
  assert.equal(secondFreshRun.alreadyApplied, 8);

  const firstRun = await runSchemaMigrations(pool, {
    schemaName: schema,
    environment,
    migrationsDirectory: preServiceTermsMigrationsDirectory,
  });
  assert.deepEqual(firstRun.applied, [
    "0001_multi_location_foundation.sql", "0002_whatsapp_messages.sql",
    "0003_appointment_notification_outbox.sql", "0004_appointment_series.sql",
    "0005_service_categories.sql", "0006_customer_notes_location.sql",
  ]);
  const secondRun = await runSchemaMigrations(pool, {
    schemaName: schema,
    environment,
    migrationsDirectory: preServiceTermsMigrationsDirectory,
  });
  assert.equal(secondRun.applied.length, 0);
  assert.equal(secondRun.alreadyApplied, 6);

  for (const name of preservedTables) {
    assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table(name)}`)).rows[0].count), countsBefore.get(name), `${name} row count`);
  }
  const migratedServices = (await pool.query(`
    SELECT id, name, description, agenda_label, price, duration, is_visible, category_id
    FROM ${table("services")} ORDER BY id
  `)).rows;
  assert.deepEqual(
    migratedServices.map(({ category_id: _categoryId, ...service }) => service),
    legacyServicesBefore,
    "service values and legacy ordering must remain unchanged",
  );
  assert.ok(migratedServices.every((service) => service.category_id === null),
    "pre-category services must remain uncategorized");
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("service_categories")}`)).rows[0].count), 0,
    "the migration must not create or infer categories");
  // This is the exact projection used by pre-category code. It must remain readable
  // after the additive migration and return the same shape and values.
  const legacyProjectionAfter = (await pool.query(`
    SELECT id, name, description, agenda_label, price, duration, is_visible
    FROM ${table("services")} ORDER BY id
  `)).rows;
  assert.deepEqual(legacyProjectionAfter, legacyServicesBefore, "pre-category code projection must remain compatible");
  const legacySchema = pgSchema(schema);
  const legacyServicesTable = legacySchema.table("services", {
    id: integer("id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    agendaLabel: text("agenda_label"),
    price: integer("price").notNull(),
    duration: integer("duration").notNull(),
    isVisible: boolean("is_visible"),
  });
  const legacyDrizzleRead = await drizzle(pool).select().from(legacyServicesTable).orderBy(asc(legacyServicesTable.id));
  assert.deepEqual(legacyDrizzleRead.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    agenda_label: service.agendaLabel,
    price: service.price,
    duration: service.duration,
    is_visible: service.isVisible,
  })), legacyServicesBefore, "the pre-category Drizzle model must read the migrated services table unchanged");
  const defaultLocation = (await pool.query(`SELECT * FROM ${table("locations")} WHERE is_default = true`)).rows[0];
  assert.equal(defaultLocation.name, environment.MIGRATION_DEFAULT_LOCATION_NAME);
  assert.equal(defaultLocation.address, environment.MIGRATION_DEFAULT_LOCATION_ADDRESS);
  assert.equal(defaultLocation.timezone, environment.MIGRATION_DEFAULT_LOCATION_TIME_ZONE);
  for (const name of ["appointments", "shop_availability", "barber_availability", "business_expenses"]) {
    const result = await pool.query(`SELECT count(*) AS total, count(*) FILTER (WHERE location_id = $1) AS assigned FROM ${table(name)}`, [defaultLocation.id]);
    assert.equal(result.rows[0].assigned, result.rows[0].total, `${name} default location backfill`);
  }
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("barber_locations")} WHERE location_id = $1`, [defaultLocation.id])).rows[0].count), 1);
  assert.equal(
    Number((await pool.query(`SELECT count(*) AS count FROM ${table("service_locations")} WHERE location_id = $1`, [defaultLocation.id])).rows[0].count),
    legacyServicesBefore.length,
  );
  assert.equal((await pool.query(`SELECT customer_name FROM ${table("appointments")} WHERE cancel_token = 'token-fixture'`)).rows[0].customer_name, "Cliente original");
  assert.equal((await pool.query(`SELECT notes FROM ${table("customer_notes")} WHERE phone = '910000000'`)).rows[0].notes, "Nota existente");
  const migratedCustomerNote = (await pool.query(`
    SELECT id, location_id, phone, customer_name_key, email, notes, created_at, updated_at
    FROM ${table("customer_notes")} WHERE phone = '910000000'
  `)).rows[0];
  assert.equal(migratedCustomerNote.location_id, defaultLocation.id);
  const { location_id: _noteLocationId, ...legacyCustomerNoteFields } = migratedCustomerNote;
  assert.deepEqual(legacyCustomerNoteFields, legacyCustomerNoteBefore,
    "customer note contents and timestamps must remain byte-for-byte unchanged");
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

  const releaseDataQueries = {
    locations: `SELECT * FROM ${table("locations")} ORDER BY id`,
    barbers: `SELECT * FROM ${table("barbers")} ORDER BY id`,
    services: `SELECT * FROM ${table("services")} ORDER BY id`,
    appointments: `SELECT * FROM ${table("appointments")} ORDER BY id`,
    appointmentSeries: `SELECT * FROM ${table("appointment_series")} ORDER BY id`,
    shopAvailability: `SELECT * FROM ${table("shop_availability")} ORDER BY id`,
    barberAvailability: `SELECT * FROM ${table("barber_availability")} ORDER BY id`,
    barberServices: `SELECT * FROM ${table("barber_services")} ORDER BY barber_id, service_id`,
    barberLocations: `SELECT * FROM ${table("barber_locations")} ORDER BY barber_id, location_id`,
    serviceLocations: `SELECT * FROM ${table("service_locations")} ORDER BY service_id, location_id`,
    customerNotes: `SELECT * FROM ${table("customer_notes")} ORDER BY id`,
    blacklist: `SELECT * FROM ${table("blacklist")} ORDER BY id`,
    businessExpenses: `SELECT * FROM ${table("business_expenses")} ORDER BY id`,
    whatsappMessages: `SELECT * FROM ${table("whatsapp_messages")} ORDER BY id`,
    notificationEvents: `SELECT * FROM ${table("appointment_notification_events")} ORDER BY id`,
    webhookReceipts: `SELECT * FROM ${table("meta_webhook_receipts")} ORDER BY id`,
  } as const;
  async function captureReleaseData() {
    return Object.fromEntries(await Promise.all(Object.entries(releaseDataQueries).map(async ([name, sql]) => [
      name,
      (await pool!.query(sql)).rows,
    ]))) as Record<keyof typeof releaseDataQueries, Record<string, unknown>[]>;
  }
  const legacyAppointmentsSchema = pgSchema(schema);
  const legacyAppointmentsTable = legacyAppointmentsSchema.table("appointments", {
    id: integer("id").notNull(),
    locationId: integer("location_id").notNull(),
    barberId: integer("barber_id").notNull(),
    serviceId: integer("service_id"),
    startTime: timestamp("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    status: text("status").notNull(),
    paymentMethod: text("payment_method").notNull(),
    cancelToken: text("cancel_token").notNull(),
    depositRequired: boolean("deposit_required").notNull(),
    rescheduleRevision: integer("reschedule_revision").notNull(),
    notificationRevision: integer("notification_revision").notNull(),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull(),
  });
  const legacyAppointmentsBeforeServiceTerms = await drizzle(pool).select()
    .from(legacyAppointmentsTable).orderBy(asc(legacyAppointmentsTable.id));
  const releaseDataBeforeServiceTermsMigration = await captureReleaseData();
  const serviceTermsRun = await runSchemaMigrations(pool, {
    schemaName: schema,
    environment,
    migrationsDirectory: preExtrasMigrationsDirectory,
  });
  assert.deepEqual(serviceTermsRun.applied, ["0007_appointment_service_snapshots.sql"]);
  assert.equal(serviceTermsRun.alreadyApplied, 6);
  const releaseDataAfterServiceTermsMigration = await captureReleaseData();
  const {
    appointments: appointmentsBeforeServiceTermsMigration,
    ...unrelatedDataBeforeServiceTermsMigration
  } = releaseDataBeforeServiceTermsMigration;
  const {
    appointments: appointmentsAfterServiceTermsMigration,
    ...unrelatedDataAfterServiceTermsMigration
  } = releaseDataAfterServiceTermsMigration;
  assert.deepEqual(
    unrelatedDataAfterServiceTermsMigration,
    unrelatedDataBeforeServiceTermsMigration,
    "migration 0007 must not alter any unrelated operational entity",
  );
  assert.deepEqual(
    appointmentsAfterServiceTermsMigration.map((appointment) => {
      const {
        service_name_snapshot: _serviceNameSnapshot,
        service_price_cents_snapshot: _servicePriceSnapshot,
        manual_outside_hours: _manualOutsideHours,
        ...legacyFields
      } = appointment;
      return legacyFields;
    }),
    appointmentsBeforeServiceTermsMigration,
    "migration 0007 must preserve every legacy appointment value byte-for-byte",
  );
  for (const appointment of appointmentsAfterServiceTermsMigration) {
    assert.equal(appointment.service_name_snapshot, null);
    assert.equal(appointment.service_price_cents_snapshot, null);
    assert.equal(appointment.manual_outside_hours, false);
  }
  const legacyAppointmentsReadAfterServiceTerms = await drizzle(pool).select()
    .from(legacyAppointmentsTable).orderBy(asc(legacyAppointmentsTable.id));
  assert.deepEqual(
    legacyAppointmentsReadAfterServiceTerms,
    legacyAppointmentsBeforeServiceTerms,
    "the previous appointment model must remain readable after migration 0007",
  );
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      service_name_snapshot, service_price_cents_snapshot
    ) VALUES (1, 1, '2032-01-01 10:00:00', 'Par inválido', '910000001', 'invalid-pair', $1, 'Corte', NULL)
  `, [defaultLocation.id]), (error: any) => error?.code === "23514");
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      service_name_snapshot, service_price_cents_snapshot
    ) VALUES (1, 1, '2032-01-01 11:00:00', 'Nome inválido', '910000002', 'invalid-name', $1, '   ', 1000)
  `, [defaultLocation.id]), (error: any) => error?.code === "23514");
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      service_name_snapshot, service_price_cents_snapshot
    ) VALUES (1, 1, '2032-01-01 12:00:00', 'Preço inválido', '910000003', 'invalid-price', $1, 'Corte', -1)
  `, [defaultLocation.id]), (error: any) => error?.code === "23514");
  await pool.query(`
    INSERT INTO ${table("appointments")} (
      barber_id, service_id, start_time, customer_name, customer_phone, cancel_token, location_id,
      service_name_snapshot, service_price_cents_snapshot, manual_outside_hours
    ) VALUES (1, 1, '2032-01-01 13:00:00', 'Preço zero', '910000004', 'valid-zero-price', $1, 'Corte oferta', 0, true)
  `, [defaultLocation.id]);
  const zeroPriceSnapshot = (await pool.query(`
    SELECT service_name_snapshot, service_price_cents_snapshot, manual_outside_hours
    FROM ${table("appointments")} WHERE cancel_token = 'valid-zero-price'
  `)).rows[0];
  assert.deepEqual(zeroPriceSnapshot, {
    service_name_snapshot: "Corte oferta",
    service_price_cents_snapshot: 0,
    manual_outside_hours: true,
  });
  await pool.query(`DELETE FROM ${table("appointments")} WHERE cancel_token = 'valid-zero-price'`);
  const releaseDataAfterConstraintChecks = await captureReleaseData();
  assert.deepEqual(releaseDataAfterConstraintChecks, releaseDataAfterServiceTermsMigration);
  const secondServiceTermsRun = await runSchemaMigrations(pool, {
    schemaName: schema,
    environment,
    migrationsDirectory: preExtrasMigrationsDirectory,
  });
  assert.equal(secondServiceTermsRun.applied.length, 0);
  assert.equal(secondServiceTermsRun.alreadyApplied, 7);
  assert.deepEqual(
    await captureReleaseData(),
    releaseDataAfterServiceTermsMigration,
    "controlled migration 0007 re-execution must not mutate operational data",
  );
  const releaseDataBeforeExtrasMigration = await captureReleaseData();
  const extrasRun = await runSchemaMigrations(pool, { schemaName: schema, environment, migrationsDirectory });
  assert.deepEqual(extrasRun.applied, ["0008_appointment_extras.sql"]);
  assert.equal(extrasRun.alreadyApplied, 7);
  assert.deepEqual(
    await captureReleaseData(),
    releaseDataBeforeExtrasMigration,
    "migration 0008 must not mutate any legacy operational data",
  );
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("extra_definitions")}`)).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("appointment_extras")}`)).rows[0].count), 0,
    "legacy appointments must receive no artificial Extra rows");
  const secondExtrasRun = await runSchemaMigrations(pool, { schemaName: schema, environment, migrationsDirectory });
  assert.equal(secondExtrasRun.applied.length, 0);
  assert.equal(secondExtrasRun.alreadyApplied, 8);
  assert.deepEqual(
    await captureReleaseData(),
    releaseDataBeforeExtrasMigration,
    "controlled migration 0008 re-execution must not mutate operational data",
  );
  const indexes = new Set((await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [schema])).rows.map((row) => row.indexname));
  for (const index of [
    "locations_single_default_idx", "appointments_location_id_idx", "barber_locations_location_idx",
    "service_locations_location_idx", "whatsapp_messages_provider_message_id_idx",
    "appointment_notification_events_event_key_idx", "appointment_notification_events_pending_idx",
    "meta_webhook_receipts_receipt_key_idx", "meta_webhook_receipts_provider_message_id_idx",
    "appointments_series_occurrence_idx", "appointment_notification_events_series_idx",
    "service_categories_name_ci_idx", "service_categories_active_order_idx", "services_category_id_idx",
    "customer_notes_location_id_idx", "customer_notes_location_phone_name_idx",
    "extra_definitions_location_name_ci_idx", "extra_definitions_location_active_order_idx",
    "appointment_extras_pkey", "appointment_extras_appointment_position_unique",
    "appointment_extras_extra_definition_id_idx",
  ]) assert.ok(indexes.has(index), `missing index ${index}`);
  assert.equal(indexes.has("customer_notes_phone_name_idx"), false,
    "the legacy global customer-note identity index must be removed");

  const secondLocationId = Number((await pool.query(`
    INSERT INTO ${table("locations")} (name, slug, address, timezone, is_active, is_default, sort_order)
    VALUES ('Loja secundária', 'secundaria', 'Morada B', 'Europe/Lisbon', true, false, 1)
    RETURNING id
  `)).rows[0].id);
  await pool.query(`
    INSERT INTO ${table("customer_notes")} (location_id, phone, customer_name_key, email, notes)
    VALUES ($1, '910000000', 'cliente original', 'cliente@example.test', 'Nota independente B')
  `, [secondLocationId]);
  assert.equal(Number((await pool.query(`
    SELECT count(*) AS count FROM ${table("customer_notes")}
    WHERE phone = '910000000' AND customer_name_key = 'cliente original'
  `)).rows[0].count), 2, "the same customer identity must support one independent note per location");
  await assert.rejects(pool.query(`
    INSERT INTO ${table("customer_notes")} (location_id, phone, customer_name_key, notes)
    VALUES ($1, '910000000', 'cliente original', 'Duplicada A')
  `, [defaultLocation.id]), (error: any) => error?.code === "23505");

  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, '   ', 'fixed', 1000, 'barber')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, 'Fixo sem valor', 'fixed', NULL, 'barber')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, 'Valor zero', 'fixed', 0, 'barber')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, 'Variável residual', 'variable', 1000, 'barber')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, 'Modo inválido', 'distance', NULL, 'barber')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, 'Regra inválida', 'fixed', 1000, 'custom')`, [defaultLocation.id]),
    (error: any) => error?.code === "23514",
  );
  const directExtraId = Number((await pool.query(`
    INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
    VALUES ($1, 'Deslocação direta', 'variable', NULL, 'barber') RETURNING id
  `, [defaultLocation.id])).rows[0].id);
  const directSecondExtraId = Number((await pool.query(`
    INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule, sort_order)
    VALUES ($1, 'Produto direto', 'fixed', 750, 'establishment', 1) RETURNING id
  `, [defaultLocation.id])).rows[0].id);
  await assert.rejects(
    pool.query(`INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
      VALUES ($1, '  deslocação DIRETA  ', 'fixed', 1200, 'follow_compensation')`, [defaultLocation.id]),
    (error: any) => error?.code === "23505",
  );
  const secondaryDirectExtraId = Number((await pool.query(`
    INSERT INTO ${table("extra_definitions")} (location_id, name, pricing_mode, amount_cents, financial_rule)
    VALUES ($1, 'Deslocação direta', 'fixed', 1500, 'follow_compensation') RETURNING id
  `, [secondLocationId])).rows[0].id);
  const directAppointmentId = Number((await pool.query(`
    INSERT INTO ${table("appointments")} (
      location_id, barber_id, service_id, start_time, customer_name, customer_phone, cancel_token
    ) VALUES ($1, 1, 1, '2034-01-02 10:00:00', 'Teste Extra direto', '910000010', 'extra-direct')
    RETURNING id
  `, [defaultLocation.id])).rows[0].id);
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointment_extras")} (
      appointment_id, extra_definition_id, name_snapshot, amount_cents_snapshot,
      financial_rule_snapshot, position
    ) VALUES ($1, $2, 'Deslocação direta', 0, 'barber', 0)
  `, [directAppointmentId, directExtraId]), (error: any) => error?.code === "23514");
  await pool.query(`
    INSERT INTO ${table("appointment_extras")} (
      appointment_id, extra_definition_id, name_snapshot, amount_cents_snapshot,
      financial_rule_snapshot, position
    ) VALUES ($1, $2, 'Deslocação direta', 1000, 'barber', 0)
  `, [directAppointmentId, directExtraId]);
  await assert.rejects(pool.query(`
    INSERT INTO ${table("appointment_extras")} (
      appointment_id, extra_definition_id, name_snapshot, amount_cents_snapshot,
      financial_rule_snapshot, position
    ) VALUES ($1, $2, 'Produto direto', 750, 'establishment', 0)
  `, [directAppointmentId, directSecondExtraId]), (error: any) => error?.code === "23505");
  await pool.query(`UPDATE ${table("extra_definitions")}
    SET name = 'Deslocação direta atualizada', financial_rule = 'follow_compensation'
    WHERE id = $1`, [directExtraId]);
  assert.deepEqual((await pool.query(`SELECT name_snapshot, amount_cents_snapshot, financial_rule_snapshot
    FROM ${table("appointment_extras")} WHERE appointment_id = $1`, [directAppointmentId])).rows[0], {
    name_snapshot: "Deslocação direta",
    amount_cents_snapshot: 1000,
    financial_rule_snapshot: "barber",
  }, "definition changes must never rewrite historical Extra snapshots");
  await assert.rejects(
    pool.query(`DELETE FROM ${table("extra_definitions")} WHERE id = $1`, [directExtraId]),
    (error: any) => error?.code === "23001" || error?.code === "23503",
  );
  await pool.query(`DELETE FROM ${table("appointments")} WHERE id = $1`, [directAppointmentId]);
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("appointment_extras")}
    WHERE appointment_id = $1`, [directAppointmentId])).rows[0].count), 0,
    "deleting an appointment must cascade only its Extra snapshots");
  await pool.query(`DELETE FROM ${table("extra_definitions")} WHERE id = ANY($1::integer[])`, [
    [directExtraId, directSecondExtraId, secondaryDirectExtraId],
  ]);

  await assert.rejects(
    pool.query(`INSERT INTO ${table("service_categories")} (name, sort_order) VALUES ('   ', 0)`),
    (error: any) => error?.code === "23514",
  );
  await assert.rejects(
    pool.query(`INSERT INTO ${table("service_categories")} (name, sort_order) VALUES ('Inválida', -1)`),
    (error: any) => error?.code === "23514",
  );
  const categoryId = Number((await pool.query(`
    INSERT INTO ${table("service_categories")} (name, sort_order)
    VALUES ('Cortes', 0) RETURNING id
  `)).rows[0].id);
  await assert.rejects(
    pool.query(`INSERT INTO ${table("service_categories")} (name, sort_order) VALUES ('  cortes  ', 1)`),
    (error: any) => error?.code === "23505",
  );
  await pool.query(`UPDATE ${table("services")} SET category_id = $1 WHERE id = 1`, [categoryId]);
  await pool.query(`UPDATE ${table("service_categories")} SET is_active = false WHERE id = $1`, [categoryId]);
  assert.equal((await pool.query(`SELECT category_id FROM ${table("services")} WHERE id = 1`)).rows[0].category_id, categoryId,
    "deactivating a category must preserve service associations");
  const serviceCountBeforeCategoryDelete = Number((await pool.query(`SELECT count(*) AS count FROM ${table("services")}`)).rows[0].count);
  await pool.query(`DELETE FROM ${table("service_categories")} WHERE id = $1`, [categoryId]);
  assert.equal((await pool.query(`SELECT category_id FROM ${table("services")} WHERE id = 1`)).rows[0].category_id, null,
    "deleting a category must set services.category_id to null");
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("services")}`)).rows[0].count), serviceCountBeforeCategoryDelete,
    "deleting a category must not delete services");

  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SCHEMA = schema;
  process.env.DATABASE_POOL_MAX = "2";
  process.env.USE_MEMORY_STORAGE = "false";
  const [{ DatabaseStorage }, { pool: importedApplicationPool }] = await Promise.all([
    import("../server/storage"),
    import("../server/db"),
  ]);
  applicationPool = importedApplicationPool;
  const databaseStorage = new DatabaseStorage();
  assert.deepEqual(await databaseStorage.getAppointmentExtras([1]), [],
    "legacy appointments must be exposed with an empty Extra collection");
  const travelExtra = await databaseStorage.createExtraDefinition({
    locationId: Number(defaultLocation.id),
    name: "Deslocação storage",
    pricingMode: "variable",
    amountCents: null,
    financialRule: "barber",
  });
  const productExtra = await databaseStorage.createExtraDefinition({
    locationId: Number(defaultLocation.id),
    name: "Produto storage",
    pricingMode: "fixed",
    amountCents: 750,
    financialRule: "establishment",
  });
  const secondaryExtra = await databaseStorage.createExtraDefinition({
    locationId: secondLocationId,
    name: "Extra secundário storage",
    pricingMode: "fixed",
    amountCents: 500,
    financialRule: "follow_compensation",
  });
  assert.equal(travelExtra.amountCents, null);
  const productAsVariable = await databaseStorage.updateExtraDefinition(
    productExtra.id,
    Number(defaultLocation.id),
    { pricingMode: "variable", amountCents: 999 },
  );
  assert.deepEqual(
    { pricingMode: productAsVariable?.pricingMode, amountCents: productAsVariable?.amountCents },
    { pricingMode: "variable", amountCents: null },
    "fixed-to-variable must discard every residual catalogue amount",
  );
  await assert.rejects(
    databaseStorage.updateExtraDefinition(productExtra.id, Number(defaultLocation.id), { pricingMode: "fixed" }),
    /valor deve ser superior a zero/i,
  );
  const productRestoredFixed = await databaseStorage.updateExtraDefinition(
    productExtra.id,
    Number(defaultLocation.id),
    { pricingMode: "fixed", amountCents: 750 },
  );
  assert.deepEqual(
    { pricingMode: productRestoredFixed?.pricingMode, amountCents: productRestoredFixed?.amountCents },
    { pricingMode: "fixed", amountCents: 750 },
  );
  assert.deepEqual(
    (await databaseStorage.getExtraDefinitions(Number(defaultLocation.id))).map((extra) => extra.id),
    [travelExtra.id, productExtra.id],
    "Extra catalogues must be isolated and ordered per location",
  );
  const recurringFirstStart = new Date("2035-02-01T10:00:00.000Z");
  await assert.rejects(databaseStorage.createRecurringAppointmentSeries({
    series: {
      id: "extras-recurring-rejected",
      locationId: Number(defaultLocation.id),
      barberId: 1,
      serviceId: 1,
      customerName: "Cliente recorrente Extra",
      customerEmail: null,
      customerPhone: "910000019",
      whatsappOptIn: false,
      whatsappOptInAt: null,
      intervalWeeks: 1,
      durationMonths: 1,
      occurrenceCount: 2,
      firstStartTime: recurringFirstStart,
    },
    appointments: [recurringFirstStart, new Date("2035-02-08T10:00:00.000Z")].map((startTime, index) => ({
      locationId: Number(defaultLocation.id),
      barberId: 1,
      serviceId: 1,
      startTime,
      customerName: "Cliente recorrente Extra",
      customerEmail: null,
      customerPhone: "910000019",
      whatsappOptIn: false,
      durationMinutes: 30,
      cancelToken: `extras-recurring-rejected-${index}`,
      extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
    })),
    notificationSnapshot: {
      schemaVersion: 1,
      customerName: "Cliente recorrente Extra",
      customerEmail: null,
      customerPhone: "910000019",
      whatsappOptIn: false,
      location: {
        id: Number(defaultLocation.id),
        name: defaultLocation.name,
        address: defaultLocation.address,
        timezone: defaultLocation.timezone,
      },
      service: { id: 1, name: "Serviço original" },
      barber: { id: 1, name: "Barbeiro original" },
      recurrence: { intervalWeeks: 1, durationMonths: 1, occurrenceCount: 2 },
    },
  }), (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_ALLOWED_FOR_RECURRING");
  assert.equal(await databaseStorage.getAppointmentSeries("extras-recurring-rejected"), undefined,
    "a recurring request with Extras must not persist a partial series");
  const appointmentWithExtra = await databaseStorage.createAppointment({
    locationId: Number(defaultLocation.id),
    barberId: 1,
    serviceId: 1,
    startTime: new Date("2035-01-02T10:00:00.000Z"),
    customerName: "Cliente Extra storage",
    customerEmail: null,
    customerPhone: "910000020",
    durationMinutes: 30,
    cancelToken: "extra-storage-one",
    extras: [{ extraId: travelExtra.id, amountCents: 1000 }],
  });
  const originalTravelSnapshot = (await databaseStorage.getAppointmentExtras([appointmentWithExtra.id]))[0];
  assert.deepEqual({
    name: originalTravelSnapshot.nameSnapshot,
    amount: originalTravelSnapshot.amountCentsSnapshot,
    rule: originalTravelSnapshot.financialRuleSnapshot,
    position: originalTravelSnapshot.position,
  }, {
    name: "Deslocação storage",
    amount: 1000,
    rule: "barber",
    position: 0,
  });
  await databaseStorage.updateExtraDefinition(travelExtra.id, Number(defaultLocation.id), {
    name: "Deslocação storage atualizada",
    financialRule: "follow_compensation",
  });
  assert.deepEqual(await databaseStorage.getAppointmentExtras([appointmentWithExtra.id]), [originalTravelSnapshot],
    "catalogue updates must preserve stored appointment snapshots");
  await assert.rejects(databaseStorage.createAppointment({
    locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
    startTime: new Date("2035-01-02T08:00:00.000Z"), customerName: "Variable missing",
    customerEmail: null, customerPhone: "910000026", durationMinutes: 30,
    cancelToken: "extra-storage-variable-missing", extras: [{ extraId: travelExtra.id }],
  }), (error: any) => error?.code === "APPOINTMENT_EXTRA_AMOUNT_INVALID");
  await assert.rejects(databaseStorage.createAppointment({
    locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
    startTime: new Date("2035-01-02T08:30:00.000Z"), customerName: "Variable zero",
    customerEmail: null, customerPhone: "910000027", durationMinutes: 30,
    cancelToken: "extra-storage-variable-zero", extras: [{ extraId: travelExtra.id, amountCents: 0 }],
  }), (error: any) => error?.code === "APPOINTMENT_EXTRA_AMOUNT_INVALID");
  const fixedAuthoritativeAppointment = await databaseStorage.createAppointment({
    locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
    startTime: new Date("2035-01-02T09:00:00.000Z"), customerName: "Fixed authoritative",
    customerEmail: null, customerPhone: "910000028", durationMinutes: 30,
    cancelToken: "extra-storage-fixed-authoritative",
    extras: [{ extraId: productExtra.id, amountCents: 9999 }],
  });
  assert.equal(
    (await databaseStorage.getAppointmentExtras([fixedAuthoritativeAppointment.id]))[0].amountCentsSnapshot,
    750,
    "fixed Extra input must never override the authoritative catalogue amount",
  );
  const extrasOnlyUpdate = await databaseStorage.updateAppointmentWithNotification(
    appointmentWithExtra.id,
    {},
    true,
    "booked",
    [{ extraId: travelExtra.id }, { extraId: productExtra.id }],
  );
  assert.equal(extrasOnlyUpdate?.appointment.notificationRevision, appointmentWithExtra.notificationRevision,
    "Extra-only changes must not create customer notification revisions in V1");
  assert.deepEqual(
    (await databaseStorage.getAppointmentExtras([appointmentWithExtra.id])).map((extra) => ({
      definitionId: extra.extraDefinitionId,
      name: extra.nameSnapshot,
      amount: extra.amountCentsSnapshot,
      rule: extra.financialRuleSnapshot,
      position: extra.position,
    })),
    [
      { definitionId: travelExtra.id, name: "Deslocação storage", amount: 1000, rule: "barber", position: 0 },
      { definitionId: productExtra.id, name: "Produto storage", amount: 750, rule: "establishment", position: 1 },
    ],
    "existing snapshots must be preserved while newly selected Extras are frozen",
  );
  const successfulExtrasBatch = await databaseStorage.createAppointments([
    {
      locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
      startTime: new Date("2035-01-02T11:00:00.000Z"), customerName: "Batch Extra A",
      customerEmail: null, customerPhone: "910000024", durationMinutes: 30,
      cancelToken: "extra-storage-batch-a", extras: [
        { extraId: travelExtra.id, amountCents: 1250 },
        { extraId: productExtra.id },
      ],
    },
    {
      locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
      startTime: new Date("2035-01-02T12:00:00.000Z"), customerName: "Batch Extra B",
      customerEmail: null, customerPhone: "910000025", durationMinutes: 30,
      cancelToken: "extra-storage-batch-b", extras: [
        { extraId: travelExtra.id, amountCents: 1250 },
        { extraId: productExtra.id },
      ],
    },
  ]);
  assert.equal(successfulExtrasBatch.length, 2);
  const successfulBatchSnapshots = await databaseStorage.getAppointmentExtras(
    successfulExtrasBatch.map((appointment) => appointment.id),
  );
  for (const appointment of successfulExtrasBatch) {
    assert.deepEqual(
      successfulBatchSnapshots
        .filter((extra) => extra.appointmentId === appointment.id)
        .map((extra) => ({
          definitionId: extra.extraDefinitionId,
          amount: extra.amountCentsSnapshot,
          position: extra.position,
        })),
      [
        { definitionId: travelExtra.id, amount: 1250, position: 0 },
        { definitionId: productExtra.id, amount: 750, position: 1 },
      ],
      "every appointment in a successful batch must own independent ordered Extra snapshots",
    );
  }
  await databaseStorage.updateExtraDefinition(productExtra.id, Number(defaultLocation.id), { isActive: false });
  await databaseStorage.updateAppointmentWithNotification(
    appointmentWithExtra.id, {}, false, "booked", [{ extraId: travelExtra.id }, { extraId: productExtra.id }],
  );
  assert.equal((await databaseStorage.getAppointmentExtras([appointmentWithExtra.id])).length, 2,
    "an inactive Extra already attached to an appointment must remain readable");

  const batchCountBeforeRollback = (await databaseStorage.getAppointments(undefined, undefined, Number(defaultLocation.id))).length;
  await assert.rejects(databaseStorage.createAppointments([
    {
      locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
      startTime: new Date("2035-01-03T10:00:00.000Z"), customerName: "Batch rollback A",
      customerEmail: null, customerPhone: "910000021", durationMinutes: 30,
      cancelToken: "extra-storage-rollback-a", extras: [{ extraId: travelExtra.id, amountCents: 1250 }],
    },
    {
      locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
      startTime: new Date("2035-01-03T11:00:00.000Z"), customerName: "Batch rollback B",
      customerEmail: null, customerPhone: "910000022", durationMinutes: 30,
      cancelToken: "extra-storage-rollback-b", extras: [{ extraId: secondaryExtra.id }],
    },
  ]), (error: any) => error?.code === "APPOINTMENT_EXTRA_UNAVAILABLE");
  assert.equal(
    (await databaseStorage.getAppointments(undefined, undefined, Number(defaultLocation.id))).length,
    batchCountBeforeRollback,
    "an invalid Extra in a batch must roll back every appointment and snapshot",
  );
  await assert.rejects(databaseStorage.createAppointment({
    locationId: Number(defaultLocation.id), barberId: 1, serviceId: 1,
    startTime: new Date("2035-01-04T10:00:00.000Z"), customerName: "Extra duplicado",
    customerEmail: null, customerPhone: "910000023", durationMinutes: 30,
    cancelToken: "extra-storage-duplicate", extras: [
      { extraId: travelExtra.id, amountCents: 1000 },
      { extraId: travelExtra.id, amountCents: 1000 },
    ],
  }), (error: any) => error?.code === "APPOINTMENT_EXTRA_IDS_INVALID");
  await databaseStorage.updateAppointmentStatus(appointmentWithExtra.id, "completed", "cash");
  await assert.rejects(
    databaseStorage.updateAppointmentWithNotification(
      appointmentWithExtra.id, {}, false, "completed", [{ extraId: travelExtra.id }],
    ),
    (error: any) => error?.code === "APPOINTMENT_EXTRAS_NOT_EDITABLE",
  );

  const cuts = await databaseStorage.createServiceCategory({ name: "Cortes storage" });
  const treatments = await databaseStorage.createServiceCategory({ name: "Tratamentos storage" });
  assert.deepEqual((await databaseStorage.getServiceCategories({ includeInactive: true })).map((category) => category.id), [cuts.id, treatments.id]);
  assert.deepEqual((await databaseStorage.reorderServiceCategories([treatments.id, cuts.id])).map((category) => category.id), [treatments.id, cuts.id]);
  await assert.rejects(
    databaseStorage.reorderServiceCategories([cuts.id]),
    (error: any) => error?.code === "SERVICE_CATEGORY_ORDER_MISMATCH",
  );
  assert.deepEqual((await databaseStorage.getServiceCategories({ includeInactive: true })).map((category) => category.id), [treatments.id, cuts.id],
    "a rejected reorder must leave the previous deterministic order intact");
  await databaseStorage.updateService(1, { categoryId: cuts.id });
  assert.equal((await databaseStorage.getServicesWithCategories()).find((service) => service.id === 1)?.category?.id, cuts.id);
  await databaseStorage.updateServiceCategory(cuts.id, { isActive: false });
  assert.equal((await databaseStorage.getService(1))?.categoryId, cuts.id, "storage deactivation must preserve the association");
  assert.equal((await databaseStorage.getServicesWithCategories()).find((service) => service.id === 1)?.category, null,
    "inactive category metadata must not be exposed publicly");
  await databaseStorage.updateServiceCategory(cuts.id, { isActive: true });
  assert.equal((await databaseStorage.getServicesWithCategories()).find((service) => service.id === 1)?.category?.id, cuts.id,
    "reactivation must restore grouping without reassigning the service");
  await databaseStorage.deleteServiceCategory(cuts.id);
  assert.equal((await databaseStorage.getService(1))?.categoryId, null);
  await databaseStorage.deleteServiceCategory(treatments.id);

  const nonSeriesAppointmentCountBeforeSeriesFixture = Number((await pool.query(
    `SELECT count(*) AS count FROM ${table("appointments")} WHERE series_id IS NULL`,
  )).rows[0].count);
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
  assert.equal(Number((await pool.query(`SELECT count(*) AS count FROM ${table("appointments")} WHERE series_id IS NULL`)).rows[0].count),
    nonSeriesAppointmentCountBeforeSeriesFixture,
    "legacy appointments must not be retroactively grouped");

  const lateFallbackEvent = (await pool.query(`
    INSERT INTO ${table("appointment_notification_events")} (
      appointment_id, event_type, event_revision, event_key, appointment_start_time,
      whatsapp_status, provider_message_id
    ) VALUES (1, 'appointment_confirmation', 1, 'appointment:1:confirmation:1',
      '2030-06-03 09:00:00', 'failed', 'wamid.concurrent-claim')
    RETURNING id
  `)).rows[0];
  const claimSql = `
    UPDATE ${table("appointment_notification_events")}
    SET webhook_fallback_claimed_at = now(), updated_at = now()
    WHERE id = $1 AND whatsapp_status = 'failed'
      AND webhook_fallback_claimed_at IS NULL AND email_status <> 'sent'
    RETURNING id
  `;
  const claims = await Promise.all([
    pool.query(claimSql, [lateFallbackEvent.id]),
    pool.query(claimSql, [lateFallbackEvent.id]),
  ]);
  assert.equal(claims.reduce((total, claim) => total + claim.rowCount!, 0), 1,
    "concurrent late-email fallback claims must have exactly one winner");

  const inboundSenderKey = "test-sender-key";
  const inboundSummary = JSON.stringify({ senderKey: inboundSenderKey });
  async function claimInbound(receiptKey: string, inboundMessageId: string) {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('meta_inbound_auto_reply'), hashtext($1))", [inboundSenderKey]);
      const recent = await client.query(`
        SELECT id FROM ${table("meta_webhook_receipts")}
        WHERE payload_summary = $1 AND created_at >= $2
          AND (status LIKE 'inbound_auto_reply_claimed:%' OR status LIKE 'inbound_auto_reply_sent:%'
            OR status LIKE 'inbound_auto_reply_unknown:%')
        LIMIT 1
      `, [inboundSummary, new Date(Date.now() - 24 * 60 * 60 * 1000)]);
      if (recent.rowCount) {
        await client.query("COMMIT");
        return false;
      }
      const inserted = await client.query(`
        INSERT INTO ${table("meta_webhook_receipts")} (
          receipt_key, provider_message_id, status, waba_id, phone_number_id, payload_summary
        ) VALUES ($1, $2, 'inbound_auto_reply_claimed:text', 'waba', 'phone', $3)
        ON CONFLICT (receipt_key) DO NOTHING RETURNING id
      `, [receiptKey, inboundMessageId, inboundSummary]);
      await client.query("COMMIT");
      return inserted.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const inboundClaims = await Promise.all([
    claimInbound("inbound-receipt-one", "wamid.inbound-one"),
    claimInbound("inbound-receipt-two", "wamid.inbound-two"),
  ]);
  assert.equal(inboundClaims.filter(Boolean).length, 1,
    "concurrent inbound messages from one sender must have exactly one auto-reply claim");

  console.log("PASS: legacy data was preserved; migrations 0007/0008, Extra constraints, snapshots, transactional rollback and controlled re-execution passed on real PostgreSQL.");
} finally {
  if (applicationPool) await applicationPool.end();
  if (pool) await pool.end();
  await embedded.stop().catch(() => undefined);
  await rm(databaseDir, { recursive: true, force: true });
  await rm(preServiceTermsMigrationsDirectory, { recursive: true, force: true });
  await rm(preExtrasMigrationsDirectory, { recursive: true, force: true });
}
