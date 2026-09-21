import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";

test("memory catalogue counts preserve active assignments, zeroes and fresh updates", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const store = await import('./server/location-store.ts');
    const ids = Array.from({length: 15}, (_, i) => i + 1);
    for (const id of ids.slice(0, 14)) await store.assignBarberToLocation(id, 1);
    await store.assignBarberToLocation(2, 2);
    await store.removeBarberFromLocation(3, 1);
    const expected = new Map(await Promise.all(ids.map(async id => [id, (await store.getLocationIdsForBarber(id)).length])));
    assert.deepEqual(await store.getLocationCountsForBarbers(ids), expected);
    assert.deepEqual(await store.getLocationCountsForBarbers([]), new Map());
    assert.deepEqual(await store.getLocationCountsForBarbers([2, 2, 999]), new Map([[2, 2], [999, 0]]));
    await store.removeBarberFromLocation(2, 2);
    assert.equal((await store.getLocationCountsForBarbers([2])).get(2), 1);
    await store.assignBarberToLocation(3, 1);
    assert.equal((await store.getLocationCountsForBarbers([3])).get(3), 1);
  `], {
    cwd: process.cwd(), stdio: "pipe",
    env: { ...process.env, USE_MEMORY_STORAGE: "true", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused" },
  });
});

test("PostgreSQL catalogue returns identical counts with 1 query instead of 15", async () => {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => listener.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barber-catalogue-pg-"));
  const password = randomBytes(16).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let pool: import("pg").Pool | undefined;
  let started = false;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    process.env.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    process.env.DATABASE_SCHEMA = "catalogue_fixture";
    process.env.USE_MEMORY_STORAGE = "false";
    process.env.APP_ENV = "development";
    process.env.DATABASE_POOL_MAX = "4";
    ({ pool } = await import("../../server/db"));
    const store = await import("../../server/location-store");
    await pool.query(`
      CREATE SCHEMA catalogue_fixture;
      CREATE TABLE catalogue_fixture.barber_locations (
        barber_id integer NOT NULL, location_id integer NOT NULL,
        is_active boolean NOT NULL, PRIMARY KEY (barber_id, location_id)
      );
      INSERT INTO catalogue_fixture.barber_locations
        SELECT id, 1, id <> 14 FROM generate_series(1, 14) AS id;
      INSERT INTO catalogue_fixture.barber_locations VALUES (2, 2, true), (3, 3, false);
    `);

    const originalQuery = pool.query.bind(pool);
    let queryCount = 0;
    (pool as any).query = (...args: any[]) => {
      queryCount += 1;
      return originalQuery(...args);
    };

    const ids = Array.from({ length: 15 }, (_, i) => i + 1);
    const expected = new Map(await Promise.all(
      ids.map(async (id) => [id, (await store.getLocationIdsForBarber(id)).length] as const),
    ));
    assert.equal(queryCount, 15);
    queryCount = 0;
    const actual = await store.getLocationCountsForBarbers(ids);
    assert.deepEqual(actual, expected);
    assert.equal(queryCount, 1);
    assert.equal(actual.get(2), 2);
    assert.equal(actual.get(14), 0);
    assert.equal(actual.get(15), 0);
    queryCount = 0;
    assert.deepEqual(await store.getLocationCountsForBarbers([]), new Map());
    assert.equal(queryCount, 0);
    assert.deepEqual(await store.getLocationCountsForBarbers([2, 2, 999]), new Map([[2, 2], [999, 0]]));
    await store.removeBarberFromLocation(2, 2);
    assert.equal((await store.getLocationCountsForBarbers([2])).get(2), 1);
    await store.assignBarberToLocation(14, 1);
    assert.equal((await store.getLocationCountsForBarbers([14])).get(14), 1);

    // Real PostgreSQL projection: only the catalogue representation changes.
    await pool.query(`CREATE TABLE catalogue_fixture.barbers (
      id integer PRIMARY KEY, name text, specialty text, bio text, avatar text,
      email text, password text, color text, is_visible boolean
    )`);
    const upload = `data:image/jpeg;base64,${randomBytes(302_480).toString("base64")}`;
    for (const [id, avatar] of [[1, upload], [2, upload], [3, null], [4, "/images/barber.jpg"]] as const) {
      await pool.query("INSERT INTO catalogue_fixture.barbers VALUES ($1, 'Fixture', 'Hair', NULL, $2, NULL, NULL, '#123456', true)", [id, avatar]);
    }
    const { DatabaseStorage } = await import("../../server/storage");
    const { barberAvatarReference } = await import("../../server/barber-avatars");
    const storage = new DatabaseStorage();
    const full = await storage.getBarbers();
    const compactTiming = createRequestTimings("GET", "/api/barbers");
    const compact = await requestTimings.run(compactTiming, () => storage.getBarbers({ avatarReferences: true }));
    assert.deepEqual(compact, full.map((barber) => ({ ...barber, avatar: barberAvatarReference(barber.id, barber.avatar) })));
    assert.equal(compactTiming.sqlCount, 1);
    assert.equal((await storage.getBarber(1))?.avatar, upload);
    const beforeBytes = Buffer.byteLength(JSON.stringify(full));
    const afterBytes = Buffer.byteLength(JSON.stringify(compact));
    assert.ok(afterBytes < beforeBytes / 100);
    console.log(JSON.stringify({ measurement: "local-pg-catalogue-bytes", beforeBytes, afterBytes, reductionPercent: 100 * (1 - afterBytes / beforeBytes) }));
    const samples: unknown[] = [];
    for (let round = 0; round < 6; round++) {
      for (const references of (round % 2 ? [true, false] : [false, true])) {
        const timings = createRequestTimings("GET", "/api/barbers");
        const start = performance.now();
        await requestTimings.run(timings, () => storage.getBarbers({ avatarReferences: references }));
        samples.push({ round, references, wallMs: performance.now() - start, timings });
      }
    }
    console.log(JSON.stringify({ measurement: "local-pg-catalogue-read-samples", samples }));
  } finally {
    if (pool) await pool.end();
    if (started) await postgres.stop();
  }
});
