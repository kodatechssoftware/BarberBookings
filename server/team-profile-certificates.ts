import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ProcessedCertificateImage } from "./team-profile-certificate-image";
import {
  TEAM_PROFILE_CERTIFICATE_BUCKET,
  TEAM_PROFILE_CERTIFICATE_SIGNED_URL_SECONDS,
  type TeamProfileCertificateStorage,
} from "./team-profile-certificate-storage";

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error("Unsafe database identifier.");
  return `"${identifier}"`;
}

const schemaName = process.env.DATABASE_SCHEMA?.trim() || "public";
const table = (name: string) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`;

type DocumentRow = {
  id: number;
  qualification_id: number;
  barber_id: number;
  location_id: number;
  storage_path: string;
  mime_type: "image/webp";
  byte_size: number;
  sha256: string;
  upload_state: "uploading" | "ready" | "pending_delete" | "failed";
  is_current: boolean;
  is_published: boolean;
  publication_authorized_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type TeamProfileCertificateDto = {
  id: number;
  qualificationId: number;
  state: DocumentRow["upload_state"];
  isPublished: boolean;
  publicationAuthorized: boolean;
  mimeType: "image/webp";
  byteSize: number;
  createdAt: string;
  previewUrl: string;
};

export class TeamProfileCertificateError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

function adminDto(row: DocumentRow): TeamProfileCertificateDto {
  return {
    id: row.id,
    qualificationId: row.qualification_id,
    state: row.upload_state,
    isPublished: row.is_published,
    publicationAuthorized: Boolean(row.publication_authorized_at),
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at.toISOString(),
    previewUrl: `/api/admin/team-profiles/${row.barber_id}/certificates/${row.id}/preview?locationId=${row.location_id}`,
  };
}

async function assertQualificationScope(client: Pool | PoolClient, input: {
  qualificationId: number;
  barberId: number;
  locationId: number;
}, lock = false) {
  const result = await client.query<{ id: number }>(`
    SELECT q.id
    FROM ${table("barber_qualifications")} q
    JOIN ${table("barber_locations")} bl
      ON bl.barber_id = q.barber_id AND bl.location_id = q.location_id
    WHERE q.id = $1 AND q.barber_id = $2 AND q.location_id = $3 AND bl.is_active = true
    ${lock ? "FOR UPDATE OF q" : ""}
  `, [input.qualificationId, input.barberId, input.locationId]);
  if (!result.rows[0]) {
    throw new TeamProfileCertificateError("CERTIFICATE_QUALIFICATION_NOT_FOUND", 404, "Formação não encontrada nesta localização.");
  }
}

export async function listCurrentTeamProfileCertificates(pool: Pool, locationId: number, barberIds: number[]) {
  if (barberIds.length === 0) return new Map<number, TeamProfileCertificateDto>();
  const result = await pool.query<DocumentRow>(`
    SELECT id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
           upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
    FROM ${table("barber_qualification_documents")}
    WHERE location_id = $1 AND barber_id = ANY($2::int[]) AND is_current = true
    ORDER BY id
  `, [locationId, barberIds]);
  return new Map(result.rows.map((row) => [row.qualification_id, adminDto(row)]));
}

async function deleteDocumentObject(pool: Pool, storage: TeamProfileCertificateStorage, row: Pick<DocumentRow, "id" | "storage_path">) {
  await storage.remove(row.storage_path);
  await pool.query(`
    DELETE FROM ${table("barber_qualification_documents")}
    WHERE id = $1 AND is_current = false AND upload_state IN ('pending_delete', 'failed', 'uploading')
  `, [row.id]);
}

export async function uploadTeamProfileCertificate(input: {
  pool: Pool;
  storage: TeamProfileCertificateStorage;
  locationId: number;
  barberId: number;
  qualificationId: number;
  actorUserId: number | null;
  image: ProcessedCertificateImage;
}) {
  await assertQualificationScope(input.pool, input);
  const storagePath = `locations/${input.locationId}/professionals/${input.barberId}/qualifications/${input.qualificationId}/${randomUUID()}.webp`;
  const inserted = await input.pool.query<DocumentRow>(`
    INSERT INTO ${table("barber_qualification_documents")} (
      qualification_id, barber_id, location_id, storage_bucket, storage_path, mime_type,
      byte_size, sha256, upload_state, is_current, is_published, uploaded_by_user_id
    ) VALUES ($1,$2,$3,$4,$5,'image/webp',$6,$7,'uploading',false,false,$8)
    RETURNING id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
              upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
  `, [input.qualificationId, input.barberId, input.locationId, TEAM_PROFILE_CERTIFICATE_BUCKET,
    storagePath, input.image.byteSize, input.image.sha256, input.actorUserId]);
  const pending = inserted.rows[0]!;

  try {
    await input.storage.upload(storagePath, input.image.bytes, "image/webp");
  } catch (error) {
    await input.pool.query(`
      UPDATE ${table("barber_qualification_documents")}
      SET upload_state = 'failed', updated_at = now()
      WHERE id = $1 AND upload_state = 'uploading' AND is_current = false
    `, [pending.id]);
    throw error;
  }

  const client = await input.pool.connect();
  let previous: DocumentRow[] = [];
  try {
    await client.query("BEGIN");
    await assertQualificationScope(client, input, true);
    const previousResult = await client.query<DocumentRow>(`
      SELECT id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
             upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
      FROM ${table("barber_qualification_documents")}
      WHERE qualification_id = $1 AND is_current = true
      FOR UPDATE
    `, [input.qualificationId]);
    previous = previousResult.rows;
    await client.query(`
      UPDATE ${table("barber_qualification_documents")}
      SET is_current = false, is_published = false, publication_authorized_at = NULL,
          publication_authorized_by_user_id = NULL, upload_state = 'pending_delete',
          removed_at = now(), removed_by_user_id = $2, updated_at = now()
      WHERE qualification_id = $1 AND is_current = true
    `, [input.qualificationId, input.actorUserId]);
    const promoted = await client.query<DocumentRow>(`
      UPDATE ${table("barber_qualification_documents")}
      SET upload_state = 'ready', is_current = true, updated_at = now()
      WHERE id = $1 AND upload_state = 'uploading' AND is_current = false
      RETURNING id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
                upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
    `, [pending.id]);
    if (!promoted.rows[0]) throw new Error("Certificate promotion invariant failed.");
    await client.query("COMMIT");
    for (const old of previous) {
      try { await deleteDocumentObject(input.pool, input.storage, old); } catch { /* retained for idempotent cleanup */ }
    }
    return adminDto(promoted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    await input.pool.query(`UPDATE ${table("barber_qualification_documents")} SET upload_state = 'failed', updated_at = now() WHERE id = $1 AND is_current = false`, [pending.id]);
    try { await input.storage.remove(storagePath); } catch { /* cleanup endpoint can recover */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTeamProfileCertificatePublication(input: {
  pool: Pool;
  locationId: number;
  barberId: number;
  documentId: number;
  actorUserId: number | null;
  publicationAuthorized: boolean;
  isPublished: boolean;
}) {
  if (input.isPublished && !input.publicationAuthorized) {
    throw new TeamProfileCertificateError("CERTIFICATE_AUTHORIZATION_REQUIRED", 400, "Confirme a autorização antes de publicar o certificado.");
  }
  const result = await input.pool.query<DocumentRow>(`
    UPDATE ${table("barber_qualification_documents")}
    SET is_published = $4,
        publication_authorized_at = CASE WHEN $3 THEN COALESCE(publication_authorized_at, now()) ELSE NULL END,
        publication_authorized_by_user_id = CASE WHEN $3 THEN $5::int ELSE NULL END,
        updated_at = now()
    WHERE id = $1 AND location_id = $2 AND barber_id = $6
      AND is_current = true AND upload_state = 'ready' AND removed_at IS NULL
    RETURNING id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
              upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
  `, [input.documentId, input.locationId, input.publicationAuthorized, input.isPublished, input.actorUserId, input.barberId]);
  if (!result.rows[0]) throw new TeamProfileCertificateError("CERTIFICATE_NOT_FOUND", 404, "Certificado atual não encontrado.");
  return adminDto(result.rows[0]);
}

export async function removeTeamProfileCertificate(input: {
  pool: Pool;
  storage: TeamProfileCertificateStorage;
  locationId: number;
  barberId: number;
  documentId: number;
  actorUserId: number | null;
}) {
  const result = await input.pool.query<DocumentRow>(`
    UPDATE ${table("barber_qualification_documents")}
    SET is_current = false, is_published = false, publication_authorized_at = NULL,
        publication_authorized_by_user_id = NULL, upload_state = 'pending_delete',
        removed_at = now(), removed_by_user_id = $4, updated_at = now()
    WHERE id = $1 AND location_id = $2 AND barber_id = $3 AND is_current = true
    RETURNING id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
              upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
  `, [input.documentId, input.locationId, input.barberId, input.actorUserId]);
  if (!result.rows[0]) throw new TeamProfileCertificateError("CERTIFICATE_NOT_FOUND", 404, "Certificado atual não encontrado.");
  try {
    await deleteDocumentObject(input.pool, input.storage, result.rows[0]);
    return { removed: true, pendingCleanup: false };
  } catch {
    return { removed: true, pendingCleanup: true };
  }
}

export async function cleanupTeamProfileCertificateOrphans(input: {
  pool: Pool;
  storage: TeamProfileCertificateStorage;
  locationId?: number;
  olderThanMinutes?: number;
  limit?: number;
}) {
  const olderThanMinutes = Math.max(5, Math.min(input.olderThanMinutes ?? 15, 1440));
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const result = await input.pool.query<DocumentRow>(`
    SELECT id, qualification_id, barber_id, location_id, storage_path, mime_type, byte_size, sha256,
           upload_state, is_current, is_published, publication_authorized_at, created_at, updated_at
    FROM ${table("barber_qualification_documents")}
    WHERE is_current = false
      AND upload_state IN ('uploading', 'failed', 'pending_delete')
      AND updated_at < now() - ($1::int * interval '1 minute')
      AND ($2::int IS NULL OR location_id = $2)
    ORDER BY updated_at, id
    LIMIT $3
  `, [olderThanMinutes, input.locationId ?? null, limit]);
  let removed = 0;
  for (const row of result.rows) {
    try {
      await deleteDocumentObject(input.pool, input.storage, row);
      removed += 1;
    } catch { /* retry on the next explicit run */ }
  }
  return { inspected: result.rows.length, removed };
}

async function loadSignedDocument(input: {
  pool: Pool;
  storage: TeamProfileCertificateStorage;
  documentId: number;
  locationId: number;
  barberId?: number;
  publicOnly: boolean;
}) {
  const result = await input.pool.query<DocumentRow>(`
    SELECT d.id, d.qualification_id, d.barber_id, d.location_id, d.storage_path, d.mime_type,
           d.byte_size, d.sha256, d.upload_state, d.is_current, d.is_published,
           d.publication_authorized_at, d.created_at, d.updated_at
    FROM ${table("barber_qualification_documents")} d
    JOIN ${table("barber_qualifications")} q
      ON q.id = d.qualification_id AND q.barber_id = d.barber_id AND q.location_id = d.location_id
    JOIN ${table("barber_public_profiles")} p
      ON p.barber_id = d.barber_id AND p.location_id = d.location_id
    WHERE d.id = $1 AND d.location_id = $2
      AND ($3::int IS NULL OR d.barber_id = $3)
      AND d.is_current = true AND d.upload_state = 'ready' AND d.removed_at IS NULL
      AND (
        $4::boolean = false
        OR (
          d.is_published = true AND d.publication_authorized_at IS NOT NULL
          AND q.is_published = true AND q.publication_authorized_at IS NOT NULL
          AND p.is_published = true AND p.publication_authorized_at IS NOT NULL
        )
      )
  `, [input.documentId, input.locationId, input.barberId ?? null, input.publicOnly]);
  if (!result.rows[0]) throw new TeamProfileCertificateError("CERTIFICATE_NOT_FOUND", 404, "Certificado não disponível.");
  return input.storage.createSignedUrl(result.rows[0].storage_path, TEAM_PROFILE_CERTIFICATE_SIGNED_URL_SECONDS);
}

export const getAdminTeamProfileCertificateSignedUrl = (input: Omit<Parameters<typeof loadSignedDocument>[0], "publicOnly">) =>
  loadSignedDocument({ ...input, publicOnly: false });

export const getPublicTeamProfileCertificateSignedUrl = (input: Omit<Parameters<typeof loadSignedDocument>[0], "publicOnly" | "barberId">) =>
  loadSignedDocument({ ...input, publicOnly: true });
