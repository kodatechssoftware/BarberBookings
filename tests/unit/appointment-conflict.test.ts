import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm";

process.env.USE_MEMORY_STORAGE = "true";

const {
  AppointmentConflictError,
  MemoryStorage,
  isAppointmentConflictError,
} = await import("../../server/storage");

function postgresAppointmentOverlapError() {
  return {
    code: "23P01",
    constraint: "appointments_no_booked_overlap",
  };
}

test("recognizes appointment conflicts directly and through nested Drizzle causes", () => {
  const postgresError = postgresAppointmentOverlapError();
  const drizzleError = new DrizzleQueryError("insert into appointments", [], postgresError as Error);
  const nestedError = new Error("transaction failed", { cause: drizzleError });

  assert.equal(isAppointmentConflictError(new AppointmentConflictError()), true);
  assert.equal(isAppointmentConflictError({ code: "APPOINTMENT_CONFLICT" }), true);
  assert.equal(isAppointmentConflictError(postgresError), true);
  assert.equal(isAppointmentConflictError(drizzleError), true);
  assert.equal(isAppointmentConflictError(nestedError), true);
});

test("does not mask unrelated PostgreSQL or application errors", () => {
  assert.equal(isAppointmentConflictError({ code: "23505" }), false);
  assert.equal(isAppointmentConflictError({ code: "23P01" }), false);
  assert.equal(isAppointmentConflictError({
    code: "23P01",
    constraint: "another_exclusion_constraint",
  }), false);
  assert.equal(isAppointmentConflictError(new Error("unexpected failure")), false);
  assert.equal(isAppointmentConflictError({
    cause: {
      code: "23514",
      constraint: "appointments_status_check",
    },
  }), false);
});

test("stops safely when a cause chain contains a cycle", () => {
  const first: { cause?: unknown } = {};
  const second: { cause?: unknown } = { cause: first };
  first.cause = second;

  assert.equal(isAppointmentConflictError(first), false);
});

test("MemoryStorage protects operational buffer intervals and preserves their snapshots", async () => {
  const storage = new MemoryStorage();
  const first = await storage.createAppointment({
    locationId: 1,
    barberId: 41,
    serviceId: 71,
    startTime: new Date("2036-06-05T10:00:00.000Z"),
    customerName: "Cliente com preparação",
    customerEmail: null,
    customerPhone: "910000041",
    durationMinutes: 60,
    bufferBeforeMinutesSnapshot: 10,
    bufferAfterMinutesSnapshot: 15,
    cancelToken: "buffer-memory-first",
  });

  assert.equal(first.bufferBeforeMinutesSnapshot, 10);
  assert.equal(first.bufferAfterMinutesSnapshot, 15);
  await assert.rejects(storage.createAppointment({
    locationId: 1,
    barberId: 41,
    serviceId: 71,
    startTime: new Date("2036-06-05T09:40:00.000Z"),
    customerName: "Conflito apenas no buffer anterior",
    customerEmail: null,
    customerPhone: "910000042",
    durationMinutes: 20,
    cancelToken: "buffer-memory-conflict",
  }), (error: unknown) => isAppointmentConflictError(error));

  const boundary = await storage.createAppointment({
    locationId: 1,
    barberId: 41,
    serviceId: 71,
    startTime: new Date("2036-06-05T11:15:00.000Z"),
    customerName: "Limite exato",
    customerEmail: null,
    customerPhone: "910000043",
    durationMinutes: 30,
    cancelToken: "buffer-memory-boundary",
  });
  await assert.rejects(
    storage.rescheduleAppointment(boundary.id, 0, new Date("2036-06-05T11:14:00.000Z")),
    (error: unknown) => isAppointmentConflictError(error),
  );

  const renamed = await storage.updateAppointment(first.id, { customerName: "Cliente renomeado" });
  assert.equal(renamed?.bufferBeforeMinutesSnapshot, 10);
  assert.equal(renamed?.bufferAfterMinutesSnapshot, 15);
});
