import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarTimeInTimeZone,
  findFirstAvailableDate,
  type ShopAvailabilityRow,
} from "../../client/src/lib/availability";

const timeZone = "Europe/Lisbon";
const service = { id: 1, duration: 30 };
const barbers = [{ id: 1 }];
const date = (year: number, month: number, day: number) => new Date(year, month - 1, day);
const dateKey = (value: Date | null) => value
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : null;
const openDays = (...days: number[]): ShopAvailabilityRow[] => days.map((dayOfWeek) => ({
  dayOfWeek, startTime: "09:00", endTime: "10:00", isOpen: true,
}));
const find = ({ startDate, endDate, now, shopAvailabilityRows, existingAppointments = [] }: {
  startDate: Date;
  endDate: Date;
  now: Date;
  shopAvailabilityRows: ShopAvailabilityRow[];
  existingAppointments?: Array<{ id: number; barberId: number; serviceId: number; startTime: string; duration: number }>;
}) => findFirstAvailableDate({
  startDate, endDate, now, timeZone, selectedService: service, selectedBarberId: 1,
  visibleBarbers: barbers, availabilityRows: [], shopAvailabilityRows, existingAppointments,
});

test("selects today when a valid slot remains", () => {
  assert.equal(dateKey(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 18),
    now: new Date("2026-09-15T07:00:00Z"), shopAvailabilityRows: openDays(2, 3, 4, 5) })), "2026-09-15");
});

test("after closing selects tomorrow when tomorrow has availability", () => {
  assert.equal(dateKey(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 18),
    now: new Date("2026-09-15T20:00:00Z"), shopAvailabilityRows: openDays(2, 3, 4, 5) })), "2026-09-16");
});

test("skips a closed tomorrow and selects the following open day", () => {
  assert.equal(dateKey(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 18),
    now: new Date("2026-09-15T20:00:00Z"), shopAvailabilityRows: openDays(2, 4, 5) })), "2026-09-17");
});

test("skips a fully occupied tomorrow", () => {
  const occupiedStart = calendarTimeInTimeZone(date(2026, 9, 16), "09:00", timeZone);
  assert.equal(dateKey(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 18),
    now: new Date("2026-09-15T20:00:00Z"), shopAvailabilityRows: openDays(2, 3, 4, 5),
    existingAppointments: [{ id: 1, barberId: 1, serviceId: 1, startTime: occupiedStart.toISOString(), duration: 60 }],
  })), "2026-09-17");
});

test("finds the first availability in the next month", () => {
  assert.equal(dateKey(find({ startDate: date(2026, 9, 30), endDate: date(2026, 10, 3),
    now: new Date("2026-09-30T20:00:00Z"), shopAvailabilityRows: openDays(6) })), "2026-10-03");
});

test("uses the location date near midnight and preserves availability across DST", () => {
  assert.equal(dateKey(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 16),
    now: new Date("2026-09-14T23:30:00Z"), shopAvailabilityRows: openDays(2, 3) })), "2026-09-15");
  assert.equal(dateKey(find({ startDate: date(2026, 3, 28), endDate: date(2026, 3, 30),
    now: new Date("2026-03-28T20:00:00Z"), shopAvailabilityRows: openDays(1, 6) })), "2026-03-30");
  assert.equal(calendarTimeInTimeZone(date(2026, 3, 30), "09:00", timeZone).toISOString(), "2026-03-30T08:00:00.000Z");
});

test("returns no arbitrary date when the booking window has no availability", () => {
  assert.equal(find({ startDate: date(2026, 9, 15), endDate: date(2026, 9, 18),
    now: new Date("2026-09-15T07:00:00Z"), shopAvailabilityRows: openDays(0) }), null);
});
