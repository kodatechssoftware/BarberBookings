import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentOccupancyOverlaps,
  getOperationalAppointmentBounds,
} from "../../shared/appointment-occupancy";

const at = (time: string) => `2026-10-12T${time}:00.000Z`;

test("operational bounds preserve commercial time and apply before/after buffers", () => {
  const bounds = getOperationalAppointmentBounds({
    startTime: at("10:00"),
    durationMinutes: 60,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
  });
  assert.equal(bounds.commercialStart.toISOString(), at("10:00"));
  assert.equal(bounds.commercialEnd.toISOString(), at("11:00"));
  assert.equal(bounds.operationalStart.toISOString(), at("09:50"));
  assert.equal(bounds.operationalEnd.toISOString(), at("11:15"));
});

test("zero, before, after and both buffers use half-open boundaries", () => {
  const base = { startTime: at("10:00"), durationMinutes: 60 };
  assert.equal(appointmentOccupancyOverlaps(base, { startTime: at("11:00"), durationMinutes: 30 }), false);
  assert.equal(appointmentOccupancyOverlaps(
    { ...base, bufferAfterMinutes: 15 },
    { startTime: at("11:00"), durationMinutes: 30 },
  ), true);
  assert.equal(appointmentOccupancyOverlaps(
    base,
    { startTime: at("11:10"), durationMinutes: 30, bufferBeforeMinutes: 15 },
  ), true);
  assert.equal(appointmentOccupancyOverlaps(
    { ...base, bufferAfterMinutes: 10 },
    { startTime: at("11:20"), durationMinutes: 30, bufferBeforeMinutes: 10 },
  ), false);
  assert.equal(appointmentOccupancyOverlaps(
    { ...base, bufferAfterMinutes: 10 },
    { startTime: at("11:19"), durationMinutes: 30, bufferBeforeMinutes: 10 },
  ), true);
});
