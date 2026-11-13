import type { Pool } from "pg";
import {
  googleReviewSettingsUpdateSchema,
  toPublicGoogleReviewsPresentation,
  type AdminGoogleReviewSettings,
  type GoogleReviewSettingsUpdateInput,
  type PublicGoogleReviewsPresentation,
} from "@shared/google-reviews";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe database identifier.");
  return `"${identifier}"`;
}

const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
const table = (name: string) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`;

type GoogleReviewSettingsRow = {
  location_id: number;
  google_place_id: string | null;
  google_maps_url: string;
  google_review_request_url: string;
  updated_at: Date;
};

export class GoogleReviewSettingsError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

function toAdminDto(locationId: number, row?: GoogleReviewSettingsRow): AdminGoogleReviewSettings {
  return {
    locationId,
    configured: Boolean(row),
    googlePlaceId: row?.google_place_id ?? null,
    googleMapsUrl: row?.google_maps_url ?? "",
    googleReviewRequestUrl: row?.google_review_request_url ?? "",
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

export async function getAdminGoogleReviewSettings(pool: Pool, locationId: number) {
  const locationResult = await pool.query<{ id: number }>(`
    SELECT id FROM ${table("locations")} WHERE id = $1
  `, [locationId]);
  if (!locationResult.rows[0]) {
    throw new GoogleReviewSettingsError("GOOGLE_REVIEW_LOCATION_NOT_FOUND", 404, "Localização não encontrada.");
  }
  const result = await pool.query<GoogleReviewSettingsRow>(`
    SELECT location_id, google_place_id, google_maps_url, google_review_request_url, updated_at
    FROM ${table("location_google_review_settings")}
    WHERE location_id = $1
  `, [locationId]);
  return toAdminDto(locationId, result.rows[0]);
}

export async function saveAdminGoogleReviewSettings(pool: Pool, input: {
  locationId: number;
  settings: GoogleReviewSettingsUpdateInput;
}) {
  const settings = googleReviewSettingsUpdateSchema.parse(input.settings);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locationResult = await client.query<{ id: number }>(`
      SELECT id FROM ${table("locations")} WHERE id = $1 FOR UPDATE
    `, [input.locationId]);
    if (!locationResult.rows[0]) {
      throw new GoogleReviewSettingsError("GOOGLE_REVIEW_LOCATION_NOT_FOUND", 404, "Localização não encontrada.");
    }
    await client.query(`
      INSERT INTO ${table("location_google_review_settings")} (
        location_id, google_place_id, google_maps_url, google_review_request_url
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (location_id) DO UPDATE SET
        google_place_id = EXCLUDED.google_place_id,
        google_maps_url = EXCLUDED.google_maps_url,
        google_review_request_url = EXCLUDED.google_review_request_url,
        updated_at = now()
    `, [input.locationId, settings.googlePlaceId, settings.googleMapsUrl, settings.googleReviewRequestUrl]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getAdminGoogleReviewSettings(pool, input.locationId);
}

export async function getPublicGoogleReviewsPresentation(
  pool: Pool,
  locationId: number,
): Promise<PublicGoogleReviewsPresentation | null> {
  const result = await pool.query<GoogleReviewSettingsRow>(`
    SELECT settings.location_id, settings.google_place_id, settings.google_maps_url,
           settings.google_review_request_url, settings.updated_at
    FROM ${table("location_google_review_settings")} settings
    JOIN ${table("locations")} location ON location.id = settings.location_id
    WHERE settings.location_id = $1 AND location.is_active = true
  `, [locationId]);
  const row = result.rows[0];
  if (!row) return null;
  const parsed = googleReviewSettingsUpdateSchema.safeParse({
    googlePlaceId: row.google_place_id,
    googleMapsUrl: row.google_maps_url,
    googleReviewRequestUrl: row.google_review_request_url,
  });
  if (!parsed.success) return null;
  return toPublicGoogleReviewsPresentation(parsed.data);
}
