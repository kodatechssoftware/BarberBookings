import type { Pool, PoolClient } from "pg";
import { barberAvatarReference } from "./barber-avatars";
import type { PublicTeamProfile, TeamProfileUpdateInput } from "@shared/team-profiles";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe database identifier.");
  return `"${identifier}"`;
}

const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
const table = (name: string) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`;

type ProfileRow = {
  barber_id: number;
  location_id: number;
  slug: string;
  display_order: number;
  is_published: boolean;
  publication_authorized_at: Date | null;
  name: string;
  specialty: string;
  bio: string | null;
  avatar: string | null;
};

type QualificationRow = {
  id: number;
  barber_id: number;
  kind: "course" | "training" | "diploma" | "certification";
  title: string;
  issuer: string | null;
  completed_year: number | null;
  description: string | null;
  display_order: number;
  is_published: boolean;
  publication_authorized_at: Date | null;
};

type TestimonialRow = {
  id: number;
  barber_id: number;
  author_display_name: string;
  quote: string;
  source_label: string | null;
  display_order: number;
  is_published: boolean;
  publication_authorized_at: Date | null;
};

type ServiceRow = {
  barber_id: number;
  id: number;
  name: string;
  duration: number;
  price: number;
};

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "profissional";
}

export class TeamProfileError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

function adminDto(profile: ProfileRow | null, barber: { id: number; name: string; specialty: string; bio: string | null; avatar: string | null }, qualifications: QualificationRow[], testimonials: TestimonialRow[], services: ServiceRow[]) {
  return {
    professionalId: barber.id,
    name: barber.name,
    specialty: barber.specialty,
    bio: barber.bio,
    avatar: barberAvatarReference(barber.id, barber.avatar),
    slug: profile?.slug ?? slugify(barber.name),
    displayOrder: profile?.display_order ?? 0,
    isPublished: profile?.is_published ?? false,
    publicationAuthorized: Boolean(profile?.publication_authorized_at),
    services: services.map((service) => ({ id: service.id, name: service.name, duration: service.duration, price: service.price })),
    qualifications: qualifications.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      issuer: item.issuer,
      completedYear: item.completed_year,
      description: item.description,
      displayOrder: item.display_order,
      isPublished: item.is_published,
      publicationAuthorized: Boolean(item.publication_authorized_at),
    })),
    testimonials: testimonials.map((item) => ({
      id: item.id,
      authorDisplayName: item.author_display_name,
      quote: item.quote,
      sourceLabel: item.source_label,
      displayOrder: item.display_order,
      isPublished: item.is_published,
      publicationAuthorized: Boolean(item.publication_authorized_at),
    })),
  };
}

async function loadServices(client: Pool | PoolClient, locationId: number, barberIds: number[]) {
  if (barberIds.length === 0) return [] as ServiceRow[];
  const result = await client.query<ServiceRow>(`
    SELECT bs.barber_id, s.id, s.name,
           COALESCE(sl.duration_override, s.duration) AS duration,
           COALESCE(sl.price_override, s.price) AS price
    FROM ${table("barber_services")} bs
    JOIN ${table("services")} s ON s.id = bs.service_id
    JOIN ${table("service_locations")} sl
      ON sl.service_id = bs.service_id AND sl.location_id = bs.location_id
    WHERE bs.location_id = $1 AND bs.barber_id = ANY($2::int[])
      AND sl.is_active = true AND s.is_visible = true
    ORDER BY s.name ASC, s.id ASC
  `, [locationId, barberIds]);
  return result.rows;
}

export async function getAdminTeamProfile(pool: Pool, locationId: number, barberId: number) {
  const [barberResult, profileResult, qualificationResult, testimonialResult, services] = await Promise.all([
    pool.query<{ id: number; name: string; specialty: string; bio: string | null; avatar: string | null }>(`
      SELECT b.id, b.name, b.specialty, b.bio, b.avatar
      FROM ${table("barbers")} b
      JOIN ${table("barber_locations")} bl ON bl.barber_id = b.id
      WHERE b.id = $1 AND bl.location_id = $2 AND bl.is_active = true
    `, [barberId, locationId]),
    pool.query<ProfileRow>(`
      SELECT p.*, b.name, b.specialty, b.bio, b.avatar
      FROM ${table("barber_public_profiles")} p
      JOIN ${table("barbers")} b ON b.id = p.barber_id
      WHERE p.barber_id = $1 AND p.location_id = $2
    `, [barberId, locationId]),
    pool.query<QualificationRow>(`
      SELECT id, barber_id, kind, title, issuer, completed_year, description, display_order,
             is_published, publication_authorized_at
      FROM ${table("barber_qualifications")}
      WHERE barber_id = $1 AND location_id = $2
      ORDER BY display_order, id
    `, [barberId, locationId]),
    pool.query<TestimonialRow>(`
      SELECT id, barber_id, author_display_name, quote, source_label, display_order,
             is_published, publication_authorized_at
      FROM ${table("barber_testimonials")}
      WHERE barber_id = $1 AND location_id = $2
      ORDER BY display_order, id
    `, [barberId, locationId]),
    loadServices(pool, locationId, [barberId]),
  ]);
  const barber = barberResult.rows[0];
  if (!barber) throw new TeamProfileError("TEAM_PROFILE_NOT_FOUND", 404, "Profissional não encontrada nesta localização.");
  return adminDto(profileResult.rows[0] ?? null, barber, qualificationResult.rows, testimonialResult.rows, services);
}

export async function saveAdminTeamProfile(pool: Pool, input: {
  locationId: number;
  barberId: number;
  actorUserId: number | null;
  profile: TeamProfileUpdateInput;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const association = await client.query<{ id: number }>(`
      SELECT b.id
      FROM ${table("barbers")} b
      JOIN ${table("barber_locations")} bl ON bl.barber_id = b.id
      WHERE b.id = $1 AND bl.location_id = $2 AND bl.is_active = true
      FOR UPDATE OF b, bl
    `, [input.barberId, input.locationId]);
    if (!association.rows[0]) throw new TeamProfileError("TEAM_PROFILE_NOT_FOUND", 404, "Profissional não encontrada nesta localização.");

    const authorizedAt = input.profile.publicationAuthorized ? new Date() : null;
    await client.query(`
      INSERT INTO ${table("barber_public_profiles")} (
        barber_id, location_id, slug, display_order, is_published,
        publication_authorized_at, publication_authorized_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (barber_id, location_id) DO UPDATE SET
        slug = EXCLUDED.slug,
        display_order = EXCLUDED.display_order,
        is_published = EXCLUDED.is_published,
        publication_authorized_at = EXCLUDED.publication_authorized_at,
        publication_authorized_by_user_id = EXCLUDED.publication_authorized_by_user_id,
        updated_at = now()
    `, [input.barberId, input.locationId, input.profile.slug, input.profile.displayOrder,
      input.profile.isPublished, authorizedAt, input.profile.publicationAuthorized ? input.actorUserId : null]);
    await client.query(`UPDATE ${table("barbers")} SET bio = $2 WHERE id = $1`, [input.barberId, input.profile.bio || null]);

    await client.query(`DELETE FROM ${table("barber_qualifications")} WHERE barber_id = $1 AND location_id = $2`, [input.barberId, input.locationId]);
    for (const item of input.profile.qualifications) {
      await client.query(`
        INSERT INTO ${table("barber_qualifications")} (
          barber_id, location_id, kind, title, issuer, completed_year, description,
          display_order, is_published, publication_authorized_at, publication_authorized_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [input.barberId, input.locationId, item.kind, item.title, item.issuer || null,
        item.completedYear ?? null, item.description || null, item.displayOrder, item.isPublished,
        item.publicationAuthorized ? new Date() : null, item.publicationAuthorized ? input.actorUserId : null]);
    }

    await client.query(`DELETE FROM ${table("barber_testimonials")} WHERE barber_id = $1 AND location_id = $2`, [input.barberId, input.locationId]);
    for (const item of input.profile.testimonials) {
      await client.query(`
        INSERT INTO ${table("barber_testimonials")} (
          barber_id, location_id, author_display_name, quote, source_label,
          display_order, is_published, publication_authorized_at, publication_authorized_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [input.barberId, input.locationId, item.authorDisplayName, item.quote, item.sourceLabel || null,
        item.displayOrder, item.isPublished, item.publicationAuthorized ? new Date() : null,
        item.publicationAuthorized ? input.actorUserId : null]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new TeamProfileError("TEAM_PROFILE_SLUG_CONFLICT", 409, "Este endereço público já está a ser utilizado nesta localização.");
    }
    throw error;
  } finally {
    client.release();
  }
  return getAdminTeamProfile(pool, input.locationId, input.barberId);
}

export async function listPublicTeamProfiles(pool: Pool, locationId: number, slug?: string): Promise<PublicTeamProfile[]> {
  const profileResult = await pool.query<ProfileRow>(`
    SELECT p.*, b.name, b.specialty, b.bio, b.avatar
    FROM ${table("barber_public_profiles")} p
    JOIN ${table("barbers")} b ON b.id = p.barber_id
    JOIN ${table("barber_locations")} bl
      ON bl.barber_id = p.barber_id AND bl.location_id = p.location_id
    WHERE p.location_id = $1 AND p.is_published = true
      AND p.publication_authorized_at IS NOT NULL
      AND bl.is_active = true AND b.is_visible = true
      AND ($2::text IS NULL OR p.slug = $2)
    ORDER BY p.display_order, b.name, b.id
  `, [locationId, slug ?? null]);
  const ids = profileResult.rows.map((profile) => profile.barber_id);
  if (ids.length === 0) return [];
  const [qualificationResult, testimonialResult, services] = await Promise.all([
    pool.query<QualificationRow>(`
      SELECT id, barber_id, kind, title, issuer, completed_year, description, display_order,
             is_published, publication_authorized_at
      FROM ${table("barber_qualifications")}
      WHERE location_id = $1 AND barber_id = ANY($2::int[])
        AND is_published = true AND publication_authorized_at IS NOT NULL
      ORDER BY display_order, id
    `, [locationId, ids]),
    pool.query<TestimonialRow>(`
      SELECT id, barber_id, author_display_name, quote, source_label, display_order,
             is_published, publication_authorized_at
      FROM ${table("barber_testimonials")}
      WHERE location_id = $1 AND barber_id = ANY($2::int[])
        AND is_published = true AND publication_authorized_at IS NOT NULL
      ORDER BY display_order, id
    `, [locationId, ids]),
    loadServices(pool, locationId, ids),
  ]);
  return profileResult.rows.map((profile) => ({
    professionalId: profile.barber_id,
    slug: profile.slug,
    name: profile.name,
    specialty: profile.specialty,
    bio: profile.bio,
    avatar: barberAvatarReference(profile.barber_id, profile.avatar),
    displayOrder: profile.display_order,
    services: services.filter((service) => service.barber_id === profile.barber_id)
      .map(({ id, name, duration, price }) => ({ id, name, duration, price })),
    qualifications: qualificationResult.rows.filter((item) => item.barber_id === profile.barber_id).map((item) => ({
      kind: item.kind, title: item.title, issuer: item.issuer,
      completedYear: item.completed_year, description: item.description,
    })),
    testimonials: testimonialResult.rows.filter((item) => item.barber_id === profile.barber_id).map((item) => ({
      authorDisplayName: item.author_display_name, quote: item.quote, sourceLabel: item.source_label,
    })),
  }));
}
