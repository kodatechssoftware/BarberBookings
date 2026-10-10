import "dotenv/config";
import { pool } from "../server/db";
import { runAuthCutoverCheck } from "../server/auth-cutover-check";

try {
  const report = await runAuthCutoverCheck(pool);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "READY") process.exitCode = 1;
} finally {
  await pool.end();
}
