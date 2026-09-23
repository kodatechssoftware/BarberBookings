import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES,
  createClockAlignedTimeOptions,
  isClockTimeAligned,
  parseBookingSlotIntervalMinutes,
  type BookingSlotIntervalMinutes,
} from "../../shared/booking-slot-interval";
import {
  calendarTimeInTimeZone,
  getAvailableTimeSlots,
  type ShopAvailabilityRow,
} from "../../client/src/lib/availability";

const timeZone = "Europe/Lisbon";
const selectedDate = new Date(2026, 8, 17);
const now = new Date("2026-09-01T00:00:00.000Z");
const visibleBarbers = [{ id: 1 }];

function slots({
  interval,
  duration,
  startTime = "09:00",
  endTime = "20:00",
  existingAppointments = [],
}: {
  interval?: BookingSlotIntervalMinutes;
  duration: number;
  startTime?: string;
  endTime?: string;
  existingAppointments?: Array<{
    id: number;
    barberId: number;
    serviceId: number;
    startTime: string;
    duration: number;
  }>;
}) {
  const shopAvailabilityRows: ShopAvailabilityRow[] = [{
    dayOfWeek: selectedDate.getDay(), startTime, endTime, isOpen: true,
  }];
  return getAvailableTimeSlots({
    selectedService: { id: 1, duration },
    selectedDate,
    selectedBarberId: 1,
    visibleBarbers,
    availabilityRows: [],
    shopAvailabilityRows,
    existingAppointments,
    now,
    timeZone,
    ...(interval ? { slotIntervalMinutes: interval } : {}),
  });
}

test("runtime parser defaults to the historical 30 minutes and accepts only 15, 30 or 60", () => {
  assert.equal(parseBookingSlotIntervalMinutes(undefined), DEFAULT_BOOKING_SLOT_INTERVAL_MINUTES);
  assert.equal(parseBookingSlotIntervalMinutes(""), 30);
  assert.equal(parseBookingSlotIntervalMinutes(" 15 "), 15);
  assert.equal(parseBookingSlotIntervalMinutes("30"), 30);
  assert.equal(parseBookingSlotIntervalMinutes("60"), 60);

  for (const invalid of ["abc", "0", "-30", "17", "90", "30.0", "+30"]) {
    assert.throws(
      () => parseBookingSlotIntervalMinutes(invalid),
      /BOOKING_SLOT_INTERVAL_MINUTES must be one of: 15, 30, 60/,
    );
  }
});

test("clock-aligned helpers produce predictable 15, 30 and 60 minute choices", () => {
  assert.deepEqual(createClockAlignedTimeOptions({
    startMinute: 9 * 60 + 30, endMinuteExclusive: 13 * 60, intervalMinutes: 60,
  }), ["10:00", "11:00", "12:00"]);
  assert.deepEqual(createClockAlignedTimeOptions({
    startMinute: 9 * 60 + 15, endMinuteExclusive: 11 * 60, intervalMinutes: 30,
  }), ["09:30", "10:00", "10:30"]);
  assert.deepEqual(createClockAlignedTimeOptions({
    startMinute: 9 * 60, endMinuteExclusive: 10 * 60, intervalMinutes: 15,
  }), ["09:00", "09:15", "09:30", "09:45"]);
  assert.equal(isClockTimeAligned("10:30", 60), false);
  assert.equal(isClockTimeAligned("10:30", 30), true);
  assert.equal(isClockTimeAligned("10:15", 15), true);
});

test("60-minute starts stay independent from 30, 45, 60 and 90-minute service durations", () => {
  for (const duration of [30, 45, 60]) {
    assert.deepEqual(slots({ interval: 60, duration }).map((slot) => slot.time), [
      "09:00", "10:00", "11:00", "12:00", "13:00", "14:00",
      "15:00", "16:00", "17:00", "18:00", "19:00",
    ]);
  }
  assert.deepEqual(slots({ interval: 60, duration: 90 }).map((slot) => slot.time), [
    "09:00", "10:00", "11:00", "12:00", "13:00",
    "14:00", "15:00", "16:00", "17:00", "18:00",
  ]);
});

test("a misaligned shift starts at the next clock boundary", () => {
  assert.equal(slots({ interval: 60, duration: 30, startTime: "09:30" })[0]?.time, "10:00");
  assert.equal(slots({ interval: 30, duration: 30, startTime: "09:15" })[0]?.time, "09:30");
});

test("15/30/default generation remains complete and the default stays equivalent to 30", () => {
  const fifteen = slots({ interval: 15, duration: 15, startTime: "09:00", endTime: "10:00" });
  assert.deepEqual(fifteen.map((slot) => slot.time), ["09:00", "09:15", "09:30", "09:45"]);

  const explicitThirty = slots({ interval: 30, duration: 30, startTime: "09:00", endTime: "11:00" });
  const defaultThirty = slots({ duration: 30, startTime: "09:00", endTime: "11:00" });
  assert.deepEqual(defaultThirty, explicitThirty);
  assert.deepEqual(defaultThirty.map((slot) => slot.time), ["09:00", "09:30", "10:00", "10:30"]);
});

test("historical off-grid appointments still block every overlapping aligned start", () => {
  const historicalStart = calendarTimeInTimeZone(selectedDate, "10:30", timeZone);
  const result = slots({
    interval: 60,
    duration: 60,
    existingAppointments: [{
      id: 99,
      barberId: 1,
      serviceId: 1,
      startTime: historicalStart.toISOString(),
      duration: 60,
    }],
  });
  const availability = new Map(result.map((slot) => [slot.time, slot.available]));
  assert.equal(availability.get("10:00"), false);
  assert.equal(availability.get("11:00"), false);
  assert.equal(availability.get("12:00"), true);
});

test("slot alignment remains based on Lisbon wall-clock time across DST", () => {
  const winter = calendarTimeInTimeZone(new Date(2026, 0, 15), "10:00", timeZone);
  const summer = calendarTimeInTimeZone(new Date(2026, 6, 15), "10:00", timeZone);
  assert.equal(winter.toISOString(), "2026-01-15T10:00:00.000Z");
  assert.equal(summer.toISOString(), "2026-07-15T09:00:00.000Z");
  assert.equal(isClockTimeAligned("10:00", 60), true);
});
