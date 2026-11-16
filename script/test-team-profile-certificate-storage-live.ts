import { createClient } from "@supabase/supabase-js";
import {
  assertCertificateStorageSmokeExecutionContext,
  CertificateStorageSmokeError,
  runCertificateStorageSmokeTest,
} from "../server/team-profile-certificate-storage-smoke";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new CertificateStorageSmokeError("STORAGE_SMOKE_ENV_MISSING", `${name} não está configurada.`);
  return value;
}

async function main() {
  const context = assertCertificateStorageSmokeExecutionContext(process.env);
  const supabaseUrl = required("SUPABASE_URL");
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new CertificateStorageSmokeError("STORAGE_SMOKE_SECRET_MISSING", "A credencial backend do Supabase não está configurada.");
  const client = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await runCertificateStorageSmokeTest({
    client,
    supabaseUrl,
    expectedProjectRef: context.expectedProjectRef,
  });
  console.log(JSON.stringify({
    status: "CERTIFICATE_STORAGE_SMOKE_VALIDATED",
    serviceId: context.expectedServiceId,
    commit: context.expectedCommit,
    bucket: result.bucket,
    byteSize: result.byteSize,
    sha256Prefix: result.sha256.slice(0, 12),
    signedUrlStatus: result.signedUrlStatus,
    cleanupConfirmed: result.cleanupConfirmed,
  }));
}

main().catch((error) => {
  const safe = error instanceof CertificateStorageSmokeError
    ? { status: "CERTIFICATE_STORAGE_SMOKE_FAILED", code: error.code, cleanupPath: error.cleanupPath ?? null }
    : { status: "CERTIFICATE_STORAGE_SMOKE_FAILED", code: "STORAGE_SMOKE_UNEXPECTED", cleanupPath: null };
  console.error(JSON.stringify(safe));
  process.exitCode = 1;
});
