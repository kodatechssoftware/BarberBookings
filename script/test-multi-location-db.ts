import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Explicit opt-in: never read the application's DATABASE_URL to choose a test target.
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error("Set TEST_DATABASE_URL to a disposable local PostgreSQL instance.");
const url = new URL(target);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("Database integration tests only allow a loopback host.");
}
const schema = `test_multiloc_${randomUUID().replaceAll("-", "")}`;
process.env.DATABASE_URL = target;
process.env.DATABASE_SCHEMA = schema;
process.env.USE_MEMORY_STORAGE = "false";
process.env.SHOP_TIME_ZONE = "Europe/Lisbon";
process.env.SHOP_NAME = "Synthetic migration fixture";
const { pool, ensureMultiLocationFoundation, ensureAppointmentOverlapProtection } = await import("../server/db");
const table = (name: string) => `"${schema}"."${name}"`;

try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`
    CREATE TABLE ${table("barbers")} (id serial PRIMARY KEY, name text NOT NULL);
    CREATE TABLE ${table("services")} (id serial PRIMARY KEY, name text NOT NULL);
    CREATE TABLE ${table("appointments")} (
      id serial PRIMARY KEY, barber_id integer NOT NULL, service_id integer,
      start_time timestamp NOT NULL, duration_minutes integer NOT NULL,
      status text NOT NULL, customer_name text NOT NULL
    );
    CREATE TABLE ${table("shop_availability")} (id serial PRIMARY KEY, day_of_week integer, start_time text);
    CREATE TABLE ${table("barber_availability")} (id serial PRIMARY KEY, barber_id integer);
    CREATE TABLE ${table("business_expenses")} (id serial PRIMARY KEY, amount_cents integer);
    INSERT INTO ${table("barbers")} (name) VALUES ('Original barber');
    INSERT INTO ${table("services")} (name) VALUES ('Original service');
    INSERT INTO ${table("appointments")} (barber_id, service_id, start_time, duration_minutes, status, customer_name)
      VALUES (1, 1, '2030-09-09 13:30:00', 30, 'booked', 'Original customer');
    INSERT INTO ${table("shop_availability")} (day_of_week, start_time) VALUES (1, '09:00');
    INSERT INTO ${table("barber_availability")} (barber_id) VALUES (1);
    INSERT INTO ${table("business_expenses")} (amount_cents) VALUES (1275);
  `);
  const original = (await pool.query(`SELECT * FROM ${table("appointments")}`)).rows[0];
  await ensureMultiLocationFoundation();
  await ensureAppointmentOverlapProtection();
  const migrated = (await pool.query(`SELECT * FROM ${table("appointments")}`)).rows[0];
  assert.deepEqual(migrated, { ...original, location_id: 1 });
  for (const name of ["shop_availability", "barber_availability", "business_expenses"]) {
    assert.equal((await pool.query(`SELECT location_id FROM ${table(name)}`)).rows[0].location_id, 1);
  }
  await pool.query(`
    INSERT INTO ${table("locations")} (name, slug) VALUES ('Second shop', 'second');
    INSERT INTO ${table("barbers")} (name) VALUES ('Second barber');
    INSERT INTO ${table("services")} (name) VALUES ('Second service');
    INSERT INTO ${table("barber_locations")} (barber_id, location_id) VALUES (2, 2), (1, 2);
    INSERT INTO ${table("service_locations")} (service_id, location_id) VALUES (2, 2);
    UPDATE ${table("barber_locations")} SET is_active=false WHERE barber_id=1 AND location_id=1;
    INSERT INTO ${table("appointments")} (barber_id, service_id, start_time, duration_minutes, status, customer_name, location_id)
      VALUES (2, 2, '2030-09-09 14:30:00', 45, 'booked', 'Second customer', 2);
    INSERT INTO ${table("shop_availability")} (day_of_week, start_time, location_id) VALUES (1, '10:00', 2);
  `);
  const beforeRestart = (await pool.query(`SELECT * FROM ${table("appointments")} ORDER BY id`)).rows;
  await Promise.all([ensureMultiLocationFoundation(), ensureMultiLocationFoundation()]);
  await ensureAppointmentOverlapProtection();
  assert.deepEqual((await pool.query(`SELECT * FROM ${table("appointments")} ORDER BY id`)).rows, beforeRestart);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table("barber_locations")} WHERE barber_id=2 AND location_id=1`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table("service_locations")} WHERE service_id=2 AND location_id=1`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT is_active FROM ${table("barber_locations")} WHERE barber_id=1 AND location_id=1`)).rows[0].is_active, false);
  assert.deepEqual((await pool.query(`SELECT location_id, start_time FROM ${table("shop_availability")} ORDER BY id`)).rows,
    [{ location_id: 1, start_time: "09:00" }, { location_id: 2, start_time: "10:00" }]);
  const overlapping = await Promise.allSettled([1, 2].map((location) => pool.query(`
    INSERT INTO ${table("appointments")} (barber_id, service_id, start_time, duration_minutes, status, customer_name, location_id)
    VALUES (1, 1, '2030-10-10 14:30:00', 30, 'booked', 'Concurrent test', $1)
  `, [location])));
  assert.equal(overlapping.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = overlapping.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "23P01");
  const { createLocation } = await import("../server/location-store");
  const concurrentLocations = await Promise.allSettled([1, 2].map(() => createLocation({
    name: "Concurrent shop", address: "Synthetic address", timezone: "Europe/Lisbon", isActive: false,
  }, 3)));
  assert.equal(concurrentLocations.filter((result) => result.status === "fulfilled").length, 1);
  const refusedLocation = concurrentLocations.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(refusedLocation.reason.message, "LOCATION_LIMIT_REACHED");
  console.log("PASS: legacy data preserved; repeated/concurrent startup is idempotent; assignments and archives retained; hours isolated; cross-location overlap rejected by PostgreSQL.");
} finally {
  // Only the unique synthetic schema created by this script is removed.
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
