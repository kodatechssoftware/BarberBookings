import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentStatusTransitionError,
  appointmentStatusTransitions,
  isAllowedAppointmentStatusTransition,
} from "../../shared/appointment-status-transitions";
import { appointmentStatuses } from "../../shared/schema";

test("only active appointments can move to a terminal status", () => {
  for (const status of appointmentStatuses) {
    assert.equal(
      isAllowedAppointmentStatusTransition("booked", status),
      true,
      `booked -> ${status} should remain available to the existing flows`,
    );
  }
});

test("completed, cancelled, late-cancelled and no-show appointments are terminal", () => {
  for (const current of appointmentStatuses.filter((status) => status !== "booked")) {
    assert.equal(appointmentStatusTransitions[current].size, 0);
    for (const target of appointmentStatuses) {
      assert.equal(isAllowedAppointmentStatusTransition(current, target), false);
    }
  }
});

test("invalid transitions have a stable user-facing reason", () => {
  assert.equal(appointmentStatusTransitionError("booked", "completed"), null);
  assert.match(appointmentStatusTransitionError("completed", "booked") || "", /não pode ser reaberta/i);
  assert.match(appointmentStatusTransitionError("cancelled", "completed") || "", /estado final/i);
});
