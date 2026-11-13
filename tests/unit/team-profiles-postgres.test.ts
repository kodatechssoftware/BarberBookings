import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { stopEmbeddedPostgres } from "../../script/embedded-postgres-lifecycle";
import { runSchemaMigrations } from "../../server/migrations";
import { teamProfileUpdateSchema } from "../../shared/team-profiles";

async function availablePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("public team profiles are additive, authorised, allowlisted and location-isolated", { timeout: 120_000 }, async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), "barberbookings-team-profiles-pg-"));
  const migrationsDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-team-profiles-migration-"));
  const port = await availablePort();
  const postgres = new EmbeddedPostgres({ databaseDir, port, user: "postgres", password: "team-profile-test", persistent: false, onLog: () => undefined, onError: () => undefined });
  let started = false;
  let pool: pg.Pool | undefined;
  try {
    await postgres.initialise();
    await postgres.start();
    started = true;
    const databaseUrl = `postgresql://postgres:team-profile-test@127.0.0.1:${port}/postgres`;
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: "public", NODE_ENV: "test", USE_MEMORY_STORAGE: "false",
      MIGRATION_DEFAULT_LOCATION_NAME: "Beauty Profile Test",
      MIGRATION_DEFAULT_LOCATION_ADDRESS: "Test address",
      MIGRATION_DEFAULT_LOCATION_TIME_ZONE: "Europe/Lisbon",
    });
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(`
      CREATE TABLE users (id serial PRIMARY KEY, display_name text NOT NULL);
      CREATE TABLE locations (id serial PRIMARY KEY, name text NOT NULL);
      CREATE TABLE barbers (
        id serial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL, bio text, avatar text,
        email text, password text, user_id integer REFERENCES users(id), color text NOT NULL DEFAULT '#000000', is_visible boolean DEFAULT true
      );
      CREATE TABLE services (id serial PRIMARY KEY, name text NOT NULL, price integer NOT NULL, duration integer NOT NULL, is_visible boolean DEFAULT true);
      CREATE TABLE barber_locations (
        barber_id integer NOT NULL REFERENCES barbers(id), location_id integer NOT NULL REFERENCES locations(id), is_active boolean NOT NULL DEFAULT true,
        PRIMARY KEY (barber_id, location_id)
      );
      CREATE TABLE service_locations (
        service_id integer NOT NULL REFERENCES services(id), location_id integer NOT NULL REFERENCES locations(id), is_active boolean NOT NULL DEFAULT true,
        price_override integer, duration_override integer, PRIMARY KEY (service_id, location_id)
      );
      CREATE TABLE barber_services (
        barber_id integer NOT NULL, service_id integer NOT NULL, location_id integer NOT NULL,
        PRIMARY KEY (barber_id, service_id, location_id),
        FOREIGN KEY (barber_id, location_id) REFERENCES barber_locations(barber_id, location_id),
        FOREIGN KEY (service_id, location_id) REFERENCES service_locations(service_id, location_id)
      );
    `);
    await copyFile(path.resolve("migrations/0031_public_team_profiles.sql"), path.join(migrationsDirectory, "0031_public_team_profiles.sql"));
    const firstRun = await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env });
    assert.deepEqual(firstRun.applied, ["0031_public_team_profiles.sql"]);
    const secondRun = await runSchemaMigrations(pool, { schemaName: "public", migrationsDirectory, environment: process.env });
    assert.equal(secondRun.alreadyApplied, 1);
    assert.deepEqual(secondRun.applied, []);

    await pool.query(`
      INSERT INTO users (id, display_name) VALUES (1, 'Administrador');
      INSERT INTO locations (id, name) VALUES (1, 'Beauty A'), (2, 'Beauty B');
      INSERT INTO barbers (id, name, specialty, bio, email, password, is_visible) VALUES
        (1, 'Mariana Silva', 'Unhas', 'Apresentação antiga', 'private@example.test', 'secret', true),
        (2, 'Carla Ferreira', 'Estética', null, 'other@example.test', 'secret-two', true);
      INSERT INTO services (id, name, price, duration, is_visible) VALUES (1, 'Manicure gel', 2800, 60, true), (2, 'Privado', 9000, 30, false);
      INSERT INTO barber_locations (barber_id, location_id) VALUES (1,1), (1,2), (2,1);
      INSERT INTO service_locations (service_id, location_id, is_active, price_override, duration_override) VALUES (1,1,true,null,null), (1,2,true,3000,75), (2,1,true,null,null);
      INSERT INTO barber_services (barber_id, service_id, location_id) VALUES (1,1,1), (1,1,2), (1,2,1);
    `);

    const module = await import("../../server/team-profiles");
    const empty = await module.getAdminTeamProfile(pool, 1, 1);
    assert.equal(empty.isPublished, false);
    assert.equal(empty.slug, "mariana-silva");
    assert.deepEqual(empty.services.map((service) => service.name), ["Manicure gel"]);

    assert.equal(teamProfileUpdateSchema.safeParse({
      slug: "mariana", bio: "Perfil", displayOrder: 0, isPublished: true, publicationAuthorized: false,
      qualifications: [], testimonials: [],
    }).success, false, "publication requires explicit professional authorisation");

    const saved = await module.saveAdminTeamProfile(pool, {
      locationId: 1,
      barberId: 1,
      actorUserId: 1,
      profile: teamProfileUpdateSchema.parse({
        slug: "mariana", bio: "Especialista em manicure.", displayOrder: 2,
        isPublished: true, publicationAuthorized: true,
        qualifications: [{ kind: "certification", title: "Nail Expert", issuer: "Academia", completedYear: 2025, description: null, displayOrder: 0, isPublished: true, publicationAuthorized: true }],
        testimonials: [{ authorDisplayName: "Cliente autorizada", quote: "Excelente trabalho.", sourceLabel: "Livro de elogios", displayOrder: 0, isPublished: true, publicationAuthorized: true }],
      }),
    });
    assert.equal(saved.isPublished, true);
    const publicProfiles = await module.listPublicTeamProfiles(pool, 1);
    assert.equal(publicProfiles.length, 1);
    assert.equal(publicProfiles[0].slug, "mariana");
    assert.equal(publicProfiles[0].services[0].price, 2800);
    assert.equal(publicProfiles[0].qualifications.length, 1);
    assert.equal(publicProfiles[0].testimonials.length, 1);
    const serialized = JSON.stringify(publicProfiles);
    for (const forbidden of ["private@example.test", "secret", "userId", "publicationAuthorized", "locationId"]) {
      assert.equal(serialized.includes(forbidden), false, `public DTO must not expose ${forbidden}`);
    }
    assert.deepEqual(await module.listPublicTeamProfiles(pool, 2), [], "publication is isolated by location");
    assert.deepEqual(await module.listPublicTeamProfiles(pool, 1, "not-found"), [], "direct unpublished/unknown URL is not exposed");

    await assert.rejects(
      pool.query("INSERT INTO barber_testimonials (barber_id, location_id, author_display_name, quote, is_published) VALUES (1,1,'Cliente','Sem autorização',true)"),
      (error: any) => error?.code === "23514",
    );
    await assert.rejects(
      module.saveAdminTeamProfile(pool, {
        locationId: 1,
        barberId: 2,
        actorUserId: 1,
        profile: teamProfileUpdateSchema.parse({ slug: "mariana", bio: "Não deve persistir", displayOrder: 0, isPublished: false, publicationAuthorized: false, qualifications: [], testimonials: [] }),
      }),
      (error: unknown) => error instanceof module.TeamProfileError && error.code === "TEAM_PROFILE_SLUG_CONFLICT",
    );
    assert.equal((await pool.query("SELECT bio FROM barbers WHERE id = 2")).rows[0].bio, null, "slug conflict rolls the whole transaction back");
    assert.equal(Number((await pool.query("SELECT count(*) AS count FROM barber_public_profiles WHERE barber_id = 2")).rows[0].count), 0);

    const unpublished = teamProfileUpdateSchema.parse({
      slug: "mariana", bio: saved.bio, displayOrder: 2, isPublished: false, publicationAuthorized: true,
      qualifications: saved.qualifications.map((item) => ({ ...item, isPublished: false })),
      testimonials: saved.testimonials.map((item) => ({ ...item, isPublished: false })),
    });
    await module.saveAdminTeamProfile(pool, { locationId: 1, barberId: 1, actorUserId: 1, profile: unpublished });
    assert.deepEqual(await module.listPublicTeamProfiles(pool, 1), [], "withdrawal is immediate");
  } finally {
    await pool?.end().catch(() => undefined);
    if (started) await stopEmbeddedPostgres(postgres).catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true });
    await rm(migrationsDirectory, { recursive: true, force: true });
  }
});
