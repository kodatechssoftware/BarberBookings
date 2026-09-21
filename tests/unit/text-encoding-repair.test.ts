import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { performance } from "node:perf_hooks";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// Frozen oracle: the 16 rules and seven fields from 0134642, independently
// copied here. Do not derive the reference algorithm from the new builder.
const legacyRepairs = [
  ["Corte cl?ssico e barba", "Corte clássico e barba"],
  ["Perfil de demonstra??o DEV", "Perfil de demonstração"],
  ["Perfil de demonstra\uFFFD\uFFFDo DEV", "Perfil de demonstração"],
  ["Perfil de demonstração DEV", "Perfil de demonstração"],
  ["Jo?o Mendes", "João Mendes"], ["Lu?s Freitas", "Luís Freitas"],
  ["Tom?s Almeida", "Tomás Almeida"], ["S?rgio Matos", "Sérgio Matos"],
  ["Gon?alo Reis", "Gonçalo Reis"], ["C?sar Monteiro", "César Monteiro"],
  ["F?bio Lopes", "Fábio Lopes"], ["Sim?o Pires", "Simão Pires"],
  ["Andr\uFFFD Silva (DEV)", "André Silva"], ["Gon\uFFFDalo Costa (DEV)", "Gonçalo Costa"],
  ["André Silva (DEV)", "André Silva"], ["Gonçalo Costa (DEV)", "Gonçalo Costa"],
] as const;
const targets = [
  ["barbers", "name"], ["barbers", "specialty"], ["barbers", "bio"],
  ["appointments", "customer_name"], ["audit_logs", "actor_name"],
  ["audit_logs", "summary"], ["audit_logs", "metadata"],
] as const;
const tables = ["barbers", "appointments", "audit_logs"] as const;

test("ordered encoding repair: historical vs optimized on isolated UTF8 PostgreSQL", { timeout: 120_000 }, async (t) => {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barber-repair-pg-"));
  const postgres = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "local-repair-test",
    persistent: false, onLog: () => {}, onError: () => {} });
  let observer: pg.Pool | undefined, applicationPool: pg.Pool | undefined, started = false;
  const commands: string[] = [];
  try {
    await postgres.initialise(); await postgres.start(); started = true;
    const connectionString = `postgresql://postgres:local-repair-test@127.0.0.1:${port}/`;
    observer = new pg.Pool({ connectionString: connectionString + "postgres" });
    // Windows initdb can default to WIN1252, which cannot represent U+FFFD.
    await observer.query("CREATE DATABASE repair_test ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0");
    await observer.end();
    observer = new pg.Pool({ connectionString: connectionString + "repair_test", max: 3 });
    Object.assign(process.env, { DATABASE_URL: connectionString + "repair_test", DATABASE_SCHEMA: "optimized",
      DATABASE_POOL_MAX: "1", USE_MEMORY_STORAGE: "false", PERFORMANCE_TIMINGS_ENABLED: "false" });
    const application = await import("../../server/db");
    applicationPool = application.pool;
    applicationPool.on("connect", (client) => {
      const query = client.query.bind(client);
      (client as any).query = (...args: any[]) => {
        commands.push(typeof args[0] === "string" ? args[0] : args[0].text);
        return (query as any)(...args);
      };
    });
    for (const schema of ["legacy", "optimized"]) {
      await observer.query(`CREATE SCHEMA ${schema};
        CREATE TABLE ${schema}.barbers (id serial PRIMARY KEY, name text, specialty text, bio text, untouched text DEFAULT 'keep');
        CREATE TABLE ${schema}.appointments (id serial PRIMARY KEY, customer_name text, untouched text DEFAULT 'keep');
        CREATE TABLE ${schema}.audit_logs (id serial PRIMARY KEY, actor_name text, summary text, metadata text, untouched text DEFAULT 'keep')`);
    }

    async function seed(values: (string | null)[]) {
      for (const schema of ["legacy", "optimized"]) {
        for (const table of tables) {
          const fields = targets.filter(([name]) => name === table).map(([, column]) => column);
          await observer!.query(`TRUNCATE ${schema}.${table} RESTART IDENTITY`);
          await observer!.query(`INSERT INTO ${schema}.${table} (${fields.join(",")}) SELECT ${fields.map(() => "v").join(",")} FROM unnest($1::text[]) AS v`, [values]);
        }
      }
    }
    async function snapshot(schema: string, physical = false) {
      const result: Record<string, unknown> = {};
      for (const table of tables) {
        const fields = targets.filter(([name]) => name === table).map(([, column]) => column);
        // Hex of actual UTF8 bytes, not locale-sensitive text comparison.
        result[table] = (await observer!.query(`SELECT id, untouched,
          ${fields.map(column => `encode(convert_to(${column}, 'UTF8'), 'hex') AS ${column}`).join(",")}
          ${physical ? ", xmin::text, ctid::text" : ""} FROM ${schema}.${table} ORDER BY id`)).rows;
      }
      return result;
    }
    async function legacy() {
      const client = await observer!.connect();
      let count = 0, queryCount = 0;
      const start = performance.now();
      try {
        await client.query("BEGIN"); queryCount++;
        for (const [table, column] of targets) for (const [from, to] of legacyRepairs) {
          const result = await client.query(`UPDATE legacy.${table} SET ${column}=replace(${column},$1,$2) WHERE position($1 in ${column})>0`, [from, to]);
          queryCount++; count += result.rowCount || 0;
        }
        await client.query("COMMIT"); queryCount++;
        assert.equal(queryCount, 114);
        return { count, ms: performance.now() - start };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    async function optimized() {
      commands.length = 0;
      const start = performance.now();
      const count = await application.repairKnownTextEncodingArtifacts();
      const ms = performance.now() - start;
      assert.equal(commands.length, 9);
      assert.equal(commands[0], "BEGIN"); assert.equal(commands.at(-1), "COMMIT");
      assert.equal(commands.filter(sql => sql.includes("UPDATE ")).length, 7);
      return { count, ms };
    }
    const fixtures: (string | null)[] = [null, "", "Texto correto 👋 — café", "' $1 % _ \\ newline\n",
      ...legacyRepairs.flatMap(([from, to]) => [from, to, `${from} / ${from}`, JSON.stringify({ text: from })]),
      legacyRepairs.map(([from]) => from).join(" | "),
      "Perfil de demonstração DEV DEV", "Perfil de demonstra??o DEV DEV DEV",
      "André Silva (DEV) (DEV)", "Gonçalo Costa (DEV) (DEV)",
      "Perfil de demonstra??o DEV DEV", "Andr\uFFFD Silva (DEV) (DEV)",
      // Every ordered pair, adjacent and separated, including boundary effects.
      ...legacyRepairs.flatMap(([a]) => legacyRepairs.flatMap(([b]) => [a + b, a + " / " + b])),
    ];

    await t.test("first AND second executions match bytes and legacy counters for all seven fields", async () => {
      await seed(fixtures);
      for (let pass = 1; pass <= 2; pass++) {
        const before = await legacy(), after = await optimized();
        assert.equal(after.count, before.count);
        assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      }
    });
    await t.test("preexisting non-idempotent chains and ordering are NOT silently fixed", async () => {
      await seed(["Perfil de demonstração DEV DEV", "André Silva (DEV) (DEV)", "Perfil de demonstra??o DEV DEV"]);
      await legacy(); await optimized();
      const first = (await observer!.query("SELECT name FROM optimized.barbers ORDER BY id")).rows.map(r => r.name);
      assert.deepEqual(first, ["Perfil de demonstração DEV", "André Silva (DEV)", "Perfil de demonstração"]);
      assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      await legacy(); await optimized();
      const second = (await observer!.query("SELECT name FROM optimized.barbers ORDER BY id")).rows.map(r => r.name);
      assert.deepEqual(second, ["Perfil de demonstração", "André Silva", "Perfil de demonstração"]);
      assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
    });
    await t.test("multiple occurrences count once per rule/row, not per occurrence or final UPDATE", async () => {
      await seed(["Jo?o Mendes / Jo?o Mendes / Lu?s Freitas"]);
      assert.equal((await legacy()).count, 14);
      assert.equal((await optimized()).count, 14);
      assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      assert.equal((await legacy()).count, 0); assert.equal((await optimized()).count, 0);
    });
    await t.test("NULL, empty, already correct, and zero rows have no physical UPDATEs", async () => {
      for (const values of [[null, "", "João Mendes", "Perfil de demonstração", "André Silva"], []]) {
        await seed(values);
        const before = await snapshot("optimized", true);
        assert.equal((await legacy()).count, 0); assert.equal((await optimized()).count, 0);
        assert.deepEqual(await snapshot("optimized", true), before);
        assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      }
    });
    await t.test("failure in final field rolls back ALL earlier fields/tables, and connection is reusable", async () => {
      await seed(["Jo?o Mendes"]);
      const before = await snapshot("optimized");
      for (const schema of ["legacy", "optimized"]) await observer!.query(`ALTER TABLE ${schema}.audit_logs ADD CONSTRAINT fail_last_field CHECK (metadata <> 'João Mendes')`);
      try {
        await assert.rejects(legacy, (e: any) => e.code === "23514");
        commands.length = 0;
        await assert.rejects(application.repairKnownTextEncodingArtifacts, (e: any) => e.code === "23514");
        assert.equal(commands.at(-1), "ROLLBACK"); assert.ok(!commands.includes("COMMIT"));
        assert.deepEqual(await snapshot("optimized"), before);
        assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      } finally {
        for (const schema of ["legacy", "optimized"]) await observer!.query(`ALTER TABLE ${schema}.audit_logs DROP CONSTRAINT fail_last_field`);
      }
      assert.equal((await optimized()).count, 7);
    });
    await t.test("no partial repair is visible to another connection before COMMIT", async () => {
      await seed(["Jo?o Mendes"]);
      const before = await snapshot("optimized");
      const blocker = await observer!.connect();
      await blocker.query("BEGIN"); await blocker.query("LOCK TABLE optimized.audit_logs IN ACCESS EXCLUSIVE MODE");
      commands.length = 0;
      const pending = application.repairKnownTextEncodingArtifacts();
      try {
        const deadline = Date.now() + 5_000;
        while (commands.length < 6 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
        assert.equal(commands.length, 6, "repair reached first audit field after barbers and appointments");
        for (const table of ["barbers", "appointments"]) {
          const column = table === "barbers" ? "name" : "customer_name";
          assert.equal((await observer!.query(`SELECT ${column} AS value FROM optimized.${table}`)).rows[0].value, "Jo?o Mendes");
        }
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
      assert.notDeepEqual(await snapshot("optimized"), before);
      await legacy(); assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
    });
    await t.test("concurrent writer is not overwritten with a stale pre-lock value", async () => {
      await seed(["Jo?o Mendes"]);
      const writer = await observer!.connect();
      await writer.query("BEGIN");
      await writer.query("UPDATE optimized.barbers SET name='Lu?s Freitas / latest' WHERE id=1");
      commands.length = 0;
      const pending = application.repairKnownTextEncodingArtifacts();
      try {
        const deadline = Date.now() + 5_000;
        while (commands.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
        assert.equal(commands.length, 2);
      } finally { await writer.query("COMMIT"); writer.release(); await pending; }
      assert.equal((await observer!.query("SELECT name FROM optimized.barbers WHERE id=1")).rows[0].name, "Luís Freitas / latest");
    });
    await t.test("already repaired database benchmark preserves bytes and zero count", async () => {
      const samples: { legacyMs: number; optimizedMs: number }[] = [];
      await seed(Array.from({ length: 1000 }, (_, i) => `Texto correto ${i} / João Mendes / André Silva`));
      const before = await snapshot("optimized", true);
      for (let pass = 0; pass < 4; pass++) {
        const a = pass % 2 ? undefined : await legacy();
        const b = await optimized();
        const original = a ?? await legacy();
        assert.equal(b.count, 0); assert.equal(original.count, 0);
        if (pass > 0) samples.push({ legacyMs: original.ms, optimizedMs: b.ms });
      }
      assert.deepEqual(await snapshot("optimized", true), before);
      assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
      console.log(JSON.stringify({ benchmark: "local UTF8 PostgreSQL, warm, 1000 already-correct rows/table, 3 tables",
        commandsBefore: 114, commandsAfter: 9, samples }));
    });
    await t.test("many rows + local alternating before/after benchmark (not a remote estimate)", async () => {
      const large = Array.from({ length: 2000 }, (_, i) => fixtures[i % fixtures.length]);
      const samples: { legacyMs: number; optimizedMs: number; repaired: number }[] = [];
      for (let pass = 0; pass < 4; pass++) {
        await seed(large);
        const a = pass % 2 ? undefined : await legacy();
        const b = await optimized();
        const original = a ?? await legacy();
        assert.equal(b.count, original.count);
        assert.deepEqual(await snapshot("optimized"), await snapshot("legacy"));
        if (pass > 0) samples.push({ legacyMs: original.ms, optimizedMs: b.ms, repaired: b.count });
      }
      console.log(JSON.stringify({ benchmark: "local UTF8 PostgreSQL, warm, 2000 rows/table, 3 tables, no artificial latency",
        commandsBefore: 114, commandsAfter: 9, samples }));
    });
  } finally {
    if (applicationPool) await applicationPool.end();
    if (observer) await observer.end();
    if (started) await postgres.stop();
    const parent = await realpath(tmpdir()), target = path.resolve(databaseDir);
    assert.ok(target.startsWith(parent + path.sep));
    await rm(target, { recursive: true, force: true });
  }
});
