import "dotenv/config";
import { pool } from "../server/db";
import { runLegacyAuthPreflight } from "../server/auth-legacy-preflight";

try {
  const report = await runLegacyAuthPreflight(pool);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}
