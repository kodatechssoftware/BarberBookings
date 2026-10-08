import type { Pool, PoolClient } from "pg";

type ClientState = "idle" | "checked-out";
type ClientErrorListener = (error: Error) => void;

export type PostgresClientErrorLogger = (state: ClientState, error: Error) => void;

function errorCode(error: Error) {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : error.name || "Error";
}

export function formatPostgresClientError(state: ClientState, error: Error) {
  const code = errorCode(error);
  const message = error.message.trim();
  const suffix = message && message !== code ? ` (${message})` : "";
  return `PostgreSQL ${state} client error: ${code}${suffix}`;
}

function logPostgresClientError(state: ClientState, error: Error) {
  console.error(formatPostgresClientError(state, error));
  if (process.env.NODE_ENV !== "production" && error.stack) {
    console.error(error.stack);
  }
}

/**
 * Covers the interval in which pg-pool has checked a client out and therefore
 * removed its own idle error listener. pg-pool exposes acquire/release events
 * for this lifecycle; keeping the listener at pool level also covers clients
 * checked out internally by Drizzle transactions.
 */
export function installPostgresPoolLifecycle(
  pool: Pool,
  logError: PostgresClientErrorLogger = logPostgresClientError,
) {
  const checkedOutListeners = new Map<PoolClient, ClientErrorListener>();

  const onAcquire = (client: PoolClient) => {
    const previousListener = checkedOutListeners.get(client);
    if (previousListener) client.removeListener("error", previousListener);

    let logged = false;
    const listener: ClientErrorListener = (error) => {
      // Keep the listener installed until release so repeated socket events
      // cannot become unhandled, but avoid noisy duplicate logs for one lease.
      if (logged) return;
      logged = true;
      logError("checked-out", error);
    };

    checkedOutListeners.set(client, listener);
    client.on("error", listener);
  };

  const onRelease = (_error: Error, client: PoolClient) => {
    const listener = checkedOutListeners.get(client);
    if (!listener) return;
    client.removeListener("error", listener);
    checkedOutListeners.delete(client);
  };

  const onIdleError = (error: Error) => {
    logError("idle", error);
  };

  pool.on("acquire", onAcquire);
  pool.on("release", onRelease);
  pool.on("error", onIdleError);

  return () => {
    pool.removeListener("acquire", onAcquire);
    pool.removeListener("release", onRelease);
    pool.removeListener("error", onIdleError);
    checkedOutListeners.forEach((listener, client) => {
      client.removeListener("error", listener);
    });
    checkedOutListeners.clear();
  };
}
