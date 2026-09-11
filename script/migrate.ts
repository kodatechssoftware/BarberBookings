import "dotenv/config";
import { pool } from "../server/db";
import { runSchemaMigrations } from "../server/migrations";

try {
  const result = await runSchemaMigrations(pool);
  console.log(`Schema migrations complete: applied=${result.applied.length}, alreadyApplied=${result.alreadyApplied}.`);
  for (const migration of result.applied) console.log(`Applied ${migration}.`);
} finally {
  await pool.end();
}
