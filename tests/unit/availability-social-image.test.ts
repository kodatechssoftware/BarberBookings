import assert from "node:assert/strict";
import test from "node:test";
import { getAvailableTimeSlots, calendarTimeInTimeZone } from "../../client/src/lib/availability";
import {
  getAvailabilitySocialImageDimensions,
  sanitizeAvailabilitySocialFileName,
} from "../../client/src/lib/availability-social-image";

const barbers = [
  { id: 1, serviceIds: [10] },
  { id: 2, serviceIds: [10] },
];

const saturday = new Date(2026, 9, 31, 12, 0, 0);
const saturdayRows = [
  { barberId: 1, dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isWorking: true },
  { barberId: 2, dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isWorking: true },
];
const saturdayShopRows = [
  { dayOfWeek: 6, startTime: "09:00", endTime: "12:00", isOpen: true },
];

test("social image formats keep the exact Instagram dimensions and safe filenames", () => {
  assert.deepEqual(getAvailabilitySocialImageDimensions("story"), {
    width: 1080,
    height: 1920,
    label: "Story vertical",
    detail: "1080 × 1920 px",
  });
  assert.deepEqual(getAvailabilitySocialImageDimensions("square"), {
    width: 1080,
    height: 1080,
    label: "Publicação quadrada",
    detail: "1080 × 1080 px",
  });
  assert.equal(sanitizeAvailabilitySocialFileName("Baptista Barber Shop — Baião"), "baptista-barber-shop-baiao");
});

test("promotion availability respects service duration and never announces a slot that does not fit", () => {
  const base = {
    selectedDate: saturday,
    selectedBarberId: 1,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [],
    now: new Date(2026, 9, 30, 8, 0, 0),
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30 as const,
  };

  const shortSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 30 } })
    .filter((slot) => slot.available).map((slot) => slot.time);
  const longSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 180 } })
    .filter((slot) => slot.available).map((slot) => slot.time);
  const tooLongSlots = getAvailableTimeSlots({ ...base, selectedService: { id: 10, duration: 210 } })
    .filter((slot) => slot.available).map((slot) => slot.time);

  assert.deepEqual(shortSlots, ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
  assert.deepEqual(longSlots, ["09:00"]);
  assert.deepEqual(tooLongSlots, []);
});

test("all-professionals and individual views use the same conflict and timezone engine", () => {
  const firstStart = calendarTimeInTimeZone(saturday, "09:00", "Europe/Lisbon");
  const input = {
    selectedService: { id: 10, duration: 60 },
    selectedDate: saturday,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [
      { id: 1, barberId: 1, serviceId: 10, startTime: firstStart.toISOString(), duration: 60 },
      { id: 2, barberId: 2, serviceId: 10, startTime: firstStart.toISOString(), duration: 30 },
    ],
    now: new Date(2026, 9, 30, 8, 0, 0),
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30 as const,
  };

  const all = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 0 }).map((slot) => [slot.time, slot.available]));
  const first = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 1 }).map((slot) => [slot.time, slot.available]));
  const second = new Map(getAvailableTimeSlots({ ...input, selectedBarberId: 2 }).map((slot) => [slot.time, slot.available]));

  assert.equal(all.get("09:00"), false);
  assert.equal(all.get("09:30"), true);
  assert.equal(first.get("09:30"), false);
  assert.equal(second.get("09:30"), true);
});

test("same-day promotion does not expose slots at or before the current instant", () => {
  const now = calendarTimeInTimeZone(saturday, "09:30", "Europe/Lisbon");
  const availability = new Map(getAvailableTimeSlots({
    selectedService: { id: 10, duration: 30 },
    selectedDate: saturday,
    selectedBarberId: 1,
    visibleBarbers: barbers,
    availabilityRows: saturdayRows,
    shopAvailabilityRows: saturdayShopRows,
    existingAppointments: [],
    now,
    timeZone: "Europe/Lisbon",
    slotIntervalMinutes: 30,
  }).map((slot) => [slot.time, slot.available]));

  assert.equal(availability.get("09:00"), false);
  assert.equal(availability.get("09:30"), false);
  assert.equal(availability.get("10:00"), true);
});
