import assert from "node:assert/strict";
import test from "node:test";
import {
  appointmentOccupancyOverlaps,
  getAppointmentOccupancyPeriods,
  validateAppointmentAvailabilityWindows,
} from "../../shared/appointment-occupancy";
import type { CreateAppointmentStorageRequest } from "../../server/storage";

process.env.USE_MEMORY_STORAGE = "true";
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
const {
  AppointmentAvailabilityWindowsError,
  AppointmentConflictError,
  MemoryStorage,
} = await import("../../server/storage");

const at = (hour: number, minute = 0) => new Date(Date.UTC(2037, 3, 5, hour, minute));

function input(overrides: Partial<CreateAppointmentStorageRequest> = {}): CreateAppointmentStorageRequest {
  return {
    locationId: 1,
    barberId: 1,
    serviceId: 1,
    startTime: at(10),
    customerName: "Cliente janela",
    customerEmail: null,
    customerPhone: "910000001",
    durationMinutes: 180,
    cancelToken: crypto.randomUUID(),
    ...overrides,
  };
}

test("central occupancy subtracts commercial windows while preserving exterior buffers", () => {
  const periods = getAppointmentOccupancyPeriods({
    startTime: at(10), durationMinutes: 180,
    bufferBeforeMinutes: 15, bufferAfterMinutes: 10,
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  });
  assert.deepEqual(periods, [
    { startTime: at(9, 45), endTime: at(11) },
    { startTime: at(12), endTime: at(13, 10) },
  ]);
  assert.equal(appointmentOccupancyOverlaps({
    startTime: at(11), durationMinutes: 60,
  }, {
    startTime: at(10), durationMinutes: 180,
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  }), false, "an exact nested appointment fits the released interval");
  assert.equal(appointmentOccupancyOverlaps({
    startTime: at(11), durationMinutes: 60, bufferBeforeMinutes: 1,
  }, {
    startTime: at(10), durationMinutes: 180,
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  }), true, "nested buffers must also fit entirely inside the window");
  assert.equal(appointmentOccupancyOverlaps({
    startTime: at(11), durationMinutes: 61,
  }, {
    startTime: at(10), durationMinutes: 180,
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  }), true, "a service longer than the released interval must be rejected");
});

test("occupancy uses absolute instants across the Europe/Lisbon DST transition", () => {
  // On 28 March 2038 Lisbon advances from UTC to UTC+1. The model deliberately
  // receives resolved instants, so the missing local hour cannot stretch or
  // shrink the released operational interval.
  const parentStart = new Date("2038-03-28T00:30:00.000Z");
  const windowStart = new Date("2038-03-28T01:30:00.000Z");
  const windowEnd = new Date("2038-03-28T02:30:00.000Z");
  assert.deepEqual(getAppointmentOccupancyPeriods({
    startTime: parentStart,
    durationMinutes: 180,
    availabilityWindows: [{ startTime: windowStart, endTime: windowEnd }],
  }), [
    { startTime: parentStart, endTime: windowStart },
    { startTime: windowEnd, endTime: new Date("2038-03-28T03:30:00.000Z") },
  ]);
  assert.equal(appointmentOccupancyOverlaps({
    startTime: windowStart,
    durationMinutes: 60,
  }, {
    startTime: parentStart,
    durationMinutes: 180,
    availabilityWindows: [{ startTime: windowStart, endTime: windowEnd }],
  }), false);
});

test("window validation rejects invalid/outside/overlapping ranges and permits exact boundaries", () => {
  const appointment = { startTime: at(10), durationMinutes: 180 };
  assert.equal(validateAppointmentAvailabilityWindows(appointment, [
    { startTime: at(10), endTime: at(11) },
    { startTime: at(11), endTime: at(13) },
  ]).valid, true);
  assert.deepEqual(validateAppointmentAvailabilityWindows(appointment, [
    { startTime: at(9, 59), endTime: at(11) },
  ]), { valid: false, code: "OUTSIDE_APPOINTMENT" });
  assert.deepEqual(validateAppointmentAvailabilityWindows(appointment, [
    { startTime: at(11), endTime: at(12) },
    { startTime: at(11, 30), endTime: at(12, 30) },
  ]), { valid: false, code: "OVERLAP" });
  assert.deepEqual(getAppointmentOccupancyPeriods({
    ...appointment,
    availabilityWindows: [{ startTime: at(10), endTime: at(13) }],
  }), [], "a full commercial window with no buffers releases the whole interval");
});

test("MemoryStorage permits nested bookings, rejects buffer leakage and keeps window history", async () => {
  const storage = new MemoryStorage();
  const parent = await storage.createAppointment(input({
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  }));
  const nested = await storage.createAppointment(input({
    startTime: at(11), durationMinutes: 60, customerName: "Cliente dentro",
  }));
  assert.equal((await storage.getAppointmentAvailabilityWindows([parent.id])).length, 1);

  await assert.rejects(storage.createAppointment(input({
    startTime: at(11), durationMinutes: 60, bufferBeforeMinutesSnapshot: 5,
  })), AppointmentConflictError);

  const shifted = await storage.rescheduleAppointment(parent.id, 0, at(14));
  assert.equal(shifted?.appointment.startTime.getTime(), at(14).getTime());
  assert.deepEqual((await storage.getAppointmentAvailabilityWindows([parent.id])).map((window) => [
    window.startTime.getTime(), window.endTime.getTime(),
  ]), [[at(15).getTime(), at(16).getTime()]]);
  assert.equal((await storage.getAppointment(nested.id))?.startTime.getTime(), at(11).getTime(),
    "rescheduling the parent must never move the nested appointment");

  await storage.updateAppointment(parent.id, { status: "cancelled" });
  assert.equal((await storage.getAppointmentAvailabilityWindows([parent.id])).length, 1,
    "cancellation preserves the concrete appointment history");
  await storage.createAppointment(input({ startTime: at(14), durationMinutes: 180 }));
});

test("MemoryStorage rejects unsafe window edits and recurring windows", async () => {
  const storage = new MemoryStorage();
  const appointment = await storage.createAppointment(input({
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  }));
  await assert.rejects(
    storage.updateAppointment(appointment.id, { durationMinutes: 30 }),
    AppointmentAvailabilityWindowsError,
  );
  await assert.rejects(storage.createAppointment(input({
    seriesId: crypto.randomUUID(),
    availabilityWindows: [{ startTime: at(11), endTime: at(12) }],
  })), AppointmentAvailabilityWindowsError);
});
