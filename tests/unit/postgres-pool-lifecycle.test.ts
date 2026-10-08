import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import EmbeddedPostgres from "embedded-postgres";
import pg, { type PoolClient } from "pg";
import {
  formatPostgresClientError,
  installPostgresPoolLifecycle,
} from "../../server/postgres-pool-lifecycle";

class FakePool extends EventEmitter {}
class FakeClient extends EventEmitter {
  queryAttempts = 0;

  async query() {
    this.queryAttempts += 1;
    const error = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    throw error;
  }
}

function socketError(message: string, code?: string) {
  return Object.assign(new Error(message), code ? { code } : {});
}

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("checked-out socket errors are handled once per lease and listeners do not accumulate", async () => {
  const pool = new FakePool();
  const client = new FakeClient();
  const logs: Array<{ state: string; error: Error }> = [];
  const dispose = installPostgresPoolLifecycle(
    pool as unknown as pg.Pool,
    (state, error) => logs.push({ state, error }),
  );

  const failures = [
    socketError("read ECONNABORTED", "ECONNABORTED"),
    socketError("read ECONNRESET", "ECONNRESET"),
    socketError("Connection terminated unexpectedly"),
  ];

  for (const failure of failures) {
    pool.emit("acquire", client);
    assert.equal(client.listenerCount("error"), 1);
    assert.doesNotThrow(() => client.emit("error", failure));
    assert.doesNotThrow(() => client.emit("error", failure), "subsequent socket events remain handled");
    pool.emit("release", undefined, client);
    assert.equal(client.listenerCount("error"), 0);
  }

  assert.deepEqual(logs.map(({ state, error }) => [state, (error as Error & { code?: string }).code, error.message]), [
    ["checked-out", "ECONNABORTED", "read ECONNABORTED"],
    ["checked-out", "ECONNRESET", "read ECONNRESET"],
    ["checked-out", undefined, "Connection terminated unexpectedly"],
  ]);

  const listenerWarnings: Error[] = [];
  const onWarning = (warning: Error) => listenerWarnings.push(warning);
  process.on("warning", onWarning);
  try {
    for (let index = 0; index < 25; index += 1) {
      pool.emit("acquire", client);
      pool.emit("release", undefined, client);
    }
    assert.equal(client.listenerCount("error"), 0);
    assert.equal(listenerWarnings.filter((warning) => warning.name === "MaxListenersExceededWarning").length, 0);
  } finally {
    process.removeListener("warning", onWarning);
  }

  dispose();
});

test("idle errors retain their separate pool-level path and logging never serializes client details", () => {
  const pool = new FakePool();
  const client = new FakeClient();
  const logs: Array<{ state: string; error: Error }> = [];
  const dispose = installPostgresPoolLifecycle(
    pool as unknown as pg.Pool,
    (state, error) => logs.push({ state, error }),
  );
  const failure = socketError("read ECONNRESET", "ECONNRESET") as Error & { client?: unknown };
  failure.client = { connectionString: "postgresql://secret@example.invalid/database" };

  pool.emit("error", failure, client);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].state, "idle");
  const formatted = formatPostgresClientError("idle", failure);
  assert.equal(formatted, "PostgreSQL idle client error: ECONNRESET (read ECONNRESET)");
  assert.doesNotMatch(formatted, /secret|connectionString/);
  dispose();
});

test("ordinary SQL errors still reject once and are not reclassified as socket errors", async () => {
  const pool = new FakePool();
  const client = new FakeClient();
  const logs: Array<{ state: string; error: Error }> = [];
  const dispose = installPostgresPoolLifecycle(
    pool as unknown as pg.Pool,
    (state, error) => logs.push({ state, error }),
  );

  pool.emit("acquire", client);
  await assert.rejects(client.query(), (error: Error & { code?: string }) => error.code === "42P01");
  pool.emit("release", undefined, client);

  assert.equal(client.queryAttempts, 1, "the lifecycle helper must not retry queries");
  assert.equal(logs.length, 0);
  dispose();
});

test("real pool and Drizzle transactions recover after a checked-out ECONNABORTED client", { timeout: 120_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-pool-lifecycle-"));
  const port = await availablePort();
  const password = "postgres-pool-lifecycle-test";
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  let postgresStarted = false;
  let pool: pg.Pool | undefined;

  try {
    await postgres.initialise();
    await postgres.start();
    postgresStarted = true;
    pool = new pg.Pool({
      connectionString: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      max: 1,
    });
    const logs: Array<{ state: string; error: Error }> = [];
    installPostgresPoolLifecycle(pool, (state, error) => logs.push({ state, error }));

    const firstClient = await pool.connect();
    const firstPid = Number((await firstClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const firstFailureHandled = deferred();
    const logStart = logs.length;
    const waitForFirstFailure = setInterval(() => {
      if (logs.length > logStart) firstFailureHandled.resolve();
    }, 5);
    const firstFailure = socketError("read ECONNABORTED", "ECONNABORTED");
    (firstClient as PoolClient & { connection: { stream: { destroy(error: Error): void } } })
      .connection.stream.destroy(firstFailure);
    await firstFailureHandled.promise;
    clearInterval(waitForFirstFailure);
    assert.equal((firstClient as PoolClient & { _queryable: boolean })._queryable, false);
    assert.doesNotThrow(() => firstClient.release(), "the owner can release exactly once after the socket error");

    const replacementClient = await pool.connect();
    const replacementPid = Number((await replacementClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    replacementClient.release();
    assert.notEqual(replacementPid, firstPid, "the invalid connection must not return to the pool");

    const database = drizzle(pool);
    const transactionEntered = deferred();
    const continueTransaction = deferred();
    let transactionClient: PoolClient | undefined;
    const captureTransactionClient = (client: PoolClient) => { transactionClient = client; };
    pool.once("acquire", captureTransactionClient);
    const transactionPromise = database.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1`);
      transactionEntered.resolve();
      await continueTransaction.promise;
      await tx.execute(sql`SELECT 2`);
    });
    await transactionEntered.promise;
    assert.ok(transactionClient);
    const transactionLogStart = logs.length;
    const transactionFailureHandled = deferred();
    const waitForTransactionFailure = setInterval(() => {
      if (logs.length > transactionLogStart) transactionFailureHandled.resolve();
    }, 5);
    (transactionClient as PoolClient & { connection: { stream: { destroy(error: Error): void } } })
      .connection.stream.destroy(socketError("read ECONNABORTED", "ECONNABORTED"));
    await transactionFailureHandled.promise;
    clearInterval(waitForTransactionFailure);
    continueTransaction.resolve();
    await assert.rejects(transactionPromise);

    const postTransactionResult = await pool.query("SELECT 3 AS value");
    assert.equal(Number(postTransactionResult.rows[0].value), 3);

    const logsBeforeSqlError = logs.length;
    await assert.rejects(
      pool.query("SELECT * FROM lifecycle_table_that_does_not_exist"),
      (error: Error & { code?: string }) => error.code === "42P01",
    );
    assert.equal(logs.length, logsBeforeSqlError, "ordinary SQL errors do not enter the socket-error logger");
  } finally {
    if (pool) await pool.end().catch(() => undefined);
    if (postgresStarted) await postgres.stop().catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
