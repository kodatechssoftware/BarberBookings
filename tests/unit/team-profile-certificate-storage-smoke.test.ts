import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertCertificateStorageSmokeExecutionContext,
  CERTIFICATE_STORAGE_SMOKE_CONFIRMATION,
  CertificateStorageSmokeError,
  runCertificateStorageSmokeTest,
} from "../../server/team-profile-certificate-storage-smoke";

const projectRef = "beautydevprojectref01";
const supabaseUrl = `https://${projectRef}.supabase.co`;

const validRenderEnvironment: NodeJS.ProcessEnv = {
  RUN_CERTIFICATE_STORAGE_SMOKE: CERTIFICATE_STORAGE_SMOKE_CONFIRMATION,
  CERT_STORAGE_EXPECTED_SERVICE_ID: "srv-beauty-dev",
  CERT_STORAGE_EXPECTED_GIT_COMMIT: "958b4b2b900cc7e3ea61468da1f5c1526cc6977c",
  CERT_STORAGE_EXPECTED_PROJECT_REF: projectRef,
  RENDER_SERVICE_ID: "srv-beauty-dev",
  RENDER_GIT_COMMIT: "958b4b2b900cc7e3ea61468da1f5c1526cc6977c",
  RENDER_GIT_BRANCH: "feature/beauty-v2",
  RENDER_GIT_REPO_SLUG: "kodatechssoftware/BarberBookings",
};

function fakeStorage(options: {
  public?: boolean;
  fileSizeLimit?: number;
  mimeTypes?: string[];
  signedFetchFails?: boolean;
  removeFailures?: number;
} = {}) {
  const objects = new Map<string, Buffer>();
  let removeFailures = options.removeFailures ?? 0;
  const bucket = {
    id: "beauty-team-certificates",
    name: "beauty-team-certificates",
    owner: "test",
    public: options.public ?? false,
    file_size_limit: options.fileSizeLimit ?? 3 * 1024 * 1024,
    allowed_mime_types: options.mimeTypes ?? ["image/webp"],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
  const api = {
    getBucket: async () => ({ data: bucket, error: null }),
    from: () => ({
      upload: async (path: string, body: Buffer) => {
        if (objects.has(path)) return { data: null, error: new Error("conflict") };
        objects.set(path, Buffer.from(body));
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        if (removeFailures > 0) {
          removeFailures -= 1;
          return { data: null, error: new Error("temporary") };
        }
        paths.forEach((path) => objects.delete(path));
        return { data: paths, error: null };
      },
      createSignedUrl: async (path: string) => objects.has(path)
        ? { data: { signedUrl: `https://signed.test/${encodeURIComponent(path)}` }, error: null }
        : { data: null, error: new Error("missing") },
      list: async (prefix: string, input: { search?: string }) => ({
        data: [...objects.keys()]
          .filter((path) => path.startsWith(`${prefix}/`))
          .map((path) => ({ name: path.slice(prefix.length + 1) }))
          .filter((item) => !input.search || item.name.includes(input.search)),
        error: null,
      }),
      download: async (path: string) => objects.has(path)
        ? { data: new Blob([objects.get(path)!]), error: null }
        : { data: null, error: new Error("missing") },
    }),
  };
  const fetchImpl = async (url: string | URL | Request) => {
    if (options.signedFetchFails) return new Response("unavailable", { status: 503 });
    const path = decodeURIComponent(new URL(String(url)).pathname.slice(1));
    const body = objects.get(path);
    return body ? new Response(body, { status: 200, headers: { "content-type": "image/webp" } }) : new Response("missing", { status: 404 });
  };
  return { client: { storage: api } as unknown as SupabaseClient, objects, fetchImpl: fetchImpl as typeof fetch };
}

test("live Storage smoke cannot run during a normal build and validates every Render guard first", () => {
  assert.throws(
    () => assertCertificateStorageSmokeExecutionContext({}),
    (error: unknown) => error instanceof CertificateStorageSmokeError && error.code === "STORAGE_SMOKE_NOT_CONFIRMED",
  );
  assert.deepEqual(assertCertificateStorageSmokeExecutionContext(validRenderEnvironment), {
    expectedServiceId: "srv-beauty-dev",
    expectedCommit: "958b4b2b900cc7e3ea61468da1f5c1526cc6977c",
    expectedProjectRef: projectRef,
  });
  for (const [name, value, code] of [
    ["RENDER_SERVICE_ID", "srv-other", "STORAGE_SMOKE_SERVICE_MISMATCH"],
    ["RENDER_GIT_COMMIT", "wrong-sha", "STORAGE_SMOKE_COMMIT_MISMATCH"],
    ["RENDER_GIT_BRANCH", "main", "STORAGE_SMOKE_BRANCH_MISMATCH"],
    ["RENDER_GIT_REPO_SLUG", "other/repository", "STORAGE_SMOKE_REPOSITORY_MISMATCH"],
    ["CERT_STORAGE_EXPECTED_PROJECT_REF", "invalid.project", "STORAGE_SMOKE_PROJECT_REF_INVALID"],
  ] as const) {
    assert.throws(
      () => assertCertificateStorageSmokeExecutionContext({ ...validRenderEnvironment, [name]: value }),
      (error: unknown) => error instanceof CertificateStorageSmokeError && error.code === code,
    );
  }
});

test("live Storage smoke round-trip validates private restrictions, integrity, signed access and cleanup", async () => {
  const fake = fakeStorage();
  const result = await runCertificateStorageSmokeTest({
    client: fake.client,
    supabaseUrl,
    expectedProjectRef: projectRef,
    fetchImpl: fake.fetchImpl,
    objectId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.bucket, "beauty-team-certificates");
  assert.equal(result.signedUrlStatus, 200);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(fake.objects.size, 0);
});

test("live Storage smoke refuses a different project or unsafe bucket before upload", async () => {
  const correct = fakeStorage();
  await assert.rejects(
    runCertificateStorageSmokeTest({ client: correct.client, supabaseUrl, expectedProjectRef: "differentprojectref01", fetchImpl: correct.fetchImpl }),
    (error: unknown) => error instanceof CertificateStorageSmokeError && error.code === "STORAGE_SMOKE_PROJECT_MISMATCH",
  );
  assert.equal(correct.objects.size, 0);

  for (const unsafe of [
    fakeStorage({ public: true }),
    fakeStorage({ fileSizeLimit: 4 * 1024 * 1024 }),
    fakeStorage({ mimeTypes: ["image/webp", "image/png"] }),
  ]) {
    await assert.rejects(runCertificateStorageSmokeTest({
      client: unsafe.client,
      supabaseUrl,
      expectedProjectRef: projectRef,
      fetchImpl: unsafe.fetchImpl,
    }));
    assert.equal(unsafe.objects.size, 0);
  }
});

test("live Storage smoke removes its object after a signed-read failure and retries transient deletion", async () => {
  const signedFailure = fakeStorage({ signedFetchFails: true });
  await assert.rejects(
    runCertificateStorageSmokeTest({
      client: signedFailure.client,
      supabaseUrl,
      expectedProjectRef: projectRef,
      fetchImpl: signedFailure.fetchImpl,
    }),
    (error: unknown) => error instanceof CertificateStorageSmokeError && error.code === "STORAGE_SMOKE_SIGNED_FETCH_FAILED",
  );
  assert.equal(signedFailure.objects.size, 0);

  const transientCleanupFailure = fakeStorage({ removeFailures: 1 });
  const result = await runCertificateStorageSmokeTest({
    client: transientCleanupFailure.client,
    supabaseUrl,
    expectedProjectRef: projectRef,
    fetchImpl: transientCleanupFailure.fetchImpl,
  });
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(transientCleanupFailure.objects.size, 0);
});

test("live Storage smoke fails closed and reports only the safe object path when cleanup cannot finish", async () => {
  const persistentCleanupFailure = fakeStorage({ removeFailures: 5 });
  await assert.rejects(
    runCertificateStorageSmokeTest({
      client: persistentCleanupFailure.client,
      supabaseUrl,
      expectedProjectRef: projectRef,
      fetchImpl: persistentCleanupFailure.fetchImpl,
      objectId: "22222222-2222-4222-8222-222222222222",
    }),
    (error: unknown) => error instanceof CertificateStorageSmokeError
      && error.code === "STORAGE_SMOKE_CLEANUP_FAILED"
      && error.cleanupPath === "locations/2147483647/professionals/2147483647/qualifications/2147483647/22222222-2222-4222-8222-222222222222.webp",
  );
  assert.equal(persistentCleanupFailure.objects.size, 1, "the test fixture models the object that requires manual cleanup");
});
