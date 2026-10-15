import "dotenv/config";
import { pool } from "../server/db";
import {
  BEAUTY_DEMO_CONFIRMATION,
  runBeautyDemoSeed,
  type BeautyDemoSeedMode,
} from "../server/beauty-demo-seed";

function readArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveMode(): BeautyDemoSeedMode {
  const selected = ["--dry-run", "--apply", "--cleanup"].filter((flag) => process.argv.includes(flag));
  if (selected.length > 1) throw new Error("Choose only one of --dry-run, --apply or --cleanup.");
  if (selected[0] === "--apply") return "apply";
  if (selected[0] === "--cleanup") return "cleanup";
  return "dry-run";
}

const mode = resolveMode();
const referenceDate = readArgument("--reference-date");
if (!referenceDate) throw new Error("--reference-date YYYY-MM-DD is required.");
const confirmation = readArgument("--confirm");

try {
  const summary = await runBeautyDemoSeed(pool, {
    mode,
    referenceDate,
    confirmation,
    environment: process.env,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (mode !== "dry-run" && confirmation !== BEAUTY_DEMO_CONFIRMATION) process.exitCode = 1;
} finally {
  await pool.end();
}
