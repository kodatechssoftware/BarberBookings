import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function createMigrationSubsetThrough(lastMigration: string) {
  const sourceDirectory = path.resolve(process.cwd(), "migrations");
  const targetDirectory = await mkdtemp(path.join(tmpdir(), "barberbookings-migrations-through-"));
  const files = (await readdir(sourceDirectory))
    .filter((file) => migrationNamePattern.test(file) && file <= lastMigration)
    .sort();
  for (const file of files) {
    await copyFile(path.join(sourceDirectory, file), path.join(targetDirectory, file));
  }
  return targetDirectory;
}
