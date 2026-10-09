import "dotenv/config";
import { pool } from "../server/db";
import {
  LegacyAuthBackfillFoundationError,
  LegacyAuthBackfillLockedError,
  parseLegacyAuthBackfillArgs,
  runLegacyAuthBackfill,
} from "../server/auth-legacy-backfill";

try {
  const options = parseLegacyAuthBackfillArgs(process.argv.slice(2));
  const report = await runLegacyAuthBackfill(pool, options);
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.FAILED > 0) process.exitCode = 1;
} catch (error) {
  const code = error instanceof LegacyAuthBackfillLockedError
    ? "BACKFILL_ALREADY_RUNNING"
    : error instanceof LegacyAuthBackfillFoundationError
      ? "AUTH_FOUNDATION_NOT_APPLIED"
      : error instanceof Error && error.message.startsWith("Unknown auth backfill argument")
        ? "INVALID_ARGUMENTS"
        : "AUTH_BACKFILL_FAILED";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
