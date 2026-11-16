import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TEAM_PROFILE_CERTIFICATE_BUCKET = "beauty-team-certificates";
export const TEAM_PROFILE_CERTIFICATE_SIGNED_URL_SECONDS = 60;

export interface TeamProfileCertificateStorage {
  upload(path: string, body: Buffer, contentType: "image/webp"): Promise<void>;
  remove(path: string): Promise<void>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export class CertificateStorageError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function assertSafeObjectPath(path: string) {
  if (!/^locations\/\d+\/professionals\/\d+\/qualifications\/\d+\/[0-9a-f-]{36}\.webp$/.test(path)) {
    throw new CertificateStorageError("CERTIFICATE_STORAGE_PATH_INVALID", "Caminho de certificado inválido.");
  }
}

export class SupabaseTeamProfileCertificateStorage implements TeamProfileCertificateStorage {
  constructor(private readonly client: SupabaseClient) {}

  async upload(path: string, body: Buffer, contentType: "image/webp") {
    assertSafeObjectPath(path);
    const { error } = await this.client.storage.from(TEAM_PROFILE_CERTIFICATE_BUCKET).upload(path, body, {
      contentType,
      cacheControl: "60",
      upsert: false,
    });
    if (error) throw new CertificateStorageError("CERTIFICATE_STORAGE_UPLOAD_FAILED", "Não foi possível guardar o certificado.");
  }

  async remove(path: string) {
    assertSafeObjectPath(path);
    const { error } = await this.client.storage.from(TEAM_PROFILE_CERTIFICATE_BUCKET).remove([path]);
    if (error) throw new CertificateStorageError("CERTIFICATE_STORAGE_DELETE_FAILED", "Não foi possível remover o certificado.");
  }

  async createSignedUrl(path: string, expiresInSeconds: number) {
    assertSafeObjectPath(path);
    const { data, error } = await this.client.storage.from(TEAM_PROFILE_CERTIFICATE_BUCKET)
      .createSignedUrl(path, expiresInSeconds, { download: false });
    if (error || !data?.signedUrl) {
      throw new CertificateStorageError("CERTIFICATE_STORAGE_SIGN_FAILED", "Não foi possível abrir o certificado.");
    }
    return data.signedUrl;
  }
}

export class MemoryTeamProfileCertificateStorage implements TeamProfileCertificateStorage {
  readonly objects = new Map<string, Buffer>();
  failNextUpload = false;
  failNextRemove = false;

  async upload(path: string, body: Buffer) {
    assertSafeObjectPath(path);
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new CertificateStorageError("CERTIFICATE_STORAGE_UPLOAD_FAILED", "Falha simulada no upload.");
    }
    if (this.objects.has(path)) throw new CertificateStorageError("CERTIFICATE_STORAGE_CONFLICT", "O objeto já existe.");
    this.objects.set(path, Buffer.from(body));
  }

  async remove(path: string) {
    assertSafeObjectPath(path);
    if (this.failNextRemove) {
      this.failNextRemove = false;
      throw new CertificateStorageError("CERTIFICATE_STORAGE_DELETE_FAILED", "Falha simulada na remoção.");
    }
    this.objects.delete(path);
  }

  async createSignedUrl(path: string, expiresInSeconds: number) {
    assertSafeObjectPath(path);
    if (!this.objects.has(path)) throw new CertificateStorageError("CERTIFICATE_STORAGE_NOT_FOUND", "Objeto não encontrado.");
    return `https://storage.test/${encodeURIComponent(path)}?expires=${expiresInSeconds}`;
  }
}

export function createTeamProfileCertificateStorageFromEnvironment(): TeamProfileCertificateStorage {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new CertificateStorageError(
      "CERTIFICATE_STORAGE_NOT_CONFIGURED",
      "O armazenamento privado de certificados ainda não está configurado.",
    );
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseTeamProfileCertificateStorage(client);
}
