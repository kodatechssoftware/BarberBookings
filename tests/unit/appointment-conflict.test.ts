import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm";

process.env.USE_MEMORY_STORAGE = "true";

const {
  AppointmentConflictError,
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
