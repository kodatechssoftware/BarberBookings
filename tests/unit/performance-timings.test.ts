import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { Pool } from "pg";
import {
  createRequestTimings,
  instrumentPool,
  requestTimings,
  shouldEnablePerformanceTimings,
} from "../../server/performance-timings";

test("timing diagnostics are opt-in and fail closed in Production", () => {
  assert.equal(shouldEnablePerformanceTimings({ APP_ENV: "production", PERFORMANCE_TIMINGS_ENABLED: "true" }), false);
  assert.equal(shouldEnablePerformanceTimings({ APP_ENV: "development", PERFORMANCE_TIMINGS_ENABLED: "false" }), false);
  assert.equal(shouldEnablePerformanceTimings({ PERFORMANCE_TIMINGS_ENABLED: "true" }), false);
  assert.equal(shouldEnablePerformanceTimings({ NODE_ENV: "production", APP_ENV: "development", PERFORMANCE_TIMINGS_ENABLED: "true" }), true);
});

test("concurrent request contexts attribute acquisition and SQL timings separately", async () => {
  const client = {
    query(_sql: string, values?: unknown, callback?: (...args: unknown[]) => void) {
      const done = typeof values === "function" ? values : callback;
      if (typeof done === "function") {
        setTimeout(() => done(null, { rows: [] }), 5);
        return undefined;
      }
      return new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 5));
    },
  };
  class FakePool extends EventEmitter {
    totalCount = 1;
    idleCount = 0;
    waitingCount = 0;
    options = { max: 1 };

    connect(callback?: (...args: unknown[]) => void) {
      this.waitingCount = 1;
      if (callback) {
        setTimeout(() => {
          this.waitingCount = 0;
          callback(null, client, () => {});
        }, 10);
        return undefined;
      }
      return new Promise((resolve) => setTimeout(() => {
        this.waitingCount = 0;
        resolve(client);
      }, 10));
    }
  }

  const pool = new FakePool();
  instrumentPool(pool as unknown as Pool, true);
  pool.emit("connect", client);
  const first = createRequestTimings("GET", "/api/appointments");
  const second = createRequestTimings("GET", "/api/services");

  await Promise.all([
    requestTimings.run(first, async () => {
      const borrowed = await (pool as any).connect();
      await borrowed.query("SELECT 1");
    }),
    requestTimings.run(second, async () => {
      await new Promise<void>((resolve, reject) => {
        (pool as any).connect((error: unknown, borrowed: typeof client) => {
          if (error) return reject(error);
          borrowed.query("SELECT 2", (queryError: unknown) => {
            if (queryError) return reject(queryError);
            resolve();
          });
        });
      });
    }),
  ]);

  for (const timings of [first, second]) {
    assert.equal(timings.acquireCount, 1);
    assert.equal(timings.sqlCount, 1);
    assert.ok(timings.acquireMs > 0);
    assert.ok(timings.acquireByKindMs.queued > 0);
    assert.ok(timings.sqlRoundTripMs > 0);
    assert.equal(timings.maxPoolQueue, 1);
  }
});

test("real PostgreSQL pool reports queued acquisition apart from query round trips", async () => {
  const portServer = net.createServer();
  await new Promise<void>((resolve, reject) => portServer.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = portServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));

  const databaseDir = await mkdtemp(path.join(tmpdir(), "barber-perf-pg-"));
  const password = randomBytes(16).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir, port, user: "postgres", password,
    persistent: false, onLog: () => undefined, onError: () => undefined,
  });
  let pool: pg.Pool | undefined;
  let started = false;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    pool = new pg.Pool({
      connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      max: 1,
    });
    instrumentPool(pool, true);
    const timings = createRequestTimings("GET", "/api/appointments");
    await requestTimings.run(timings, () => Promise.all([
      pool!.query("SELECT pg_sleep(0.02)"),
      pool!.query("SELECT 1"),
    ]));

    assert.equal(timings.acquireCount, 2);
    assert.equal(timings.sqlCount, 2);
    assert.ok(timings.acquireByKindMs.new > 0);
    assert.ok(timings.acquireByKindMs.queued > 0);
    assert.ok(timings.sqlRoundTripMs > 0);
    assert.ok(timings.maxPoolQueue >= 1);
  } finally {
    if (pool) await pool.end();
    if (started) await postgres.stop();
    const parent = await realpath(tmpdir());
    // persistent:false normally removes this directory on stop(). If it does
    // not, validate the exact generated target before removing it ourselves.
    const target = path.resolve(databaseDir);
    assert.ok(target.startsWith(parent + path.sep), "PostgreSQL test directory must remain inside the temporary directory");
    await rm(target, { recursive: true, force: true });
  }
});
