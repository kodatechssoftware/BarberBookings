import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { stopEmbeddedPostgres } from "../../script/embedded-postgres-lifecycle";
import { runSchemaMigrations } from "../../server/migrations";
import { googleReviewSettingsUpdateSchema } from "../../shared/google-reviews";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("Google review link settings are additive, strict, allowlisted and location-isolated", { timeout: 120_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-google-reviews-pg-"));
  const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-google-reviews-migration-"));
  const port = await availablePort();
  const postgres = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "google-review-test", persistent: false, onLog: () => undefined, onError: () => undefined });
  let started = false;
  let pool: pg.Pool | undefined;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    const databaseUrl = `postgresql://postgres:google-review-test@127.0.0.1:${port}/postgres`;
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: "public", NODE_ENV: "test", USE_MEMORY_STORAGE: "false",
      MIGRATION_DEFAULT_LOCATION_NAME: "Google Review Test",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    });
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(`
      CREATE TABLE locations (
        id serial PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true
      );
    `);
    await pool.query(`CREATE SCHEMA rollback_fixture; CREATE TABLE rollback_fixture.locations (id serial PRIMARY KEY)`);
    const canonicalSql = await readFile(path.resolve("migrations/0032_google_review_links.sql"), "utf8");
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query(canonicalSql.replaceAll("{{schema}}", '"rollback_fixture"'));
      await rollbackClient.query("ROLLBACK");
    } finally {
      rollbackClient.release();
    }
    assert.equal((await pool.query("SELECT to_regclass('rollback_fixture.location_google_review_settings') AS table_name")).rows[0].table_name, null,
      "a transaction rollback must remove every 0032 artifact");
    await copyFile(path.resolve("migrations/0032_google_review_links.sql"), path.join(migrationsDirectory, "0032_google_review_links.sql"));
    const firstRun = await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env });
    assert.deepEqual(firstRun.applied, ["0032_google_review_links.sql"]);
    const secondRun = await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env });
    assert.equal(secondRun.alreadyApplied, 1);
    assert.deepEqual(secondRun.applied, []);
    await pool.query("INSERT INTO locations (id, name, is_active) VALUES (1, 'Beauty A', true), (2, 'Beauty B', true), (3, 'Beauty C', false)");

    const module = await import("../../server/google-reviews");
    const empty = await module.getAdminGoogleReviewSettings(pool, 1);
    assert.equal(empty.configured, false);
    assert.equal(await module.getPublicGoogleReviewsPresentation(pool, 1), null);

    const input = googleReviewSettingsUpdateSchema.parse({
      googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      googleMapsUrl: "https://www.google.com/maps/place/Beauty+A",
      googleReviewRequestUrl: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
    const saved = await module.saveAdminGoogleReviewSettings(pool, { locationId: 1, settings: input });
    assert.equal(saved.configured, true);
    const publicPresentation = await module.getPublicGoogleReviewsPresentation(pool, 1);
    assert.equal(publicPresentation?.links.reviewsUrl, input.googleMapsUrl);
    const serialized = JSON.stringify(publicPresentation);
    assert.equal(serialized.includes("googlePlaceId"), false);
    assert.equal(serialized.includes("locationId"), false);
    assert.equal(await module.getPublicGoogleReviewsPresentation(pool, 2), null, "settings are isolated by location");

    await module.saveAdminGoogleReviewSettings(pool, {
      locationId: 3,
      settings: googleReviewSettingsUpdateSchema.parse({
        googlePlaceId: null,
        googleMapsUrl: "https://www.google.com/maps/place/Beauty+C",
        googleReviewRequestUrl: "https://g.page/r/CX_example-123/review",
      }),
    });
    assert.equal(await module.getPublicGoogleReviewsPresentation(pool, 3), null, "inactive locations are not public");
    await assert.rejects(
      module.saveAdminGoogleReviewSettings(pool, { locationId: 999, settings: input }),
      (error: unknown) => error instanceof module.GoogleReviewSettingsError && error.code === "GOOGLE_REVIEW_LOCATION_NOT_FOUND",
    );
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM location_google_review_settings")).rows[0].count), 2);

    await assert.rejects(
      pool.query(`INSERT INTO location_google_review_settings (location_id, google_maps_url, google_review_request_url) VALUES (2, 'https://evil.example/maps', 'https://g.page/r/example/review')`),
      (error: any) => error?.code === "23514",
    );
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM location_google_review_settings WHERE location_id = 2")).rows[0].count), 0);
  } finally {
    await pool?.end().catch(() => undefined);
    if (started) await stopEmbeddedPostgres(postgres).catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
    await rm(migrationsDirectory, { recursive: true, force: true });
  }
});
