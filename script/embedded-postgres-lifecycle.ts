import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import type EmbeddedPostgres from "embedded-postgres";

const execFileAsync = promisify(execFile);

type EmbeddedPostgresInternals = EmbeddedPostgres & {
  process?: ChildProcess;
};

/**
 * Stops embedded PostgreSQL deterministically on Windows.
 *
 * embedded-postgres currently starts `taskkill` without observing that command
 * and waits indefinitely for an `exit` event that Windows can occasionally
 * miss. pg_ctl owns the PostgreSQL shutdown protocol and provides a bounded
 * wait; taskkill is retained only as a bounded, PID-specific fallback.
 */
export async function stopEmbeddedPostgres(
  instance: EmbeddedPostgres,
  databaseDir: string,
  timeoutMs = 20_000,
) {
  if (process.platform !== "win32") {
    await instance.stop();
    return;
  }

  const internals = instance as EmbeddedPostgresInternals;
  const child = internals.process;
  if (!child) return;

  let gracefulError: unknown;
  try {
    const { pg_ctl: pgCtl } = await import("@embedded-postgres/windows-x64");
    await execFileAsync(pgCtl, [
      "stop",
      "-D",
      databaseDir,
      "-m",
      "fast",
      "-w",
      "-t",
      String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
    ], { timeout: timeoutMs, windowsHide: true });
  } catch (error) {
    gracefulError = error;
    if (!child.pid) throw error;
    try {
      await execFileAsync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        timeout: 10_000,
        windowsHide: true,
      });
    } catch (forceError) {
      throw new AggregateError(
        [gracefulError, forceError],
        `Could not stop embedded PostgreSQL process ${child.pid}.`,
      );
    }
  } finally {
    // Prevent the package's async exit hook from trying the known hanging path.
    internals.process = undefined;
  }
}
