import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentCompletionTimingMessage,
  canCompleteAppointment,
  getAppointmentCompletionEnd,
  getAppointmentCompletionTimingError,
} from "../../shared/appointment-completion";

test("completion uses the effective end instead of only the start", () => {
  const appointment = {
    startTime: "2026-10-04T17:00:00.000Z",
    durationMinutes: 45,
  };

  assert.equal(
    getAppointmentCompletionTimingError(appointment, new Date("2026-10-04T17:44:59.999Z")),
    appointmentCompletionTimingMessage,
  );
  assert.equal(
    getAppointmentCompletionTimingError(appointment, new Date("2026-10-04T17:45:00.000Z")),
    null,
  );
});

test("future and in-progress appointments cannot complete while ended appointments can", () => {
  const now = new Date("2026-10-04T17:20:00.000Z");

  assert.equal(canCompleteAppointment({
    startTime: "2026-10-04T18:00:00.000Z",
    durationMinutes: 45,
  }, now), false);
  assert.equal(canCompleteAppointment({
    startTime: "2026-10-04T17:00:00.000Z",
    durationMinutes: 45,
  }, now), false);
  assert.equal(canCompleteAppointment({
    startTime: "2026-10-04T16:00:00.000Z",
    durationMinutes: 45,
  }, now), true);
});

test("completion arithmetic operates on instants across Lisbon DST changes", () => {
  const springForward = getAppointmentCompletionEnd({
    startTime: "2026-03-29T00:45:00.000Z",
    durationMinutes: 30,
  });
  const fallBack = getAppointmentCompletionEnd({
    startTime: "2026-10-25T00:45:00.000Z",
    durationMinutes: 30,
  });

  assert.equal(springForward.toISOString(), "2026-03-29T01:15:00.000Z");
  assert.equal(fallBack.toISOString(), "2026-10-25T01:15:00.000Z");
});
