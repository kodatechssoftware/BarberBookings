import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import {
  createRequestTimings, requestTimings, shouldEnablePerformanceTimings,
  type RequestTimings,
} from "./performance-timings";

type Phase =
  | "process-origin" | "instrumentation-ready" | "entry-module-ready"
  | "db-pool-configuration" | "http-configuration" | "runtime-validation"
  | "starting-to-listen" | "ensureServiceAgendaLabelColumn"
  | "ensureAppointmentPaymentMethodColumn" | "ensureBarberServicesTable"
  | "ensureBarberCompensationRulesTable" | "ensureBusinessExpensesTable"
  | "ensureAppointmentOverlapProtection" | "repairKnownTextEncodingArtifacts"
  | "registerRoutes" | "session-store-initialization" | "ensureSessionStoreTable"
  | "seedDatabase" | "seed.hasData" | "seed.admin-read" | "seed.demo-sync"
  | "ensureDefaultShopAvailability" | "workers" | "static-setup" | "vite-setup"
  | "http-final-configuration" | "http-listen" | "total-before-listen" | "listening";

type Status = "ok" | "error" | "skipped";
export type StartupRecord = {
  phase: Phase;
  parent?: Phase;
  status: Status;
  at: string;
  startMs: number;
  elapsedMs: number;
  durationMs: number;
  sqlCount?: number;
  sqlRoundTripMs?: number;
  acquireMs?: number;
  acquireNewMs?: number;
  acquireQueuedMs?: number;
};

// Uses the existing DEV-only opt-in, including NODE_ENV=production builds in DEV.
// Never logs SQL, parameters, errors, credentials, URLs or data returned by a phase.
export function createStartupTimings(
  environment: NodeJS.ProcessEnv,
  options: { now?: () => number; timeOrigin?: number; write?: (record: StartupRecord) => void } = {},
) {
  const enabled = shouldEnablePerformanceTimings(environment);
  const now = options.now ?? (() => performance.now());
  const timeOrigin = options.timeOrigin ?? performance.timeOrigin;
  const write = options.write ?? ((record) => console.info("[startup]", JSON.stringify(record)));
  const phases = new AsyncLocalStorage<Phase>();
  const round = (value: number) => Math.round(value * 10) / 10;

  function emit(phase: Phase, start: number, end: number, status: Status, parent?: Phase, sql?: RequestTimings) {
    if (!enabled) return;
    try {
      write({ phase, ...(parent ? { parent } : {}), status,
        at: new Date(timeOrigin + end).toISOString(), startMs: round(start),
        elapsedMs: round(end), durationMs: round(end - start),
        ...(sql ? { sqlCount: sql.sqlCount, sqlRoundTripMs: round(sql.sqlRoundTripMs),
          acquireMs: round(sql.acquireMs), acquireNewMs: round(sql.acquireByKindMs.new),
          acquireQueuedMs: round(sql.acquireByKindMs.queued) } : {}),
      });
    } catch {
      // Diagnostics must not change startup success/failure or replace its error.
    }
  }

  function start(phase: Phase) {
    if (!enabled) return (_status: Status = "ok", _sql?: RequestTimings) => {};
    const startedAt = now(), parent = phases.getStore();
    let finished = false;
    return (status: Status = "ok", sql?: RequestTimings) => {
      if (finished) return;
      finished = true;
      emit(phase, startedAt, now(), status, parent, sql);
    };
  }

  function sync<T>(phase: Phase, operation: () => T): T {
    if (!enabled) return operation();
    const finish = start(phase);
    const timings = createRequestTimings("STARTUP", phase);
    return phases.run(phase, () => requestTimings.run(timings, () => {
      try {
        const result = operation();
        timings.closed = true;
        finish("ok", timings);
        return result;
      } catch (error) {
        timings.closed = true;
        finish("error", timings);
        throw error;
      }
    }));
  }

  async function measure<T>(phase: Phase, operation: () => Promise<T>): Promise<T> {
    if (!enabled) return operation();
    const finish = start(phase);
    const timings = createRequestTimings("STARTUP", phase);
    return phases.run(phase, () => requestTimings.run(timings, async () => {
      try {
        const result = await operation();
        timings.closed = true;
        finish("ok", timings);
        return result;
      } catch (error) {
        timings.closed = true;
        finish("error", timings);
        throw error;
      }
    }));
  }

  function mark(phase: Phase, status: Status = "ok") {
    if (!enabled) return;
    const elapsed = now();
    emit(phase, elapsed, elapsed, status, phases.getStore());
  }

  function totalBeforeListen() {
    if (enabled) emit("total-before-listen", 0, now(), "ok");
  }

  if (enabled) {
    // Retrospective origin: imports run before this logger or the entry module.
    emit("process-origin", 0, 0, "ok");
    mark("instrumentation-ready");
  }
  return { start, sync, measure, mark, totalBeforeListen };
}

export const startupTimings = createStartupTimings(process.env);
