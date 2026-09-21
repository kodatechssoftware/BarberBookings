import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "pg";
import { createStartupTimings, type StartupRecord } from "../../server/startup-timings";
import { instrumentPool, requestTimings } from "../../server/performance-timings";

const enabled = { APP_ENV: "development", PERFORMANCE_TIMINGS_ENABLED: "true" };

test("startup diagnostics use the existing opt-in and cannot activate in Production", async () => {
  for (const environment of [{}, { APP_ENV: "development" },
    { ...enabled, PERFORMANCE_TIMINGS_ENABLED: "false" },
    { ...enabled, APP_ENV: "production" }]) {
    const records: StartupRecord[] = [];
    const timing = createStartupTimings(environment, { write: (record) => records.push(record) });
    assert.equal(timing.sync("runtime-validation", () => 42), 42);
    assert.equal(await timing.measure("registerRoutes", async () => 43), 43);
    timing.start("workers")();
    timing.mark("listening");
    timing.totalBeforeListen();
    assert.deepEqual(records, []);
  }
  const records: StartupRecord[] = [];
  createStartupTimings({ ...enabled, NODE_ENV: "production" }, { write: (r) => records.push(r) });
  assert.deepEqual(records.map((r) => r.phase), ["process-origin", "instrumentation-ready"]);
});

test("nested phases preserve execution order/results and expose inclusive wall time", async () => {
  let clock = 10;
  const records: StartupRecord[] = [];
  const timing = createStartupTimings(enabled, { now: () => clock, timeOrigin: 0, write: (r) => records.push(r) });
  const calls: string[] = [];
  const result = { ok: true };
  const returned = await timing.measure("registerRoutes", async () => {
    calls.push("begin"); clock += 5;
    await timing.measure("session-store-initialization", async () => {
      calls.push("session"); clock += 20;
    });
    calls.push("end"); clock += 3;
    return result;
  });
  assert.strictEqual(returned, result);
  assert.deepEqual(calls, ["begin", "session", "end"]);
  const session = records.find((r) => r.phase === "session-store-initialization")!;
  const routes = records.find((r) => r.phase === "registerRoutes")!;
  assert.equal(session.parent, "registerRoutes");
  assert.equal(session.durationMs, 20);
  assert.equal(routes.durationMs, 28); // contains session, not additive
  assert.equal(routes.elapsedMs, 38);
  assert.equal(routes.at, "1970-01-01T00:00:00.038Z");
  assert.equal(requestTimings.getStore(), undefined);
  timing.totalBeforeListen();
  assert.equal(records.at(-1)?.durationMs, 38);
  const finish = timing.start("http-listen"); clock += 2; finish(); finish();
  assert.equal(records.filter((r) => r.phase === "http-listen").length, 1);
  assert.equal(records.at(-1)?.durationMs, 2);
});

test("phase failure preserves the original error and never serializes secrets or results", async () => {
  const records: StartupRecord[] = [];
  const secret = "SENSITIVE_TEST_SENTINEL";
  const timing = createStartupTimings({ ...enabled, DATABASE_URL: secret }, { write: (r) => records.push(r) });
  const failure = new Error(secret);
  assert.throws(() => timing.sync("runtime-validation", () => { throw failure; }), (error) => error === failure);
  await assert.rejects(timing.measure("repairKnownTextEncodingArtifacts", async () => { throw failure; }), (error) => error === failure);
  assert.equal(timing.sync("static-setup", () => secret), secret);
  assert.equal(records.filter((r) => r.status === "error").length, 2);
  assert.equal(JSON.stringify(records).includes(secret), false);
  const brokenLogger = createStartupTimings(enabled, { write: () => { throw new Error("logger failed"); } });
  assert.equal(await brokenLogger.measure("seedDatabase", async () => 7), 7);
  assert.throws(() => brokenLogger.sync("runtime-validation", () => { throw failure; }), (error) => error === failure);
});

test("startup SQL metrics close with their phase; inherited timers do not keep accumulating", async () => {
  const client = { query: async () => ({ rows: [] }) };
  class FakePool extends EventEmitter {
    totalCount = 1; idleCount = 1; waitingCount = 0; options = { max: 4 };
    connect(callback?: (...args: unknown[]) => void) {
      if (callback) { callback(null, client, () => {}); return; }
      return Promise.resolve(client);
    }
  }
  const pool = new FakePool();
  instrumentPool(pool as unknown as Pool, true);
  pool.emit("connect", client);
  const records: StartupRecord[] = [];
  const timing = createStartupTimings(enabled, { write: (r) => records.push(r) });
  let delayed!: Promise<void>;
  await timing.measure("ensureSessionStoreTable", async () => {
    const borrowed = await pool.connect();
    await borrowed!.query();
    delayed = new Promise((resolve, reject) => setTimeout(async () => {
      try {
        const closed = requestTimings.getStore()!;
        assert.equal(closed.closed, true);
        const before = { count: closed.sqlCount, acquire: closed.acquireCount };
        const later = await pool.connect(); await later!.query();
        await new Promise<void>((done) => pool.connect(() => done()));
        assert.deepEqual({ count: closed.sqlCount, acquire: closed.acquireCount }, before);
        resolve();
      } catch (error) { reject(error); }
    }, 10));
  });
  await delayed;
  const record = records.find((r) => r.phase === "ensureSessionStoreTable")!;
  assert.equal(record.sqlCount, 1);
  assert.equal(record.status, "ok");
  assert.equal(requestTimings.getStore(), undefined);
});
