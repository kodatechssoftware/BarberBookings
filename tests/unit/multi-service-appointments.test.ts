import assert from "node:assert/strict";
import test from "node:test";
import { calendarDateTimeToInstant, getCalendarDateTimeParts } from "../../server/calendar-timezone";
import {
  assertMultiServicePlanFitsWorkingPeriods,
  assertParallelServiceCompatibility,
  MultiServiceAppointmentValidationError,
  planAppointmentServices,
  planMultiServiceAppointment,
  planParallelAppointmentServices,
  serviceCompatibilityKey,
} from "../../shared/multi-service-appointments";

const service = (overrides: Partial<{
  serviceId: number;
  barberId: number;
  serviceName: string;
  priceCents: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  executionStage: number;
}> = {}) => ({
  serviceId: 1,
  barberId: 1,
  serviceName: "Manicure",
  priceCents: 2_000,
  durationMinutes: 45,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  ...overrides,
});

test("plans two and three simultaneous services using the longest duration", () => {
  const compatible = new Set([
    serviceCompatibilityKey(1, 2),
    serviceCompatibilityKey(1, 3),
    serviceCompatibilityKey(2, 3),
  ]);
  const plan = planParallelAppointmentServices("2030-01-10T14:00:00.000Z", [
    service({ serviceId: 1, barberId: 1, serviceName: "Manicure gel", durationMinutes: 60, priceCents: 2_800 }),
    service({ serviceId: 2, barberId: 2, serviceName: "Limpeza de pele", durationMinutes: 60, priceCents: 4_000 }),
    service({ serviceId: 3, barberId: 3, serviceName: "Extensão de pestanas", durationMinutes: 90, priceCents: 4_500 }),
  ], compatible, 1);

  assert.deepEqual(plan.segments.map((segment) => segment.executionStage), [0, 0, 0]);
  assert.deepEqual(plan.segments.map((segment) => segment.startTime.toISOString()), [
    "2030-01-10T14:00:00.000Z",
    "2030-01-10T14:00:00.000Z",
    "2030-01-10T14:00:00.000Z",
  ]);
  assert.equal(plan.durationMinutes, 90);
  assert.equal(plan.totalPriceCents, 11_300);
  assert.equal(plan.endTime.toISOString(), "2030-01-10T15:30:00.000Z");
});

test("plans hybrid stages and keeps the next stage after the longest parallel service", () => {
  const plan = planAppointmentServices("2030-01-10T14:00:00.000Z", [
    service({ serviceId: 1, barberId: 1, durationMinutes: 30, executionStage: 0 }),
    service({ serviceId: 2, barberId: 2, durationMinutes: 60, executionStage: 0 }),
    service({ serviceId: 3, barberId: 1, durationMinutes: 45, executionStage: 1 }),
  ], 1);

  assert.deepEqual(plan.segments.map((segment) => segment.startTime.toISOString()), [
    "2030-01-10T14:00:00.000Z",
    "2030-01-10T14:00:00.000Z",
    "2030-01-10T15:00:00.000Z",
  ]);
  assert.equal(plan.durationMinutes, 105);
});

test("rejects the same professional and incomplete pair compatibility in one stage", () => {
  const pair = new Set([serviceCompatibilityKey(1, 2)]);
  assert.throws(() => planAppointmentServices(new Date(), [
    service({ serviceId: 1, barberId: 1, executionStage: 0 }),
    service({ serviceId: 2, barberId: 1, executionStage: 0 }),
  ], 1), (error: unknown) => error instanceof MultiServiceAppointmentValidationError
    && error.code === "MULTI_SERVICE_PARALLEL_BARBER_CONFLICT");

  assert.throws(() => assertParallelServiceCompatibility([
    service({ serviceId: 1, barberId: 1, executionStage: 0 }),
    service({ serviceId: 2, barberId: 2, executionStage: 0 }),
    service({ serviceId: 3, barberId: 3, executionStage: 0 }),
  ], pair), (error: unknown) => error instanceof MultiServiceAppointmentValidationError
    && error.code === "MULTI_SERVICE_PARALLEL_COMPATIBILITY_INVALID");
});

test("plans sequential services and preserves immutable duration, buffer and price snapshots", () => {
  const plan = planMultiServiceAppointment("2030-01-10T10:00:00.000Z", [
    service({ durationMinutes: 45, bufferBeforeMinutes: 10, bufferAfterMinutes: 5 }),
    service({ serviceId: 2, serviceName: "Nail art", durationMinutes: 30, priceCents: 500,
      bufferBeforeMinutes: 5, bufferAfterMinutes: 15 }),
  ]);

  assert.equal(plan.segments[0].startTime.toISOString(), "2030-01-10T10:00:00.000Z");
  assert.equal(plan.segments[1].startTime.toISOString(), "2030-01-10T10:45:00.000Z");
  assert.equal(plan.endTime.toISOString(), "2030-01-10T11:15:00.000Z");
  assert.equal(plan.durationMinutes, 75);
  assert.equal(plan.totalPriceCents, 2_500);
  assert.equal(plan.summaryServiceName, "Manicure + Nail art");
  assert.equal(plan.bufferBeforeMinutesSnapshot, 10);
  assert.equal(plan.bufferAfterMinutesSnapshot, 15);
});

test("merges touching operational periods for one professional without losing buffers", () => {
  const plan = planMultiServiceAppointment("2030-01-10T10:00:00.000Z", [
    service({ durationMinutes: 30, bufferBeforeMinutes: 10, bufferAfterMinutes: 15 }),
    service({ serviceId: 2, durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 }),
  ]);

  assert.equal(plan.occupancyPeriods.length, 1);
  assert.equal(plan.occupancyPeriods[0].startTime.toISOString(), "2030-01-10T09:50:00.000Z");
  assert.equal(plan.occupancyPeriods[0].endTime.toISOString(), "2030-01-10T11:10:00.000Z");
});

test("keeps occupancy independent when sequential services use different professionals", () => {
  const plan = planMultiServiceAppointment("2030-01-10T10:00:00.000Z", [
    service({ barberId: 1, durationMinutes: 60, bufferAfterMinutes: 10 }),
    service({ serviceId: 2, barberId: 2, durationMinutes: 30, bufferBeforeMinutes: 10 }),
  ]);

  assert.equal(plan.occupancyPeriods.length, 2);
  assert.deepEqual(plan.occupancyPeriods.map((period) => period.barberId), [1, 2]);
  assert.equal(plan.occupancyPeriods[0].endTime.toISOString(), "2030-01-10T11:10:00.000Z");
  assert.equal(plan.occupancyPeriods[1].startTime.toISOString(), "2030-01-10T10:50:00.000Z");
});

test("fails the complete plan when only one service is outside a professional availability period", () => {
  const plan = planMultiServiceAppointment("2030-01-10T10:00:00.000Z", [
    service({ barberId: 1, durationMinutes: 30 }),
    service({ serviceId: 2, barberId: 2, durationMinutes: 60 }),
  ]);
  const periods = new Map([
    ["1:4", [{ start: 9 * 60, end: 18 * 60 }]],
    ["2:4", [{ start: 9 * 60, end: 11 * 60 }]],
  ]);

  assert.throws(
    () => assertMultiServicePlanFitsWorkingPeriods(plan, "UTC", periods),
    (error: unknown) => error instanceof MultiServiceAppointmentValidationError
      && error.code === "MULTI_SERVICE_OUTSIDE_AVAILABILITY",
  );
});

for (const fixture of [
  { label: "summer", year: 2030, month: 7, day: 1 },
  { label: "winter", year: 2030, month: 1, day: 10 },
  { label: "DST spring transition", year: 2030, month: 3, day: 31 },
  { label: "DST autumn transition", year: 2030, month: 10, day: 27 },
]) {
  test(`Europe/Lisbon keeps sequential local service times valid in ${fixture.label}`, () => {
    const start = calendarDateTimeToInstant({ ...fixture, hour: 10, minute: 0, second: 0 }, "Europe/Lisbon");
    const plan = planMultiServiceAppointment(start, [
      service({ durationMinutes: 30 }),
      service({ serviceId: 2, durationMinutes: 45 }),
    ]);
    const first = getCalendarDateTimeParts(plan.segments[0].startTime, "Europe/Lisbon");
    const second = getCalendarDateTimeParts(plan.segments[1].startTime, "Europe/Lisbon");
    assert.deepEqual([first.hour, first.minute], [10, 0]);
    assert.deepEqual([second.hour, second.minute], [10, 30]);
  });

  test(`Europe/Lisbon keeps parallel local service times valid in ${fixture.label}`, () => {
    const start = calendarDateTimeToInstant({ ...fixture, hour: 10, minute: 0, second: 0 }, "Europe/Lisbon");
    const plan = planParallelAppointmentServices(start, [
      service({ serviceId: 1, barberId: 1, durationMinutes: 60 }),
      service({ serviceId: 2, barberId: 2, durationMinutes: 90 }),
    ], new Set([serviceCompatibilityKey(1, 2)]), 1);
    const first = getCalendarDateTimeParts(plan.segments[0].startTime, "Europe/Lisbon");
    const second = getCalendarDateTimeParts(plan.segments[1].startTime, "Europe/Lisbon");

    assert.deepEqual([first.hour, first.minute], [10, 0]);
    assert.deepEqual([second.hour, second.minute], [10, 0]);
    assert.equal(plan.durationMinutes, 90);
  });
}

test("rejects one-service and malformed multi-service plans before persistence", () => {
  assert.throws(() => planMultiServiceAppointment(new Date(), [service()]), /entre 2 e 12/i);
  assert.throws(() => planMultiServiceAppointment(new Date(), [
    service(), service({ serviceId: 2, durationMinutes: 0 }),
  ]), /posição 2/i);
});
