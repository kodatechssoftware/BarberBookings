import "dotenv/config";
import { pool } from "../server/db";
import { runDatabaseBootstrap } from "../server/database-bootstrap";

try {
  const result = await runDatabaseBootstrap(pool);
  console.log(
    `Database bootstrap complete: state=${result.initialState}, baselineInstalled=${result.baselineInstalled}, `
      + `applied=${result.applied.length}, alreadyApplied=${result.alreadyApplied}.`,
  );
  for (const migration of result.applied) console.log(`Applied ${migration}.`);
} finally {
  await pool.end();
}
