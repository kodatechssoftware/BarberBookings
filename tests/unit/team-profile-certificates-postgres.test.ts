import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import sharp from "sharp";
import { stopEmbeddedPostgres } from "../../script/embedded-postgres-lifecycle";
import { runSchemaMigrations } from "../../server/migrations";
import { processCertificateImage } from "../../server/team-profile-certificate-image";
import { MemoryTeamProfileCertificateStorage } from "../../server/team-profile-certificate-storage";
import {
  cleanupTeamProfileCertificateOrphans,
  getPublicTeamProfileCertificateSignedUrl,
  removeTeamProfileCertificate,
  TeamProfileCertificateError,
  updateTeamProfileCertificatePublication,
  uploadTeamProfileCertificate,
} from "../../server/team-profile-certificates";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("0033 and certificate lifecycle are additive, private, atomic and location-isolated", { timeout: 120_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-certificates-pg-"));
  const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-certificates-migration-"));
  const port = await availablePort();
  const postgres = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "certificate-test", persistent: false, onLog: () => undefined, onError: () => undefined });
  let started = false;
  let pool: pg.Pool | undefined;
  try {
    await postgres.initialise(); await postgres.start(); started = true;
    const databaseUrl = `postgresql://postgres:certificate-test@127.0.0.1:${port}/postgres`;
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: "public",
      NODE_ENV: "test",
      MIGRATION_DEFAULT_LOCATION_NAME: "Certificate Test",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    });
    pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
    await pool.query(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE supabase_admin NOLOGIN;
    `);
    const supportsMaintain = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num) >= 170000;
    await pool.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT TRUNCATE, REFERENCES, TRIGGER${supportsMaintain ? ", MAINTAIN" : ""} ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER${supportsMaintain ? ", MAINTAIN" : ""} ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
    `);
    await pool.query(`
      CREATE TABLE users (id serial PRIMARY KEY, display_name text NOT NULL);
      CREATE TABLE locations (id serial PRIMARY KEY, name text NOT NULL);
      CREATE TABLE barbers (id serial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL, bio text, avatar text, is_visible boolean DEFAULT true);
      CREATE TABLE barber_locations (barber_id integer NOT NULL REFERENCES barbers(id), location_id integer NOT NULL REFERENCES locations(id), is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (barber_id, location_id));
    `);
    await pool.query(`CREATE SCHEMA rollback_fixture; CREATE TABLE rollback_fixture.users (id serial PRIMARY KEY); CREATE TABLE rollback_fixture.locations (id serial PRIMARY KEY); CREATE TABLE rollback_fixture.barbers (id serial PRIMARY KEY); CREATE TABLE rollback_fixture.barber_locations (barber_id int, location_id int, PRIMARY KEY (barber_id, location_id));`);
    const migration0031 = await readFile(path.resolve("migrations/0031_public_team_profiles.sql"), "utf8");
    const migration0033 = await readFile(path.resolve("migrations/0033_team_profile_certificate_documents.sql"), "utf8");
    const rollbackClient = await pool.connect();
    try {
      await rollbackClient.query("BEGIN");
      await rollbackClient.query(migration0031.replaceAll("{{schema}}", '"rollback_fixture"'));
      await rollbackClient.query(migration0033.replaceAll("{{schema}}", '"rollback_fixture"'));
      await rollbackClient.query("ROLLBACK");
    } finally { rollbackClient.release(); }
    assert.equal((await pool.query("SELECT to_regclass('rollback_fixture.barber_qualification_documents') AS relation")).rows[0].relation, null);

    await copyFile(path.resolve("migrations/0031_public_team_profiles.sql"), path.join(migrationsDirectory, "0031_public_team_profiles.sql"));
    await copyFile(path.resolve("migrations/0033_team_profile_certificate_documents.sql"), path.join(migrationsDirectory, "0033_team_profile_certificate_documents.sql"));
    assert.deepEqual((await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env })).applied,
      ["0031_public_team_profiles.sql", "0033_team_profile_certificate_documents.sql"]);
    assert.equal((await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env })).alreadyApplied, 2);
    const metadataSecurity = (await pool.query(`
      SELECT
        class_record.relrowsecurity AS rls_enabled,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid = class_record.oid) AS policy_count,
        has_table_privilege('anon', class_record.oid, 'SELECT') AS anon_select,
        has_table_privilege('anon', class_record.oid, 'TRUNCATE') AS anon_truncate,
        has_table_privilege('anon', class_record.oid, 'REFERENCES') AS anon_references,
        has_table_privilege('authenticated', class_record.oid, 'TRIGGER') AS authenticated_trigger,
        has_sequence_privilege('anon', 'barber_qualification_documents_id_seq', 'USAGE') AS anon_sequence_usage,
        has_sequence_privilege('authenticated', 'barber_qualification_documents_id_seq', 'UPDATE') AS authenticated_sequence_update
      FROM pg_class class_record
      WHERE class_record.oid = 'barber_qualification_documents'::regclass
    `)).rows[0];
    assert.deepEqual(metadataSecurity, {
      rls_enabled: true,
      policy_count: 0,
      anon_select: false,
      anon_truncate: false,
      anon_references: false,
      authenticated_trigger: false,
      anon_sequence_usage: false,
      authenticated_sequence_update: false,
    }, "0033 neutralises Supabase-style defaults and enables deny-by-default RLS");
    await pool.query(`
      CREATE TABLE location_google_review_settings (
        location_id integer PRIMARY KEY REFERENCES locations(id)
      );
      ALTER TABLE location_google_review_settings ENABLE ROW LEVEL SECURITY;
    `);
    assert.equal((await pool.query(`
      SELECT has_table_privilege('anon', 'barber_qualifications', 'TRUNCATE') AS existing_grant
    `)).rows[0].existing_grant, true,
    "0033 must not rewrite permissions on pre-existing 0031 objects");
    await pool.query("BEGIN");
    try {
      await pool.query(`
        REVOKE TRUNCATE, REFERENCES, TRIGGER${supportsMaintain ? ", MAINTAIN" : ""}
          ON public.barber_public_profiles, public.barber_qualifications, public.location_google_review_settings
          FROM anon, authenticated
      `);
      const residualPrivileges = await pool.query(`
        SELECT role_record.rolname, table_record.relname, privilege.privilege_name
        FROM (VALUES ('anon'), ('authenticated')) role_record(rolname)
        CROSS JOIN (VALUES
          ('barber_public_profiles'),
          ('barber_qualifications'),
          ('location_google_review_settings')
        ) table_record(relname)
        CROSS JOIN unnest($1::text[]) privilege(privilege_name)
        WHERE has_table_privilege(
          role_record.rolname,
          format('public.%I', table_record.relname),
          privilege.privilege_name
        )
      `, [["TRUNCATE", "REFERENCES", "TRIGGER", ...(supportsMaintain ? ["MAINTAIN"] : [])]]);
      assert.equal(residualPrivileges.rowCount, 0,
        "the isolated legacy-grant hardening proposal removes every effective elevated privilege");
    } finally {
      await pool.query("ROLLBACK");
    }
    assert.equal((await pool.query(`
      SELECT has_table_privilege('anon', 'barber_qualifications', 'TRUNCATE') AS existing_grant
    `)).rows[0].existing_grant, true,
    "the proposal test must roll back and leave pre-existing permissions unchanged");
    await pool.query(`
      INSERT INTO users (id, display_name) VALUES (1, 'Administrador');
      INSERT INTO locations (id, name) VALUES (1, 'Beauty A'), (2, 'Beauty B');
      INSERT INTO barbers (id, name, specialty, is_visible) VALUES (1, 'Mariana', 'Unhas', true), (2, 'Carla', 'Estética', true);
      INSERT INTO barber_locations (barber_id, location_id) VALUES (1,1), (2,2);
      INSERT INTO barber_public_profiles (barber_id, location_id, slug, is_published, publication_authorized_at) VALUES (1,1,'mariana',true,now()), (2,2,'carla',true,now());
      INSERT INTO barber_qualifications (id, barber_id, location_id, kind, title, is_published, publication_authorized_at) VALUES (1,1,1,'diploma','Diploma A',true,now()), (2,2,2,'course','Curso B',true,now());
    `);
    const storage = new MemoryTeamProfileCertificateStorage();
    const imageA = await processCertificateImage(await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#f0c0d0" } }).jpeg().toBuffer(), "image/jpeg");
    const uploaded = await uploadTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, qualificationId: 1, actorUserId: 1, image: imageA });
    assert.equal(uploaded.isPublished, false, "upload never publishes automatically");
    assert.equal(storage.objects.size, 1);
    await assert.rejects(
      updateTeamProfileCertificatePublication({ pool, locationId: 1, barberId: 1, documentId: uploaded.id, actorUserId: 1, publicationAuthorized: false, isPublished: true }),
      (error: unknown) => error instanceof TeamProfileCertificateError && error.code === "CERTIFICATE_AUTHORIZATION_REQUIRED",
    );
    const published = await updateTeamProfileCertificatePublication({ pool, locationId: 1, barberId: 1, documentId: uploaded.id, actorUserId: 1, publicationAuthorized: true, isPublished: true });
    assert.equal(published.isPublished, true);
    assert.match(await getPublicTeamProfileCertificateSignedUrl({ pool, storage, locationId: 1, documentId: uploaded.id }), /^https:\/\/storage\.test\//);
    await updateTeamProfileCertificatePublication({ pool, locationId: 1, barberId: 1, documentId: uploaded.id, actorUserId: 1, publicationAuthorized: true, isPublished: false });
    await assert.rejects(
      getPublicTeamProfileCertificateSignedUrl({ pool, storage, locationId: 1, documentId: uploaded.id }),
      (error: unknown) => error instanceof TeamProfileCertificateError && error.code === "CERTIFICATE_NOT_FOUND",
    );
    await updateTeamProfileCertificatePublication({ pool, locationId: 1, barberId: 1, documentId: uploaded.id, actorUserId: 1, publicationAuthorized: true, isPublished: true });
    await assert.rejects(
      getPublicTeamProfileCertificateSignedUrl({ pool, storage, locationId: 2, documentId: uploaded.id }),
      (error: unknown) => error instanceof TeamProfileCertificateError && error.code === "CERTIFICATE_NOT_FOUND",
    );

    const imageB = await processCertificateImage(await sharp({ create: { width: 900, height: 900, channels: 3, background: "#c0d0f0" } }).png().toBuffer(), "image/png");
    const replacement = await uploadTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, qualificationId: 1, actorUserId: 1, image: imageB });
    assert.notEqual(replacement.id, uploaded.id);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_qualification_documents WHERE qualification_id=1 AND is_current=true")).rows[0].count), 1);
    assert.equal(storage.objects.size, 1, "superseded object is removed after commit");

    storage.failNextUpload = true;
    await assert.rejects(uploadTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, qualificationId: 1, actorUserId: 1, image: imageA }));
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_qualification_documents WHERE qualification_id=1 AND is_current=true")).rows[0].count), 1,
      "failed replacement preserves the current document");

    await Promise.all([
      uploadTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, qualificationId: 1, actorUserId: 1, image: imageA }),
      uploadTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, qualificationId: 1, actorUserId: 1, image: imageB }),
    ]);
    const currentDocument = (await pool.query<{ id: number }>("SELECT id FROM barber_qualification_documents WHERE qualification_id=1 AND is_current=true")).rows[0];
    assert.ok(currentDocument);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_qualification_documents WHERE qualification_id=1 AND is_current=true")).rows[0].count), 1,
      "concurrent replacements retain exactly one current document");
    assert.equal(storage.objects.size, 1);

    storage.failNextRemove = true;
    const removed = await removeTeamProfileCertificate({ pool, storage, locationId: 1, barberId: 1, documentId: currentDocument.id, actorUserId: 1 });
    assert.equal(removed.pendingCleanup, true);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_qualification_documents WHERE is_current=true")).rows[0].count), 0);
    await pool.query(`
      UPDATE barber_qualification_documents
      SET created_at = now() - interval '2 hours',
          removed_at = CASE WHEN removed_at IS NULL THEN NULL ELSE now() - interval '1 hour' END,
          updated_at = now() - interval '1 hour'
      WHERE is_current = false
    `);
    const cleanup = await cleanupTeamProfileCertificateOrphans({ pool, storage, locationId: 1, olderThanMinutes: 5 });
    assert.ok(cleanup.inspected >= 1);
    assert.ok(cleanup.removed >= 1);
    assert.equal(storage.objects.size, 0);
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_qualification_documents")).rows[0].count), 0);
  } finally {
    await pool?.end().catch(() => undefined);
    if (started) await stopEmbeddedPostgres(postgres).catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
    await rm(migrationsDirectory, { recursive: true, force: true });
  }
});
