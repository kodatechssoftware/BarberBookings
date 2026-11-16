import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  SupabaseTeamProfileCertificateStorage,
  TEAM_PROFILE_CERTIFICATE_BUCKET,
} from "./team-profile-certificate-storage";

const EXPECTED_FILE_SIZE_LIMIT = 3 * 1024 * 1024;
const TEST_SCOPE_ID = 2_147_483_647;
export const CERTIFICATE_STORAGE_SMOKE_CONFIRMATION = "I_UNDERSTAND_THIS_WRITES_AND_DELETES_ONE_TEST_OBJECT";

export class CertificateStorageSmokeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cleanupPath?: string,
  ) {
    super(message);
  }
}

export type CertificateStorageSmokeResult = {
  bucket: typeof TEAM_PROFILE_CERTIFICATE_BUCKET;
  byteSize: number;
  sha256: string;
  signedUrlStatus: number;
  cleanupConfirmed: true;
};

function fail(code: string, message: string, cleanupPath?: string): never {
  throw new CertificateStorageSmokeError(code, message, cleanupPath);
}

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) fail("STORAGE_SMOKE_ENV_MISSING", `${name} não está configurada.`);
  return value;
}

export function assertCertificateStorageSmokeExecutionContext(environment: NodeJS.ProcessEnv) {
  if (environment.RUN_CERTIFICATE_STORAGE_SMOKE?.trim() !== CERTIFICATE_STORAGE_SMOKE_CONFIRMATION) {
    fail("STORAGE_SMOKE_NOT_CONFIRMED", "A confirmação explícita do teste não corresponde.");
  }
  const expectedServiceId = requiredEnvironmentValue(environment, "CERT_STORAGE_EXPECTED_SERVICE_ID");
  const expectedCommit = requiredEnvironmentValue(environment, "CERT_STORAGE_EXPECTED_GIT_COMMIT");
  const expectedProjectRef = requiredEnvironmentValue(environment, "CERT_STORAGE_EXPECTED_PROJECT_REF");
  if (requiredEnvironmentValue(environment, "RENDER_SERVICE_ID") !== expectedServiceId) {
    fail("STORAGE_SMOKE_SERVICE_MISMATCH", "O serviço Render não é o Beauty DEV aprovado.");
  }
  if (requiredEnvironmentValue(environment, "RENDER_GIT_COMMIT") !== expectedCommit) {
    fail("STORAGE_SMOKE_COMMIT_MISMATCH", "O commit Render não corresponde ao commit aprovado.");
  }
  if (requiredEnvironmentValue(environment, "RENDER_GIT_BRANCH") !== "feature/beauty-v2") {
    fail("STORAGE_SMOKE_BRANCH_MISMATCH", "A branch Render não é feature/beauty-v2.");
  }
  if (requiredEnvironmentValue(environment, "RENDER_GIT_REPO_SLUG") !== "kodatechssoftware/BarberBookings") {
    fail("STORAGE_SMOKE_REPOSITORY_MISMATCH", "O repositório Render não corresponde ao Beauty DEV.");
  }
  if (!/^[a-z0-9]{8,40}$/.test(expectedProjectRef)) {
    fail("STORAGE_SMOKE_PROJECT_REF_INVALID", "A referência esperada do projeto não é válida.");
  }
  return { expectedServiceId, expectedCommit, expectedProjectRef };
}

export function assertExpectedSupabaseProject(supabaseUrl: string, expectedProjectRef: string) {
  if (!/^[a-z0-9]{8,40}$/.test(expectedProjectRef)) {
    fail("STORAGE_SMOKE_PROJECT_REF_INVALID", "A referência esperada do projeto não é válida.");
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    fail("STORAGE_SMOKE_URL_INVALID", "SUPABASE_URL não contém um URL válido.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hostname !== `${expectedProjectRef}.supabase.co`
  ) {
    fail("STORAGE_SMOKE_PROJECT_MISMATCH", "SUPABASE_URL não corresponde ao projeto Beauty DEV aprovado.");
  }
}

function splitObjectPath(path: string) {
  const index = path.lastIndexOf("/");
  return { prefix: path.slice(0, index), name: path.slice(index + 1) };
}

async function objectExists(client: SupabaseClient, path: string) {
  const { prefix, name } = splitObjectPath(path);
  const { data, error } = await client.storage.from(TEAM_PROFILE_CERTIFICATE_BUCKET).list(prefix, {
    limit: 10,
    search: name,
  });
  if (error) fail("STORAGE_SMOKE_LIST_FAILED", "Não foi possível confirmar os objetos de teste.", path);
  return (data ?? []).some((item) => item.name === name);
}

async function sha256OfBlob(blob: Blob) {
  return createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
}

async function cleanupObject(client: SupabaseClient, path: string) {
  const bucket = client.storage.from(TEAM_PROFILE_CERTIFICATE_BUCKET);
  let lastRemoveFailed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await bucket.remove([path]);
    lastRemoveFailed = Boolean(error);
    try {
      if (!await objectExists(client, path)) return;
    } catch {
      // A second removal is still safe and idempotent. Verification is repeated below.
    }
  }
  try {
    if (!await objectExists(client, path)) return;
  } catch {
    fail("STORAGE_SMOKE_CLEANUP_UNVERIFIED", "Não foi possível confirmar a limpeza do objeto de teste.", path);
  }
  fail(
    lastRemoveFailed ? "STORAGE_SMOKE_CLEANUP_FAILED" : "STORAGE_SMOKE_OBJECT_REMAINED",
    "O objeto de teste ainda existe e requer remoção manual.",
    path,
  );
}

export async function runCertificateStorageSmokeTest(input: {
  client: SupabaseClient;
  supabaseUrl: string;
  expectedProjectRef: string;
  fetchImpl?: typeof fetch;
  objectId?: string;
}): Promise<CertificateStorageSmokeResult> {
  assertExpectedSupabaseProject(input.supabaseUrl, input.expectedProjectRef);

  const { data: bucket, error: bucketError } = await input.client.storage.getBucket(TEAM_PROFILE_CERTIFICATE_BUCKET);
  if (bucketError || !bucket) fail("STORAGE_SMOKE_BUCKET_MISSING", "O bucket privado esperado não está disponível.");
  if (bucket.public !== false) fail("STORAGE_SMOKE_BUCKET_PUBLIC", "O bucket de certificados não é privado.");
  if (bucket.file_size_limit !== EXPECTED_FILE_SIZE_LIMIT) {
    fail("STORAGE_SMOKE_BUCKET_SIZE_LIMIT", "O bucket não tem o limite exato de 3 MB.");
  }
  const mimeTypes = [...(bucket.allowed_mime_types ?? [])].sort();
  if (mimeTypes.length !== 1 || mimeTypes[0] !== "image/webp") {
    fail("STORAGE_SMOKE_BUCKET_MIME_TYPES", "O bucket não está limitado exclusivamente a image/webp.");
  }

  const objectId = input.objectId ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(objectId)) fail("STORAGE_SMOKE_OBJECT_ID_INVALID", "O identificador do teste não é válido.");
  const path = `locations/${TEST_SCOPE_ID}/professionals/${TEST_SCOPE_ID}/qualifications/${TEST_SCOPE_ID}/${objectId}.webp`;
  if (await objectExists(input.client, path)) fail("STORAGE_SMOKE_PATH_CONFLICT", "O caminho exclusivo do teste já existe.");

  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#d8a6b5" },
  }).webp({ quality: 80 }).toBuffer();
  const expectedSha256 = createHash("sha256").update(image).digest("hex");
  const adapter = new SupabaseTeamProfileCertificateStorage(input.client);
  let uploadAttempted = false;
  let result: Omit<CertificateStorageSmokeResult, "cleanupConfirmed"> | undefined;
  let testError: unknown;

  try {
    uploadAttempted = true;
    await adapter.upload(path, image, "image/webp");
    if (!await objectExists(input.client, path)) {
      fail("STORAGE_SMOKE_UPLOAD_NOT_LISTED", "O upload não apareceu no bucket.", path);
    }

    const { data: downloaded, error: downloadError } = await input.client.storage
      .from(TEAM_PROFILE_CERTIFICATE_BUCKET)
      .download(path);
    if (downloadError || !downloaded) fail("STORAGE_SMOKE_DOWNLOAD_FAILED", "Não foi possível reler o objeto privado.", path);
    if (await sha256OfBlob(downloaded) !== expectedSha256) {
      fail("STORAGE_SMOKE_DOWNLOAD_HASH_MISMATCH", "O hash do objeto privado não corresponde ao upload.", path);
    }

    const signedUrl = await adapter.createSignedUrl(path, 60);
    const signedResponse = await (input.fetchImpl ?? fetch)(signedUrl, {
      redirect: "follow",
      headers: { "cache-control": "no-store" },
    });
    if (!signedResponse.ok) fail("STORAGE_SMOKE_SIGNED_FETCH_FAILED", "A URL assinada não devolveu o objeto.", path);
    const signedBody = new Blob([await signedResponse.arrayBuffer()]);
    if (await sha256OfBlob(signedBody) !== expectedSha256) {
      fail("STORAGE_SMOKE_SIGNED_HASH_MISMATCH", "O hash obtido pela URL assinada não corresponde.", path);
    }
    result = {
      bucket: TEAM_PROFILE_CERTIFICATE_BUCKET,
      byteSize: image.length,
      sha256: expectedSha256,
      signedUrlStatus: signedResponse.status,
    };
  } catch (error) {
    testError = error;
  } finally {
    if (uploadAttempted) {
      try {
        await cleanupObject(input.client, path);
      } catch (cleanupError) {
        throw cleanupError;
      }
    }
  }

  if (testError) throw testError;
  if (!result) fail("STORAGE_SMOKE_INCOMPLETE", "O teste não chegou ao estado final esperado.");
  return { ...result, cleanupConfirmed: true };
}
