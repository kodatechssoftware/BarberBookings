import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import type { Pool } from "pg";

// Diagnostics are opt-in and cannot be enabled in the Production deployment.
export function shouldEnablePerformanceTimings(environment: NodeJS.ProcessEnv) {
  return environment.APP_ENV?.trim().toLowerCase() === "development"
    && environment.PERFORMANCE_TIMINGS_ENABLED?.trim().toLowerCase() === "true";
}

export const performanceTimingsEnabled = shouldEnablePerformanceTimings(process.env);

type AcquireKind = "idle" | "new" | "queued";
type Phase = "session" | "location";

export type RequestTimings = {
  method: string;
  path: string;
  startedAt: number;
  sessionMs: number;
  locationMs: number;
  jsonMs: number;
  sqlCount: number;
  sqlRoundTripMs: number;
  acquireCount: number;
  acquireMs: number;
  acquireByKindMs: Record<AcquireKind, number>;
  maxPoolQueue: number;
};

export const requestTimings = new AsyncLocalStorage<RequestTimings>();
let instrumentedPoolMax = 0;

const timedPaths = new Set([
  "/api/admin/login", "/api/admin/me", "/api/admin/dashboard",
  "/api/admin/audit-logs", "/api/admin/blacklist", "/api/admin/expenses",
  "/api/appointments", "/api/barbers", "/api/barbers/availability",
  "/api/services", "/api/locations", "/api/shop/availability",
  "/api/multi-location/config",
]);

export function createRequestTimings(method: string, path: string): RequestTimings {
  return {
    method, path, startedAt: performance.now(), sessionMs: 0, locationMs: 0,
    jsonMs: 0, sqlCount: 0, sqlRoundTripMs: 0, acquireCount: 0,
    acquireMs: 0, acquireByKindMs: { idle: 0, new: 0, queued: 0 },
    maxPoolQueue: 0,
  };
}

export function recordPhase(phase: Phase, startedAt: number) {
  const timings = requestTimings.getStore();
  if (timings) timings[`${phase}Ms`] += performance.now() - startedAt;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export const performanceTimingMiddleware: RequestHandler = (req, res, next) => {
  if (!performanceTimingsEnabled || !timedPaths.has(req.path)) return next();

  const timings = createRequestTimings(req.method, req.path);
  const originalJson = res.json;
  res.json = function (...args: unknown[]) {
    const startedAt = performance.now();
    try {
      return (originalJson as (...values: unknown[]) => typeof res).apply(res, args);
    } finally {
      timings.jsonMs += performance.now() - startedAt;
    }
  } as typeof res.json;

  res.on("finish", () => {
    const totalMs = performance.now() - timings.startedAt;
    // SQL round trips and acquisitions can overlap across Promise.all calls;
    // report aggregates separately rather than subtracting them from wall time.
    console.info("[perf]", JSON.stringify({
      method: timings.method, path: timings.path, status: res.statusCode,
      totalMs: round(totalMs), sessionMs: round(timings.sessionMs),
      locationMs: round(timings.locationMs), jsonMs: round(timings.jsonMs),
      handlerWallMs: round(Math.max(0, totalMs - timings.sessionMs - timings.locationMs)),
      sqlCount: timings.sqlCount, sqlRoundTripMs: round(timings.sqlRoundTripMs),
      acquireCount: timings.acquireCount, acquireMs: round(timings.acquireMs),
      acquireIdleMs: round(timings.acquireByKindMs.idle),
      acquireNewMs: round(timings.acquireByKindMs.new),
      acquireQueuedMs: round(timings.acquireByKindMs.queued),
      maxPoolQueue: timings.maxPoolQueue, poolMax: instrumentedPoolMax,
    }));
  });

  requestTimings.run(timings, next);
};

export function instrumentPool(pool: Pool, enabled = performanceTimingsEnabled) {
  if (!enabled) return;
  instrumentedPoolMax = pool.options.max ?? 0;

  pool.on("connect", (client) => {
    const originalQuery = client.query.bind(client);
    (client as any).query = (...args: any[]) => {
      const timings = requestTimings.getStore();
      if (!timings) return (originalQuery as any)(...args);

      timings.sqlCount += 1;
      const startedAt = performance.now();
      const callbackIndex = args.findIndex((argument) => typeof argument === "function");
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex];
        args[callbackIndex] = (...callbackArgs: any[]) => {
          timings.sqlRoundTripMs += performance.now() - startedAt;
          return callback(...callbackArgs);
        };
        return (originalQuery as any)(...args);
      }

      const result = (originalQuery as any)(...args);
      if (result && typeof result.then === "function") {
        return result.then(
          (value: unknown) => {
            timings.sqlRoundTripMs += performance.now() - startedAt;
            return value;
          },
          (error: unknown) => {
            timings.sqlRoundTripMs += performance.now() - startedAt;
            throw error;
          },
        );
      }
      return result;
    };
  });

  const originalConnect = pool.connect.bind(pool);
  (pool as any).connect = (callback?: (...args: any[]) => void) => {
    const timings = requestTimings.getStore();
    if (!timings) return (originalConnect as any)(callback);

    const kind: AcquireKind = pool.idleCount > 0
      ? "idle"
      : pool.totalCount < pool.options.max!
        ? "new"
        : "queued";
    const startedAt = performance.now();
    timings.acquireCount += 1;
    const recordAcquisition = () => {
      const duration = performance.now() - startedAt;
      timings.acquireMs += duration;
      timings.acquireByKindMs[kind] += duration;
    };
    const result = callback
      ? (originalConnect as any)((...args: any[]) => {
          recordAcquisition();
          requestTimings.run(timings, () => callback(...args));
        })
      : (originalConnect as any)().then(
          (client: unknown) => {
            recordAcquisition();
            return client;
          },
          (error: unknown) => {
            recordAcquisition();
            throw error;
          },
        );
    timings.maxPoolQueue = Math.max(timings.maxPoolQueue, pool.waitingCount);
    return result;
  };
}
