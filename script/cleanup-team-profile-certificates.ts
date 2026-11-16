import { pool } from "../server/db";
import { cleanupTeamProfileCertificateOrphans } from "../server/team-profile-certificates";
import { createTeamProfileCertificateStorageFromEnvironment } from "../server/team-profile-certificate-storage";

async function main() {
  const rawLocationId = process.argv[2];
  const locationId = rawLocationId ? Number.parseInt(rawLocationId, 10) : undefined;
  if (rawLocationId && (!Number.isInteger(locationId) || (locationId ?? 0) <= 0)) {
    throw new Error("Usage: npm run certificates:cleanup -- [locationId]");
  }
  const result = await cleanupTeamProfileCertificateOrphans({
    pool,
    storage: createTeamProfileCertificateStorageFromEnvironment(),
    locationId,
    olderThanMinutes: 15,
    limit: 100,
  });
  console.log(JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
